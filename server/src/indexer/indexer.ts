/**
 * Neon City Indexer — scans ~/.claude/projects, indexes sessions/plans/todos
 * into SQLite with FTS5 full-text search.
 */

import { readdir, stat, readFile } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import { parseSessionFile } from "./session-parser.js";
import { decodeClaudeProjectDir, resolveClaudeProjectPath } from "../project-paths.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

export class Indexer {
  private db: Database.Database;
  private indexing = false;
  private watchTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    this.db = getDb(dataDir);
  }

  /** Full index run — scan all projects and sessions.
   *  Yields the event loop between projects so HTTP/WS requests are never blocked. */
  async indexAll() {
    if (this.indexing) return;
    this.indexing = true;

    try {
      if (!existsSync(PROJECTS_DIR)) {
        console.log("[Indexer] No ~/.claude/projects found, skipping");
        return;
      }

      const projectDirs = await readdir(PROJECTS_DIR);

      for (const dirName of projectDirs) {
        const dirPath = join(PROJECTS_DIR, dirName);
        const dirStat = await stat(dirPath).catch(() => null);
        if (!dirStat?.isDirectory()) continue;

        await this.indexProject(dirName, dirPath);
        // Yield so HTTP/WS handlers can run between projects
        await new Promise((r) => setTimeout(r, 0));
      }

      console.log(`[Indexer] Indexed ${projectDirs.length} project directories`);
    } catch (err: any) {
      console.error("[Indexer] Error:", err.message);
    } finally {
      this.indexing = false;
    }
  }

  /** Start watching for changes — re-index every 30 seconds */
  startWatching() {
    this.watchTimer = setInterval(() => {
      this.incrementalIndex().catch((err) => console.error("[Indexer] Incremental index error:", err));
    }, 30_000);
  }

  stopWatching() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  /** Quick incremental index — only check for new/changed files */
  private async incrementalIndex() {
    if (this.indexing || !existsSync(PROJECTS_DIR)) return;
    this.indexing = true;

    try {
      const projectDirs = await readdir(PROJECTS_DIR);
      for (const dirName of projectDirs) {
        const dirPath = join(PROJECTS_DIR, dirName);
        const dirStat = await stat(dirPath).catch(() => null);
        if (!dirStat?.isDirectory()) continue;

        await this.indexProject(dirName, dirPath);
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch {
      // Silent
    } finally {
      this.indexing = false;
    }
  }

  private async indexProject(dirName: string, dirPath: string) {
    const projectPath = await resolveClaudeProjectPath(dirName, dirPath);
    const projectName = basename(projectPath);

    const existingProject = this.db.prepare("SELECT id, path FROM projects WHERE dir_name = ?").get(dirName) as any;
    if (existingProject) {
      this.db.prepare(`
        UPDATE projects
        SET path = ?, name = ?, dir_name = ?
        WHERE id = ?
      `).run(projectPath, projectName, dirName, existingProject.id);
    } else {
      this.db.prepare(`
        INSERT INTO projects (path, name, dir_name) VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET name = excluded.name, dir_name = excluded.dir_name
      `).run(projectPath, projectName, dirName);
    }

    const project = this.db.prepare("SELECT id FROM projects WHERE dir_name = ?").get(dirName) as any;
    if (!project) return;

    const projectId = project.id;

    // Index JSONL session files
    const files = await readdir(dirPath).catch(() => [] as string[]);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    let sessionCount = 0;
    for (const fileName of jsonlFiles) {
      const filePath = join(dirPath, fileName);
      const sessionId = fileName.replace(".jsonl", "");

      try {
        const fileStat = await stat(filePath);
        const existing = this.db.prepare("SELECT last_indexed_offset, file_size FROM sessions WHERE id = ?").get(sessionId) as any;

        // Skip if file hasn't changed
        if (existing && existing.file_size === fileStat.size) {
          sessionCount++;
          continue;
        }

        const startOffset = existing?.last_indexed_offset || 0;
        const { session, newOffset } = await parseSessionFile(filePath, startOffset);

        if (session.messages.length === 0 && existing) {
          sessionCount++;
          continue;
        }

        // Upsert session
        this.db.prepare(`
          INSERT INTO sessions (id, project_id, file_path, file_size, message_count, first_message_at, last_message_at, title, last_indexed_offset)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            file_size = excluded.file_size,
            message_count = message_count + excluded.message_count,
            last_message_at = COALESCE(excluded.last_message_at, last_message_at),
            title = COALESCE(title, excluded.title),
            last_indexed_offset = excluded.last_indexed_offset
        `).run(
          sessionId,
          projectId,
          filePath,
          fileStat.size,
          session.messages.length,
          session.firstMessageAt,
          session.lastMessageAt,
          session.title,
          newOffset
        );

        // Insert messages in small batches to avoid blocking the event loop.
        // better-sqlite3 transactions are synchronous — a single transaction
        // with thousands of rows blocks all HTTP/WS handling for seconds.
        const BATCH_SIZE = 50;
        const insertMsg = this.db.prepare(`
          INSERT INTO messages (session_id, role, content, timestamp, token_count, tool_name, file_path)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertChange = this.db.prepare(`
          INSERT INTO file_changes (session_id, file_path, change_type, timestamp)
          VALUES (?, ?, ?, ?)
        `);

        const insertBatch = this.db.transaction((msgs: typeof session.messages) => {
          for (const msg of msgs) {
            const content = msg.content.length > 10000 ? msg.content.slice(0, 10000) : msg.content;
            insertMsg.run(sessionId, msg.role, content, msg.timestamp, msg.tokenCount, msg.toolName, msg.filePath);
            if (msg.filePath && msg.toolName) {
              const changeType = ["Write", "Edit"].includes(msg.toolName) ? "write" : "read";
              insertChange.run(sessionId, msg.filePath, changeType, msg.timestamp);
            }
          }
        });

        for (let i = 0; i < session.messages.length; i += BATCH_SIZE) {
          insertBatch(session.messages.slice(i, i + BATCH_SIZE));
          // Yield between batches so the server stays responsive
          if (i + BATCH_SIZE < session.messages.length) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        sessionCount++;
      } catch {
        // Skip problematic files
      }
    }

    // Index plan files
    await this.indexPlans(dirPath, projectId);

    // Update session count
    this.db.prepare("UPDATE projects SET session_count = ?, last_indexed = ? WHERE id = ?")
      .run(sessionCount, Date.now(), projectId);
  }

  private async indexPlans(dirPath: string, projectId: number) {
    // Plans are typically stored in ~/.claude/plans/ or within project dir
    const plansDir = join(CLAUDE_DIR, "plans");
    if (!existsSync(plansDir)) return;

    try {
      const planFiles = await readdir(plansDir);
      for (const fileName of planFiles) {
        if (!fileName.endsWith(".md")) continue;

        const filePath = join(plansDir, fileName);
        const existing = this.db.prepare("SELECT id FROM plans WHERE file_path = ?").get(filePath);
        if (existing) continue;

        const content = await readFile(filePath, "utf-8");
        const title = content.split("\n").find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || fileName;

        this.db.prepare(`
          INSERT OR IGNORE INTO plans (project_id, file_path, content, created_at, title)
          VALUES (?, ?, ?, ?, ?)
        `).run(projectId, filePath, content, Date.now(), title);
      }
    } catch {
      // Plans dir might not exist
    }
  }

  // ── Query methods ──────────────────────────────────

  /** Return the indexed title for a single session, or null if not indexed yet.
   *  This is a fast primary-key lookup — never scans files. */
  getSessionTitle(sessionId: string): string | null {
    try {
      const row = this.db.prepare("SELECT title FROM sessions WHERE id = ?").get(sessionId) as any;
      return row?.title || null;
    } catch {
      return null;
    }
  }

  getProjects() {
    return this.db.prepare(`
      SELECT id, path, name, session_count, last_indexed
      FROM projects
      ORDER BY last_indexed DESC
    `).all();
  }

  getSessions(projectId?: number, limit = 50, offset = 0) {
    if (projectId) {
      return this.db.prepare(`
        SELECT s.id, s.title, s.message_count, s.first_message_at, s.last_message_at,
               p.name as project_name, p.path as project_path
        FROM sessions s
        JOIN projects p ON s.project_id = p.id
        WHERE s.project_id = ?
        ORDER BY s.last_message_at DESC
        LIMIT ? OFFSET ?
      `).all(projectId, limit, offset);
    }
    return this.db.prepare(`
      SELECT s.id, s.title, s.message_count, s.first_message_at, s.last_message_at,
             p.name as project_name, p.path as project_path
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.last_message_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  getSessionMessages(sessionId: string, limit = 200) {
    return this.db.prepare(`
      SELECT id, role, content, timestamp, token_count, tool_name, file_path
      FROM messages
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT ?
    `).all(sessionId, limit);
  }

  search(query: string, limit = 50) {
    if (!query.trim()) return [];

    // FTS5 search with snippet highlighting
    return this.db.prepare(`
      SELECT
        m.id,
        m.session_id,
        m.role,
        snippet(messages_fts, 0, '<mark>', '</mark>', '...', 40) as snippet,
        m.timestamp,
        s.title as session_title,
        p.name as project_name
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      JOIN sessions s ON m.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
  }

  getPlans(projectId?: number) {
    if (projectId) {
      return this.db.prepare(`
        SELECT id, title, content, created_at, file_path
        FROM plans WHERE project_id = ?
        ORDER BY created_at DESC
      `).all(projectId);
    }
    return this.db.prepare(`
      SELECT pl.id, pl.title, pl.content, pl.created_at, pl.file_path,
             p.name as project_name
      FROM plans pl
      JOIN projects p ON pl.project_id = p.id
      ORDER BY pl.created_at DESC
    `).all();
  }

  getTodos() {
    return this.db.prepare(`
      SELECT t.id, t.content, t.status, t.updated_at, t.session_id,
             s.title as session_title
      FROM todos t
      LEFT JOIN sessions s ON t.session_id = s.id
      ORDER BY t.updated_at DESC
      LIMIT 100
    `).all();
  }

  getFileChanges(sessionId: string) {
    return this.db.prepare(`
      SELECT file_path, change_type, timestamp
      FROM file_changes
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all(sessionId);
  }

  getStats() {
    const projects = (this.db.prepare("SELECT COUNT(*) as count FROM projects").get() as any).count;
    const sessions = (this.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as any).count;
    const messages = (this.db.prepare("SELECT COUNT(*) as count FROM messages").get() as any).count;
    const plans = (this.db.prepare("SELECT COUNT(*) as count FROM plans").get() as any).count;
    return { projects, sessions, messages, plans };
  }

  /** Token usage stats aggregated by role for cost estimation */
  getTokenStats() {
    const rows = this.db.prepare(`
      SELECT role, SUM(token_count) as total_tokens, COUNT(*) as msg_count
      FROM messages
      GROUP BY role
    `).all() as Array<{ role: string; total_tokens: number; msg_count: number }>;

    let inputTokens = 0;
    let outputTokens = 0;
    let totalMessages = 0;

    for (const row of rows) {
      totalMessages += row.msg_count;
      if (row.role === "user") {
        inputTokens += row.total_tokens || 0;
      } else if (row.role === "assistant") {
        outputTokens += row.total_tokens || 0;
      }
    }

    // Cost estimation using Sonnet pricing as default
    // Input: $3/1M tokens, Output: $15/1M tokens
    const inputCost = (inputTokens / 1_000_000) * 3;
    const outputCost = (outputTokens / 1_000_000) * 15;
    const totalCost = inputCost + outputCost;

    // Recent activity: tokens in last 24h
    const oneDayAgo = Date.now() - 86_400_000;
    const recent = this.db.prepare(`
      SELECT SUM(token_count) as tokens
      FROM messages
      WHERE timestamp > ?
    `).get(oneDayAgo) as any;
    const tokens24h = recent?.tokens || 0;

    // Active sessions: sessions with messages in last 5 minutes
    const fiveMinAgo = Date.now() - 300_000;
    const active = this.db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count
      FROM messages
      WHERE timestamp > ?
    `).get(fiveMinAgo) as any;
    const activeSessions = active?.count || 0;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalMessages,
      estimatedCost: Math.round(totalCost * 100) / 100,
      tokens24h,
      activeSessions,
    };
  }
}

function decodeProjectDir(dirName: string): string {
  return decodeClaudeProjectDir(dirName);
}
