/**
 * SQLite database for indexing Claude Code sessions, plans, and todos.
 * Uses better-sqlite3 with FTS5 for full-text search.
 */

import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";

let db: Database.Database | null = null;

export function getDb(dataDir: string): Database.Database {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "neon-city.db");

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      dir_name TEXT NOT NULL,
      last_indexed INTEGER DEFAULT 0,
      session_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      first_message_at INTEGER,
      last_message_at INTEGER,
      title TEXT,
      last_indexed_offset INTEGER DEFAULT 0,
      UNIQUE(file_path)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER,
      token_count INTEGER DEFAULT 0,
      tool_name TEXT,
      file_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      file_path TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER,
      title TEXT
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS file_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      file_path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      timestamp INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      agent_kind TEXT,
      agent_type TEXT,
      project_path TEXT,
      project_name TEXT,
      tool_name TEXT,
      tool_use_id TEXT,
      status TEXT,
      reason TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_path);
  `);

  // FTS5 virtual table for full-text search across messages
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      session_id UNINDEXED,
      role UNINDEXED,
      content='messages',
      content_rowid='id',
      tokenize='porter unicode61'
    );
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, session_id, role)
      VALUES (new.id, new.content, new.session_id, new.role);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
      VALUES ('delete', old.id, old.content, old.session_id, old.role);
    END;
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
