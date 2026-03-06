import { readdir, stat } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { Indexer } from "../indexer/indexer.js";
import type { ActiveSessionRecord, DiscoveredSession } from "../types.js";
import type { RuntimeState } from "./runtime-state.js";
import { decodeClaudeProjectDir, resolveClaudeProjectPath } from "../project-paths.js";

const SESSION_COLORS = [
  "#00f0ff",
  "#ff6bcb",
  "#39ff14",
  "#ffaa00",
  "#b388ff",
  "#ff5252",
  "#64ffda",
  "#ffd740",
];

export class SessionService {
  readonly discoveredSessions = new Map<string, DiscoveredSession>();
  private readonly sessionProjectCache = new Map<string, { projectName: string; projectPath: string } | null>();
  private sessionProjectCacheTime = 0;
  private readonly sessionColorMap = new Map<string, string>();
  private recentSessionsCache: ActiveSessionRecord[] = [];
  private recentSessionsCacheTime = 0;
  private readonly recentSessionsCacheTtl = 10_000;

  constructor(
    private readonly indexer: Indexer,
    private readonly runtime: RuntimeState
  ) {}

  decodeProjectDir(dirName: string): string {
    return decodeClaudeProjectDir(dirName);
  }

  async resolveProjectPath(dirName: string, fullDir?: string) {
    return resolveClaudeProjectPath(dirName, fullDir ?? join(homedir(), ".claude", "projects", dirName));
  }

  friendlyProjectName(fullPath: string): string {
    const parts = fullPath.split("/").filter(Boolean);
    const meaningful = parts.filter((part) => part !== "Users" && part !== homedir().split("/").pop());
    if (meaningful.length <= 1) return meaningful[0] || basename(fullPath);
    return meaningful.slice(-2).join("/");
  }

  getSessionColor(sessionId: string) {
    let color = this.sessionColorMap.get(sessionId);
    if (!color) {
      color = SESSION_COLORS[this.sessionColorMap.size % SESSION_COLORS.length];
      this.sessionColorMap.set(sessionId, color);
    }
    return color;
  }

  async findSessionProject(sessionId: string): Promise<{ projectName: string; projectPath: string } | null> {
    const now = Date.now();
    if (now - this.sessionProjectCacheTime > 30_000) {
      this.sessionProjectCache.clear();
      this.sessionProjectCacheTime = now;
    }

    if (this.sessionProjectCache.has(sessionId)) {
      return this.sessionProjectCache.get(sessionId) ?? null;
    }

    const claudeProjects = join(homedir(), ".claude", "projects");
    if (!existsSync(claudeProjects)) {
      this.sessionProjectCache.set(sessionId, null);
      return null;
    }

    try {
      const projectDirs = readdirSync(claudeProjects);
      for (const dir of projectDirs) {
        const sessionFile = join(claudeProjects, dir, `${sessionId}.jsonl`);
        if (existsSync(sessionFile)) {
          const decoded = await this.resolveProjectPath(dir, join(claudeProjects, dir));
          const result = { projectName: this.friendlyProjectName(decoded), projectPath: decoded };
          this.sessionProjectCache.set(sessionId, result);
          return result;
        }
      }
    } catch {
      // ignore
    }

    this.sessionProjectCache.set(sessionId, null);
    return null;
  }

  async getRecentSessions(seenSessionIds: Set<string>) {
    const now = Date.now();
    if (now - this.recentSessionsCacheTime < this.recentSessionsCacheTtl && this.recentSessionsCache.length > 0) {
      return this.recentSessionsCache.filter((session) => !seenSessionIds.has(session.sessionId));
    }

    const results: ActiveSessionRecord[] = [];
    const claudeProjects = join(homedir(), ".claude", "projects");
    try {
      await stat(claudeProjects);
    } catch {
      this.recentSessionsCache = [];
      this.recentSessionsCacheTime = now;
      return [];
    }

    const cutoff = now - 24 * 60 * 60 * 1000;
    const projectDirs = await readdir(claudeProjects);

    for (const dir of projectDirs.slice(0, 20)) {
      const projectPath = join(claudeProjects, dir);
      try {
        const projectStat = await stat(projectPath);
        if (!projectStat.isDirectory()) continue;

        const dirFiles = await readdir(projectPath);
        const jsonlNames = dirFiles.filter((file) => file.endsWith(".jsonl"));
        const files: Array<{ sessionId: string; mtime: number }> = [];

        for (const name of jsonlNames) {
          try {
            const fileStat = await stat(join(projectPath, name));
            if (fileStat.mtimeMs > cutoff) {
              files.push({ sessionId: name.replace(".jsonl", ""), mtime: fileStat.mtimeMs });
            }
          } catch {
            // skip
          }
        }

        files.sort((a, b) => b.mtime - a.mtime);
        const latest = files[0];
        if (!latest) continue;

        const decoded = await this.resolveProjectPath(dir, projectPath);
        const projectName = this.friendlyProjectName(decoded);
        const title = this.indexer.getSessionTitle(latest.sessionId);

        results.push({
          sessionId: latest.sessionId,
          label: title ? `${projectName}: ${title}` : `Session — ${projectName}`,
          agentName: "Claude",
          projectName,
          projectPath: decoded,
          status: "idle",
          lastActivity: latest.mtime,
          color: this.getSessionColor(latest.sessionId),
          isLive: false,
          ideName: "Recent",
        });
      } catch {
        continue;
      }
    }

    this.recentSessionsCache = results;
    this.recentSessionsCacheTime = now;
    return results.filter((session) => !seenSessionIds.has(session.sessionId));
  }

  async listSessionDirectories() {
    const claudeDir = join(homedir(), ".claude", "projects");
    const sessions: Array<{ projectPath: string; projectName: string; sessionFiles: string[] }> = [];

    let projectDirs: string[] = [];
    try {
      projectDirs = await readdir(claudeDir);
    } catch {
      return sessions;
    }

    for (const dir of projectDirs.slice(0, 20)) {
      const projectPath = join(claudeDir, dir);
      const projectStat = await stat(projectPath).catch(() => null);
      if (!projectStat?.isDirectory()) continue;

      const files = await readdir(projectPath).catch(() => [] as string[]);
      const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) continue;

      const decodedPath = await this.resolveProjectPath(dir, projectPath);
      sessions.push({
        projectPath: decodedPath,
        projectName: basename(decodedPath),
        sessionFiles: jsonlFiles.slice(0, 10),
      });
    }

    return sessions;
  }

  async listActiveSessions() {
    const activeSessions: ActiveSessionRecord[] = [];
    const seenSessionIds = new Set<string>();

    for (const [, session] of this.discoveredSessions) {
      if (seenSessionIds.has(session.sessionId)) continue;
      seenSessionIds.add(session.sessionId);

      const label = session.title
        ? `${session.ideName}/${session.projectName}: ${session.title}`
        : `${session.ideName} — ${session.projectName}`;

      activeSessions.push({
        sessionId: session.sessionId,
        label,
        agentName: `Claude (${session.ideName})`,
        projectName: session.projectName,
        projectPath: session.projectPath,
        status: this.runtime.agents.get(session.sessionId)?.status || "idle",
        lastActivity: session.lastActivity,
        color: this.getSessionColor(session.sessionId),
        isLive: true,
        ideName: session.ideName,
      });
    }

    for (const [id, agent] of this.runtime.agents) {
      const rawId = id.startsWith("session-") ? id.slice(8) : id;
      if (seenSessionIds.has(id) || seenSessionIds.has(rawId) || id.startsWith("citizen-")) continue;
      seenSessionIds.add(id);
      if (rawId !== id) seenSessionIds.add(rawId);

      const project = await this.findSessionProject(id);
      activeSessions.push({
        sessionId: id,
        label: project ? `${agent.displayName} — ${project.projectName}` : agent.displayName,
        agentName: agent.displayName,
        projectName: project?.projectName || agent.displayName || "unknown",
        projectPath: project?.projectPath || "",
        status: agent.status,
        lastActivity: agent.lastActivity,
        color: this.getSessionColor(id),
        isLive: true,
        ideName: agent.source === "cursor" ? "Cursor" : agent.source === "vscode" ? "VSCode" : "Claude Code",
      });
    }

    const recentSessions = await this.getRecentSessions(seenSessionIds);
    activeSessions.push(...recentSessions);
    activeSessions.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.lastActivity - a.lastActivity;
    });
    return activeSessions;
  }
}
