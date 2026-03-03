import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { exec, execFile, execSync, spawn, type ChildProcess } from "child_process";
import { readdir, readFile, stat, watch } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { createReadStream, readFileSync, existsSync, statSync, readdirSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { Indexer } from "./indexer/indexer.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());

// ============================================================
// State
// ============================================================

interface AgentState {
  agentId: string;
  displayName: string;
  source: "claude" | "cursor";
  isThinking: boolean;
  currentCommand?: string;
  toolInput?: string;
  lastActivity: number;
  status: "idle" | "reading" | "writing" | "thinking" | "stuck" | "walking";
  waitingForApproval: boolean;
}

interface Notification {
  id: string;
  type: "approval-needed" | "task-complete" | "error" | "info";
  agentId: string;
  agentName: string;
  toolName?: string;
  description: string;
  timestamp: number;
  resolved: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  sessionLabel?: string;
  timestamp: number;
}

/** Clean env for spawning child claude processes — removes nesting prevention vars */
function cleanEnvForClaude(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE") || key.startsWith("CURSOR_SPAWN") || key === "CLAUDECODE") {
      delete env[key];
    }
  }
  return env;
}

/** Summarise a tool's input object into a short human-readable string */
function summarizeToolInput(toolName: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  switch (toolName) {
    case "Bash":    return (input.command || "").slice(0, 60);
    case "Read":    return basename(input.file_path || input.path || "");
    case "Write":
    case "Edit":    return basename(input.file_path || input.path || "");
    case "Grep":    return `"${(input.pattern || "").slice(0, 30)}"`;
    case "Glob":    return (input.pattern || "").slice(0, 40);
    case "WebFetch": return (input.url || "").slice(0, 50);
    default:        return toolName;
  }
}

const agents = new Map<string, AgentState>();
const clients = new Set<WebSocket>();
const notifications: Notification[] = [];
const chatHistory: ChatMessage[] = [];
let notifCounter = 0;
let chatCounter = 0;

interface ToolActivity {
  id: string;
  toolUseId: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const toolActivities = new Map<string, ToolActivity>();
let toolActivityCounter = 0;

// ============================================================
// Session Discovery — Lock Files + Terminal Scanning
// ============================================================

interface DiscoveredSession {
  sessionId: string;
  pid: number;
  workspaceFolders: string[];
  ideName: string; // "Cursor", "VSCode", "Terminal"
  projectName: string;
  projectPath: string;
  title: string | null;
  lastActivity: number;
}

const discoveredSessions = new Map<string, DiscoveredSession>();

/** Scan ~/.claude/ide/*.lock to discover running IDE sessions */
function scanLockFiles() {
  const lockDir = join(homedir(), ".claude", "ide");
  if (!existsSync(lockDir)) return;

  const currentLockPids = new Set<number>();

  try {
    const lockFiles = readdirSync(lockDir).filter((f) => f.endsWith(".lock"));

    for (const lockFile of lockFiles) {
      try {
        const content = readFileSync(join(lockDir, lockFile), "utf-8");
        const lock = JSON.parse(content) as {
          pid: number;
          workspaceFolders: string[];
          ideName: string;
          transport: string;
        };

        // Verify PID is alive
        try {
          process.kill(lock.pid, 0);
        } catch {
          // PID dead — skip
          continue;
        }

        currentLockPids.add(lock.pid);

        // For each workspace folder, find the matching project dir + active session
        for (const workspace of lock.workspaceFolders) {
          const claudeProjects = join(homedir(), ".claude", "projects");
          if (!existsSync(claudeProjects)) continue;

          // Encode workspace path the way Claude does: /Users/jeff/proj → -Users-jeff-proj
          // Claude encodes project paths: / → -, space → -, and other special chars → -
          const encodedPath = workspace.replace(/[\/ ]/g, "-");
          const projectDir = join(claudeProjects, encodedPath);
          if (!existsSync(projectDir)) continue;

          // Find most recently modified JSONL file = active session
          const jsonlFiles = readdirSync(projectDir)
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => ({
              name: f,
              sessionId: f.replace(".jsonl", ""),
              mtime: statSync(join(projectDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

          if (jsonlFiles.length === 0) continue;

          const activeSession = jsonlFiles[0];
          const key = `lock-${lock.pid}-${workspace}`;

          // Skip if already discovered with same session
          const existing = discoveredSessions.get(key);
          if (existing && existing.sessionId === activeSession.sessionId) {
            existing.lastActivity = activeSession.mtime;
            continue;
          }

          const projName = friendlyProjectName(workspace);
          const title = getSessionTitle(activeSession.sessionId);

          discoveredSessions.set(key, {
            sessionId: activeSession.sessionId,
            pid: lock.pid,
            workspaceFolders: lock.workspaceFolders,
            ideName: lock.ideName,
            projectName: projName,
            projectPath: workspace,
            title,
            lastActivity: activeSession.mtime,
          });

          // Auto-start chat watcher for this session
          const label = title
            ? `${lock.ideName}/${projName}: ${title}`
            : `${lock.ideName} — ${projName}`;
          watchChatSession(activeSession.sessionId, label, `Claude (${lock.ideName})`);

          // Also start voice/TTS watcher for this session
          const sessionFilePath = join(projectDir, `${activeSession.sessionId}.jsonl`);
          watchSessionFile(sessionFilePath, activeSession.sessionId);

          console.log(`[lock-scan] Discovered ${lock.ideName} session: ${activeSession.sessionId.slice(0, 8)}... (${projName})`);
        }
      } catch {
        // Skip bad lock files
      }
    }
  } catch {
    // Lock dir read failed
  }

  // Remove stale entries (PID no longer alive)
  for (const [key, session] of discoveredSessions) {
    if (key.startsWith("lock-")) {
      try {
        process.kill(session.pid, 0);
      } catch {
        console.log(`[lock-scan] Session gone: ${session.ideName} — ${session.projectName}`);
        discoveredSessions.delete(key);
      }
    }
  }
}

/** Scan for terminal claude sessions via ps aux */
function scanTerminalSessions() {
  exec("ps aux", (err, stdout) => {
    if (err || !stdout) return;

    const lines = stdout.split("\n");
    const terminalPids = new Set<number>();

    for (const line of lines) {
      // Match claude processes — both with and without --resume
      // Skip IDE-managed processes (they have --output-format stream-json)
      if (!line.match(/\bclaude\b/) || line.includes("--output-format")) continue;
      // Skip non-process lines (e.g. Claude.app, grep, etc.)
      if (line.includes("Claude.app") || line.includes("grep")) continue;

      const cols = line.trim().split(/\s+/);
      const pid = parseInt(cols[1]);
      if (isNaN(pid)) continue;

      // Check for --resume <session-id>
      const resumeMatch = line.match(/--resume\s+([0-9a-f-]{36})/);
      let sessionId = resumeMatch ? resumeMatch[1] : null;

      // If no --resume, find session by PID's working directory
      if (!sessionId) {
        try {
          // Use lsof to get the process cwd
          const cwdOut = execSync(
            `lsof -d cwd -a -p ${pid} -Fn 2>/dev/null`, { encoding: "utf-8", timeout: 3000 }
          );
          const cwdMatch = cwdOut.match(/\nn(.+)/);
          if (cwdMatch) {
            const cwd = cwdMatch[1];
            const encoded = cwd.replace(/[\/ ]/g, "-");
            const projDir = join(homedir(), ".claude", "projects", encoded);
            if (existsSync(projDir)) {
              // Collect session IDs already claimed by IDE (lock-file) sessions
              const ideSessionIds = new Set<string>();
              for (const [k, s] of discoveredSessions) {
                if (k.startsWith("lock-")) ideSessionIds.add(s.sessionId);
              }

              const jsonls = readdirSync(projDir)
                .filter((f) => f.endsWith(".jsonl"))
                .map((f) => ({ id: f.replace(".jsonl", ""), mtime: statSync(join(projDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
              // Pick the most recent JSONL that is NOT already claimed by an IDE session
              const match = jsonls.find((j) => !ideSessionIds.has(j.id));
              if (match) sessionId = match.id;
            }
          }
        } catch {
          // lsof failed, skip
        }
      }

      if (!sessionId) continue;

      terminalPids.add(pid);
      const key = `term-${pid}`;

      if (discoveredSessions.has(key)) {
        discoveredSessions.get(key)!.lastActivity = Date.now();
        continue;
      }

      const project = findSessionProject(sessionId);
      const projName = project?.projectName || "Terminal";
      const title = getSessionTitle(sessionId);

      discoveredSessions.set(key, {
        sessionId,
        pid,
        workspaceFolders: project ? [project.projectPath] : [],
        ideName: "Terminal",
        projectName: projName,
        projectPath: project?.projectPath || "",
        title,
        lastActivity: Date.now(),
      });

      const label = title ? `Terminal/${projName}: ${title}` : `Terminal — ${projName}`;
      watchChatSession(sessionId, label, "Claude (Terminal)");

      // Also start voice/TTS watcher for this session
      maybeWatchAgent(sessionId);

      console.log(`[term-scan] Discovered terminal session: ${sessionId.slice(0, 8)}... (${projName})`);
    }

    // Remove stale terminal entries
    for (const [key, session] of discoveredSessions) {
      if (key.startsWith("term-") && !terminalPids.has(session.pid)) {
        try {
          process.kill(session.pid, 0);
        } catch {
          console.log(`[term-scan] Terminal session gone: ${session.projectName}`);
          discoveredSessions.delete(key);
        }
      }
    }
  });
}

// ============================================================
// WebSocket
// ============================================================

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "init",
      data: {
        agents: Array.from(agents.values()),
        notifications: notifications.filter((n) => !n.resolved).slice(-50),
        chatHistory: chatHistory.slice(-100),
        weather: currentWeather,
        toolActivities: Array.from(toolActivities.values())
          .filter((a) => Date.now() - a.startedAt < 300_000)
          .slice(-30),
      },
    })
  );

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function broadcast(type: string, data: unknown) {
  const msg = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// Throttled broadcast for high-frequency events (activity, thinking).
// Batches messages per type and flushes at ~15fps.
const pendingBroadcasts = new Map<string, unknown>();
let broadcastTimer: ReturnType<typeof setInterval> | null = null;

function broadcastThrottled(type: string, data: unknown) {
  pendingBroadcasts.set(type, data);

  if (!broadcastTimer) {
    broadcastTimer = setInterval(() => {
      for (const [t, d] of pendingBroadcasts) {
        broadcast(t, d);
      }
      pendingBroadcasts.clear();
      if (pendingBroadcasts.size === 0) {
        clearInterval(broadcastTimer!);
        broadcastTimer = null;
      }
    }, 66); // ~15fps
  }
}

// ============================================================
// Agent management helpers
// ============================================================

function getOrCreateAgent(
  agentId: string,
  source: "claude" | "cursor" = "claude"
): AgentState | null {
  let agent = agents.get(agentId);
  if (!agent) {
    if (agents.size >= 10) return null;

    // Count existing agents of this source type for numbering
    let num = 1;
    for (const a of agents.values()) {
      if (a.source === source) num++;
    }

    agent = {
      agentId,
      displayName: `${source === "cursor" ? "Cursor" : "Claude"} ${num}`,
      source: source || "claude",
      isThinking: false,
      lastActivity: Date.now(),
      status: "idle",
      waitingForApproval: false,
    };
    agents.set(agentId, agent);
    // Try to watch this agent's session file for voice
    maybeWatchAgent(agentId);
  }
  return agent;
}

// ============================================================
// Routes — Activity (from hooks)
// ============================================================

app.post("/api/activity", (req, res) => {
  const { type, filePath, agentId, source } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });

  const agent = getOrCreateAgent(agentId, source);
  if (!agent) return res.status(429).json({ error: "max agents" });

  agent.lastActivity = Date.now();
  agent.waitingForApproval = false;

  if (type === "read-start") {
    agent.status = "reading";
    agent.currentCommand = "Read";
    agent.toolInput = filePath;
  } else if (type === "write-start") {
    agent.status = "writing";
    agent.currentCommand = "Write";
    agent.toolInput = filePath;
  } else if (type === "search-start") {
    agent.status = "reading";
    agent.currentCommand = "Search";
    agent.toolInput = filePath;
  } else if (type === "bash-start") {
    agent.status = "writing";
    agent.currentCommand = "Bash";
    agent.toolInput = filePath;
  } else if (type?.endsWith("-end")) {
    agent.status = "idle";
    agent.currentCommand = undefined;
    agent.toolInput = undefined;
  }

  broadcastThrottled("activity", { ...req.body, agent });
  res.json({ ok: true });
});

app.post("/api/thinking", (req, res) => {
  const { type, agentId, toolName, toolInput, source } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });

  const agent = getOrCreateAgent(agentId, source);
  if (!agent) return res.status(429).json({ error: "max agents" });

  agent.lastActivity = Date.now();

  if (type === "thinking-start") {
    agent.isThinking = true;
    agent.status = "thinking";
    agent.currentCommand = toolName;
    agent.toolInput = toolInput;
  } else if (type === "thinking-end") {
    agent.isThinking = false;
    agent.status = "idle";
  }

  broadcastThrottled("thinking", { agents: Array.from(agents.values()) });
  res.json({ ok: true });
});

// ============================================================
// Routes — Notifications / Approvals
// ============================================================

app.post("/api/notification", (req, res) => {
  const { type, agentId, toolName, description } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });

  const agent = agents.get(agentId);
  const agentName = agent?.displayName || "Unknown Agent";

  // Mark agent as waiting
  if (agent && type === "approval-needed") {
    agent.waitingForApproval = true;
    agent.status = "stuck";
  }

  const notif: Notification = {
    id: `notif-${++notifCounter}`,
    type: type || "info",
    agentId,
    agentName,
    toolName,
    description: description || "",
    timestamp: Date.now(),
    resolved: false,
  };

  notifications.push(notif);
  // Keep last 200
  if (notifications.length > 200) {
    notifications.splice(0, notifications.length - 200);
  }

  broadcast("notification", notif);
  res.json({ ok: true, id: notif.id });
});

app.post("/api/notification/:id/resolve", (req, res) => {
  const notif = notifications.find((n) => n.id === req.params.id);
  if (!notif) return res.status(404).json({ error: "not found" });

  notif.resolved = true;

  // Clear agent waiting state
  const agent = agents.get(notif.agentId);
  if (agent) {
    agent.waitingForApproval = false;
    agent.status = "idle";
  }

  broadcast("notification-resolved", { id: notif.id });
  res.json({ ok: true });
});

app.get("/api/notifications", (_req, res) => {
  res.json({
    notifications: notifications.filter((n) => !n.resolved).slice(-50),
  });
});

// ============================================================
// Routes — Approval Requests (blocking hooks)
// ============================================================

interface ApprovalRequest {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  toolInput: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

const approvalRequests = new Map<string, ApprovalRequest>();
const autoApproveTools = new Set<string>();
let approvalCounter = 0;

app.post("/api/approval/request", (req, res) => {
  const { agentId, toolName, toolInput, description } = req.body;
  if (!agentId || !toolName) {
    return res.status(400).json({ error: "agentId and toolName required" });
  }

  // Check auto-approve
  if (autoApproveTools.has(toolName)) {
    return res.json({ id: `auto-${Date.now()}`, decision: "approve" });
  }

  const agent = agents.get(agentId);
  const agentName = agent?.displayName || "Unknown Agent";

  if (agent) {
    agent.waitingForApproval = true;
    agent.status = "stuck";
  }

  const id = `approval-${++approvalCounter}`;
  const request: ApprovalRequest = {
    id,
    agentId,
    agentName,
    toolName,
    toolInput: toolInput || "",
    status: "pending",
    createdAt: Date.now(),
  };
  approvalRequests.set(id, request);

  // Create notification so it shows in Alerts tab
  const notif: Notification = {
    id: `notif-for-${id}`,
    type: "approval-needed",
    agentId,
    agentName,
    toolName,
    description: description || `${toolName}: ${(toolInput || "").slice(0, 100)}`,
    timestamp: Date.now(),
    resolved: false,
  };
  notifications.push(notif);
  if (notifications.length > 200) notifications.splice(0, notifications.length - 200);
  broadcast("notification", { ...notif, approvalId: id });

  res.json({ id, status: "pending" });
});

app.post("/api/approval/:id/decide", (req, res) => {
  const request = approvalRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  if (request.status !== "pending") {
    return res.json({ id: request.id, status: request.status });
  }

  const { decision, approveAll } = req.body;
  request.status = decision === "approve" ? "approved" : "denied";

  if (approveAll && decision === "approve") {
    autoApproveTools.add(request.toolName);
  }

  const agent = agents.get(request.agentId);
  if (agent) {
    agent.waitingForApproval = false;
    agent.status = "idle";
  }

  // Resolve the associated notification
  const notifId = `notif-for-${request.id}`;
  const notif = notifications.find((n) => n.id === notifId);
  if (notif) {
    notif.resolved = true;
    broadcast("notification-resolved", { id: notifId });
  }

  broadcast("approval-decided", { id: request.id, decision: request.status });
  res.json({ id: request.id, status: request.status });
});

app.get("/api/approval/:id/wait", (req, res) => {
  const id = req.params.id;
  const timeout = Math.min(parseInt(req.query.timeout as string) || 30000, 60000);

  const request = approvalRequests.get(id);
  if (!request) return res.status(404).json({ error: "not found" });

  if (request.status !== "pending") {
    return res.json({ decision: request.status });
  }

  const start = Date.now();
  const check = setInterval(() => {
    const req2 = approvalRequests.get(id);
    if (!req2 || req2.status !== "pending") {
      clearInterval(check);
      if (!res.headersSent) {
        res.json({ decision: req2?.status || "denied" });
      }
    } else if (Date.now() - start > timeout) {
      clearInterval(check);
      if (!res.headersSent) {
        res.json({ decision: "pending", timeout: true });
      }
    }
  }, 500);

  req.on("close", () => clearInterval(check));
});

// ============================================================
// Routes — Chat / Messaging
// ============================================================

/** Extract first user message from a session JSONL to use as title */
function getSessionTitle(sessionId: string): string | null {
  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) return null;

  try {
    const projectDirs = readdirSync(claudeProjects);
    for (const dir of projectDirs) {
      const filePath = join(claudeProjects, dir, `${sessionId}.jsonl`);
      if (!existsSync(filePath)) continue;

      // Read first few lines to find first user message
      const data = readFileSync(filePath, "utf-8");
      for (const line of data.split("\n").slice(0, 20)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // User messages have type "user" with message.role "user"
          if ((entry.type === "user" || (entry.type === "message" && entry.message?.role === "user"))
              && entry.message?.content) {
            let text = "";
            const content = entry.message.content;
            if (typeof content === "string") text = content;
            else if (Array.isArray(content)) {
              text = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
            }
            if (text) return text.slice(0, 60) + (text.length > 60 ? "..." : "");
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

// Persistent chat session for Neon City chat panel (reuses same session across messages)
let neonChatSessionId: string | null = null;
const projectLabel = friendlyProjectName(process.cwd());

app.post("/api/chat/send", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  // Resolve which session to use
  const targetSessionId = sessionId || neonChatSessionId;

  // Resolve session label and project path from discovered sessions
  const agent = targetSessionId ? agents.get(targetSessionId) : undefined;
  const project = targetSessionId ? findSessionProject(targetSessionId) : null;

  // Find the discovered session entry to get the correct projectPath for cwd
  let discoveredProjectPath: string | null = null;
  if (targetSessionId) {
    for (const [, ds] of discoveredSessions) {
      if (ds.sessionId === targetSessionId && ds.projectPath) {
        discoveredProjectPath = ds.projectPath;
        break;
      }
    }
  }

  const sessionLabel = targetSessionId
    ? (agent ? `${agent.displayName}` : "Claude") + (project ? ` — ${project.projectName}` : "")
    : `Neon City — ${projectLabel}`;

  // Record user message
  const userMsg: ChatMessage = {
    id: `msg-${++chatCounter}`,
    role: "user",
    content: message,
    sessionId: targetSessionId || "neon-chat",
    sessionLabel,
    timestamp: Date.now(),
  };
  chatHistory.push(userMsg);
  broadcast("chat-message", userMsg);

  // Build args — use --resume to continue existing session, -p for print mode
  const args: string[] = [];
  if (targetSessionId) {
    args.push("--resume", targetSessionId);
  }
  args.push("-p", message);

  // Use the session's project path as cwd so claude can find the session file
  const spawnCwd = discoveredProjectPath && existsSync(discoveredProjectPath)
    ? discoveredProjectPath
    : (project?.projectPath && existsSync(project.projectPath) ? project.projectPath : undefined);

  try {
    const child = spawn("claude", args, {
      cwd: spawnCwd || undefined,
      env: cleanEnvForClaude(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    // Track stderr for error detection
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Capture stdout for response
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("close", (code) => {
      if (code && code !== 0 && stderr) {
        console.error(`[chat] claude exited ${code}: ${stderr.slice(0, 200)}`);
      }

      const content = stdout.trim() || stderr.trim() || `(exited with code ${code})`;
      // Only broadcast stdout response if we DON'T have a chat watcher picking it up
      if (!targetSessionId || !chatWatchers.has(targetSessionId)) {
        const assistantMsg: ChatMessage = {
          id: `msg-${++chatCounter}`,
          role: "assistant",
          content,
          agentName: agent?.displayName || "Claude",
          sessionId: targetSessionId || "neon-chat",
          sessionLabel,
          timestamp: Date.now(),
        };
        chatHistory.push(assistantMsg);
        broadcast("chat-message", assistantMsg);
      }
    });

    // If session-based, also start the JSONL watcher
    if (targetSessionId) {
      watchChatSession(targetSessionId, sessionLabel, agent?.displayName || "Claude");
    }

    // Give it 2 seconds to fail fast (voice-mode pattern)
    setTimeout(() => {
      if (child.exitCode !== null && child.exitCode !== 0) {
        const errMsg: ChatMessage = {
          id: `msg-${++chatCounter}`,
          role: "assistant",
          content: `(Error: ${stderr.trim() || "claude exited with code " + child.exitCode})`,
          agentName: "Claude",
          sessionId: targetSessionId || "neon-chat",
          sessionLabel,
          timestamp: Date.now(),
        };
        chatHistory.push(errMsg);
        broadcast("chat-message", errMsg);
      }
    }, 2000);

    child.unref();
    res.json({ ok: true, id: userMsg.id, mode: targetSessionId ? "session" : "chat" });
  } catch (err: any) {
    console.error("[chat] spawn error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/chat/history", (_req, res) => {
  res.json({ messages: chatHistory.slice(-100) });
});

// ============================================================
// Routes — Session Discovery
// ============================================================

app.get("/api/sessions", async (_req, res) => {
  try {
    const claudeDir = join(homedir(), ".claude", "projects");
    const sessions: Array<{
      projectPath: string;
      projectName: string;
      sessionFiles: string[];
    }> = [];

    let projectDirs: string[] = [];
    try {
      projectDirs = await readdir(claudeDir);
    } catch {
      return res.json({ sessions: [] });
    }

    for (const dir of projectDirs.slice(0, 20)) {
      const projectPath = join(claudeDir, dir);
      const st = await stat(projectPath).catch(() => null);
      if (!st?.isDirectory()) continue;

      // Look for session JSONL files
      const files = await readdir(projectPath).catch(() => [] as string[]);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      if (jsonlFiles.length > 0) {
        // Decode the project name from the directory name
        const projectName = decodeProjectDir(dir);
        sessions.push({
          projectPath: projectName,
          projectName: basename(projectName),
          sessionFiles: jsonlFiles.slice(0, 10),
        });
      }
    }

    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function decodeProjectDir(dirName: string): string {
  // Claude encodes project paths by replacing / with -
  // e.g., "-Users-jeff-myproject" → "/Users/jeff/myproject"
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/** Friendly project name from full path — last 2 segments for context */
function friendlyProjectName(fullPath: string): string {
  const parts = fullPath.split("/").filter(Boolean);
  // Skip home dir prefix, take last 1-2 meaningful segments
  const meaningful = parts.filter((p) => p !== "Users" && p !== homedir().split("/").pop());
  if (meaningful.length <= 1) return meaningful[0] || basename(fullPath);
  return meaningful.slice(-2).join("/");
}

/** Find which project a session file belongs to (returns project name or null) */
function findSessionProject(sessionId: string): { projectName: string; projectPath: string } | null {
  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) return null;

  try {
    const projectDirs = readdirSync(claudeProjects);
    for (const dir of projectDirs) {
      const sessionFile = join(claudeProjects, dir, `${sessionId}.jsonl`);
      if (existsSync(sessionFile)) {
        const decoded = decodeProjectDir(dir);
        return { projectName: friendlyProjectName(decoded), projectPath: decoded };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

// Session color palette for distinguishing sessions in chat
const SESSION_COLORS = [
  "#00f0ff", // cyan
  "#ff6bcb", // pink
  "#39ff14", // green
  "#ffaa00", // orange
  "#b388ff", // purple
  "#ff5252", // red
  "#64ffda", // teal
  "#ffd740", // yellow
];
const sessionColorMap = new Map<string, string>();
function getSessionColor(sessionId: string): string {
  let color = sessionColorMap.get(sessionId);
  if (!color) {
    color = SESSION_COLORS[sessionColorMap.size % SESSION_COLORS.length];
    sessionColorMap.set(sessionId, color);
  }
  return color;
}

/**
 * Active sessions = hook-registered agents (live) + recent session files (last 24h).
 * Each session gets a label like "Claude 1 — myproject" and a color.
 */
app.get("/api/sessions/active", async (_req, res) => {
  try {
    const activeSessions: Array<{
      sessionId: string;
      label: string;
      agentName: string;
      projectName: string;
      projectPath: string;
      status: string;
      lastActivity: number;
      color: string;
      isLive: boolean;
      ideName: string;
    }> = [];

    const seenSessionIds = new Set<string>();

    // 1. Lock-file discovered sessions (highest priority — auto-detected)
    for (const [, session] of discoveredSessions) {
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
        status: agents.get(session.sessionId)?.status || "idle",
        lastActivity: session.lastActivity,
        color: getSessionColor(session.sessionId),
        isLive: true,
        ideName: session.ideName,
      });
    }

    // 2. Hook-registered agents (confirmed live, but may overlap with lock files)
    for (const [id, agent] of agents) {
      if (seenSessionIds.has(id)) continue;
      seenSessionIds.add(id);

      const project = findSessionProject(id);
      const label = project
        ? `${agent.displayName} — ${project.projectName}`
        : agent.displayName;
      activeSessions.push({
        sessionId: id,
        label,
        agentName: agent.displayName,
        projectName: project?.projectName || "unknown",
        projectPath: project?.projectPath || "",
        status: agent.status,
        lastActivity: agent.lastActivity,
        color: getSessionColor(id),
        isLive: true,
        ideName: "Hook",
      });
    }

    // 3. Recent session files (last 24h) not already seen
    const claudeProjects = join(homedir(), ".claude", "projects");
    if (existsSync(claudeProjects)) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const projectDirs = readdirSync(claudeProjects);

      for (const dir of projectDirs.slice(0, 20)) {
        const projectPath = join(claudeProjects, dir);
        try {
          const st = statSync(projectPath);
          if (!st.isDirectory()) continue;

          const files = readdirSync(projectPath)
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => ({
              name: f,
              sessionId: f.replace(".jsonl", ""),
              mtime: statSync(join(projectPath, f)).mtimeMs,
            }))
            .filter((f) => f.mtime > cutoff && !seenSessionIds.has(f.sessionId))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 5);

          const decoded = decodeProjectDir(dir);
          const projName = friendlyProjectName(decoded);

          for (const f of files) {
            seenSessionIds.add(f.sessionId);
            const title = getSessionTitle(f.sessionId);
            activeSessions.push({
              sessionId: f.sessionId,
              label: title ? `${projName}: ${title}` : `Session — ${projName}`,
              agentName: "Claude",
              projectName: projName,
              projectPath: decoded,
              status: "idle",
              lastActivity: f.mtime,
              color: getSessionColor(f.sessionId),
              isLive: false,
              ideName: "Recent",
            });
          }
        } catch {
          continue;
        }
      }
    }

    // Sort: live first, then by last activity
    activeSessions.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.lastActivity - a.lastActivity;
    });

    res.json({ sessions: activeSessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Routes — History (indexed sessions, search, plans, todos)
// ============================================================

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const indexer = new Indexer(DATA_DIR);

// Run initial index in background
indexer.indexAll().then(() => {
  console.log("[Indexer] Initial indexing complete");
  indexer.startWatching();
});

app.get("/api/history/projects", (_req, res) => {
  try {
    const projects = indexer.getProjects();
    res.json({ projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/sessions", (req, res) => {
  try {
    const projectId = req.query.project ? Number(req.query.project) : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const sessions = indexer.getSessions(projectId, limit, offset);
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/sessions/:id", (req, res) => {
  try {
    const messages = indexer.getSessionMessages(req.params.id);
    const fileChanges = indexer.getFileChanges(req.params.id);
    res.json({ messages, fileChanges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/search", (req, res) => {
  try {
    const query = String(req.query.q || "");
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const results = indexer.search(query, limit);
    res.json({ results, query });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/plans", (req, res) => {
  try {
    const projectId = req.query.project ? Number(req.query.project) : undefined;
    const plans = indexer.getPlans(projectId);
    res.json({ plans });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/todos", (_req, res) => {
  try {
    const todos = indexer.getTodos();
    res.json({ todos });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/stats", (_req, res) => {
  try {
    const stats = indexer.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Routes — Stats (combined live + indexed data)
// ============================================================

app.get("/api/stats", (_req, res) => {
  try {
    const basic = indexer.getStats();
    const tokens = indexer.getTokenStats();
    res.json({
      activeAgents: agents.size,
      totalProjects: basic.projects,
      totalSessions: basic.sessions,
      totalMessages: basic.messages,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      estimatedCost: tokens.estimatedCost,
      tokens24h: tokens.tokens24h,
      activeSessions: tokens.activeSessions,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast stats to all clients every 10 seconds
setInterval(() => {
  try {
    const basic = indexer.getStats();
    const tokens = indexer.getTokenStats();
    broadcast("stats", {
      activeAgents: agents.size,
      totalProjects: basic.projects,
      totalSessions: basic.sessions,
      totalMessages: basic.messages,
      totalTokens: tokens.totalTokens,
      estimatedCost: tokens.estimatedCost,
      tokens24h: tokens.tokens24h,
    });
  } catch {
    // Silent
  }
}, 10_000);

// ============================================================
// Routes — All Known Projects
// ============================================================

app.get("/api/projects", (_req, res) => {
  try {
    const claudeProjects = join(homedir(), ".claude", "projects");
    if (!existsSync(claudeProjects)) return res.json({ projects: [] });

    const projectDirs = readdirSync(claudeProjects);
    const projects: Array<{ name: string; path: string; lastActivity: number }> = [];
    const seenPaths = new Set<string>();

    for (const dir of projectDirs) {
      const fullDir = join(claudeProjects, dir);
      try {
        const st = statSync(fullDir);
        if (!st.isDirectory()) continue;

        const decoded = decodeProjectDir(dir);
        if (seenPaths.has(decoded)) continue;
        seenPaths.add(decoded);

        // Find most recent .jsonl file for last activity time
        let lastActivity = st.mtimeMs;
        try {
          const files = readdirSync(fullDir).filter((f) => f.endsWith(".jsonl"));
          for (const f of files) {
            const fstat = statSync(join(fullDir, f));
            if (fstat.mtimeMs > lastActivity) lastActivity = fstat.mtimeMs;
          }
        } catch { /* ignore */ }

        const name = friendlyProjectName(decoded);
        projects.push({ name, path: decoded, lastActivity });
      } catch {
        continue;
      }
    }

    // Sort by last activity (most recent first)
    projects.sort((a, b) => b.lastActivity - a.lastActivity);
    res.json({ projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/create", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name required" });
  }

  // Sanitize: only allow alphanumeric, dashes, underscores, dots
  const safeName = name.trim().replace(/[^a-zA-Z0-9\-_.]/g, "-").replace(/-+/g, "-");
  if (!safeName) return res.status(400).json({ error: "invalid name" });

  const projectDir = join(homedir(), "Projects", safeName);

  try {
    if (existsSync(projectDir)) {
      return res.json({ ok: true, path: projectDir, created: false });
    }
    mkdirSync(projectDir, { recursive: true });
    res.json({ ok: true, path: projectDir, created: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Routes — Agent Spawning
// ============================================================

const spawnedProcesses = new Map<string, ChildProcess>();

app.post("/api/spawn", (req, res) => {
  const { prompt, projectPath } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const args = ["-p", prompt];
    const cwd = projectPath || process.cwd();

    const child = spawn("claude", args, {
      cwd,
      env: cleanEnvForClaude(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      spawnedProcesses.delete(spawnId);
      broadcast("spawn-complete", {
        spawnId,
        code,
        output: output.slice(0, 2000),
      });
    });

    child.unref();
    spawnedProcesses.set(spawnId, child);

    // Notify all clients
    broadcast("spawn-started", {
      spawnId,
      prompt: prompt.slice(0, 100),
      projectPath: cwd,
    });

    res.json({ ok: true, spawnId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spawn/active", (_req, res) => {
  const active = Array.from(spawnedProcesses.entries()).map(([id, p]) => ({
    spawnId: id,
    pid: p.pid,
  }));
  res.json({ active });
});

app.post("/api/history/reindex", async (_req, res) => {
  try {
    await indexer.indexAll();
    const stats = indexer.getStats();
    res.json({ ok: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Routes — General
// ============================================================

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    agents: agents.size,
    clients: clients.size,
    notifications: notifications.filter((n) => !n.resolved).length,
    uptime: process.uptime(),
  });
});

app.get("/api/agents", (_req, res) => {
  res.json({ agents: Array.from(agents.values()) });
});

// ============================================================
// TTS — Proxy to Python Kokoro worker
// ============================================================

const TTS_PORT = parseInt(process.env.TTS_PORT || "5175");
const MODELS_DIR = process.env.KOKORO_MODELS || join(homedir(), "voice_mode", "models");
let ttsWorker: ChildProcess | null = null;
let ttsReady = false;

// Curated voice list — each agent gets a unique voice
const VOICE_POOL = [
  "af_heart",    // warm female
  "am_fenrir",   // deep male
  "af_jessica",  // clear female
  "am_adam",     // neutral male
  "bf_emma",     // british female
  "bm_george",   // british male
  "af_sarah",    // soft female
  "am_michael",  // strong male
  "af_nicole",   // bright female
  "am_liam",     // calm male
];

const agentVoiceMap = new Map<string, string>();

function getVoiceForAgent(agentId: string): string {
  let voice = agentVoiceMap.get(agentId);
  if (!voice) {
    const usedVoices = new Set(agentVoiceMap.values());
    voice = VOICE_POOL.find((v) => !usedVoices.has(v)) || VOICE_POOL[agentVoiceMap.size % VOICE_POOL.length];
    agentVoiceMap.set(agentId, voice);
  }
  return voice;
}

async function startTTSWorker() {
  if (ttsWorker) return;

  const workerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "tts",
    "tts-worker.py"
  );

  if (!existsSync(workerPath)) {
    console.log("TTS worker script not found, voice disabled");
    return;
  }

  if (!existsSync(join(MODELS_DIR, "kokoro-v1.0.onnx"))) {
    console.log(`Kokoro models not found at ${MODELS_DIR}, voice disabled`);
    return;
  }

  // Check if a TTS worker is already running on the port (from a previous session)
  try {
    const healthRes = await fetch(`http://localhost:${TTS_PORT}/health`);
    if (healthRes.ok) {
      console.log(`[TTS] Existing TTS worker found on port ${TTS_PORT}, reusing`);
      ttsReady = true;
      return;
    }
  } catch {
    // No existing worker — spawn a new one
  }

  console.log("Starting TTS worker...");

  // Use venv python if available, else system python3
  const venvPython = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".venv", "bin", "python3");
  const pythonBin = existsSync(venvPython) ? venvPython : "python3";

  ttsWorker = spawn(pythonBin, [workerPath, "--port", String(TTS_PORT), "--models-dir", MODELS_DIR], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  ttsWorker.stdout?.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    console.log(`[TTS] ${msg}`);
    if (msg.includes("Kokoro loaded")) {
      ttsReady = true;
    }
  });

  ttsWorker.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[TTS err] ${chunk.toString().trim()}`);
  });

  ttsWorker.on("close", (code) => {
    console.log(`TTS worker exited (code ${code})`);
    ttsWorker = null;
    ttsReady = false;
  });

  // Give it a moment then mark ready (model loads lazily on first request)
  setTimeout(() => {
    if (ttsWorker) ttsReady = true;
  }, 2000);
}

// TTS proxy endpoint
app.post("/api/tts", async (req, res) => {
  const { text, voice, speed, agentId } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  // Belt-and-suspenders: refuse TTS synthesis when voice is globally disabled.
  // The primary guard is on the client (enabledRef), but this stops any
  // in-flight requests that were queued before the mute flag flipped.
  if (!voiceEnabled) {
    return res.status(403).json({ error: "voice disabled" });
  }

  if (!ttsReady) {
    return res.status(503).json({ error: "TTS not ready" });
  }

  const selectedVoice = voice || (agentId ? getVoiceForAgent(agentId) : "af_heart");

  try {
    const ttsRes = await fetch(`http://localhost:${TTS_PORT}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: selectedVoice, speed: speed || 1.1 }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.json().catch(() => ({ error: "TTS failed" }));
      return res.status(500).json(err);
    }

    const wavBuffer = Buffer.from(await ttsRes.arrayBuffer());
    res.set("Content-Type", "audio/wav");
    res.set("Content-Length", String(wavBuffer.length));
    res.send(wavBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tts/voices", async (_req, res) => {
  try {
    const ttsRes = await fetch(`http://localhost:${TTS_PORT}/voices`);
    const data = await ttsRes.json();
    res.json({
      ...data,
      pool: VOICE_POOL,
      assignments: Object.fromEntries(agentVoiceMap),
    });
  } catch {
    res.json({ voices: [], pool: VOICE_POOL, assignments: {} });
  }
});

app.post("/api/tts/assign", (req, res) => {
  const { agentId, voice } = req.body;
  if (!agentId || !voice) return res.status(400).json({ error: "agentId and voice required" });
  agentVoiceMap.set(agentId, voice);
  res.json({ ok: true, agentId, voice });
});

// ============================================================
// Chat — Session JSONL watcher (fire-and-forget response pickup)
// ============================================================

const chatWatchers = new Map<string, ReturnType<typeof setInterval>>();

/** Watch a Claude session JSONL file for ALL messages (user + assistant) and broadcast as chat.
 *  This is how messages from Cursor/VSCode Claude sessions flow into the Neon City chat panel. */
function watchChatSession(sessionId: string, sessionLabel: string, agentName: string) {
  if (chatWatchers.has(sessionId)) return; // already watching

  // Find the session file
  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) return;

  let sessionFile: string | null = null;
  try {
    const projectDirs = readdirSync(claudeProjects);
    for (const dir of projectDirs) {
      const candidate = join(claudeProjects, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        sessionFile = candidate;
        break;
      }
    }
  } catch {
    return;
  }

  if (!sessionFile) {
    console.log(`[chat-watch] Session file not found for ${sessionId}`);
    return;
  }

  // Start from end of file (only read NEW entries)
  let offset = statSync(sessionFile).size;
  console.log(`[chat-watch] Watching ${sessionFile} (offset: ${offset})`);

  const interval = setInterval(async () => {
    try {
      const currentSize = statSync(sessionFile!).size;
      if (currentSize <= offset) return;

      // Read new content
      const stream = createReadStream(sessionFile!, { start: offset });
      const rl = createInterface({ input: stream });
      const newLines: string[] = [];
      for await (const line of rl) {
        newLines.push(line);
      }
      offset = currentSize;

      // Parse JSONL for user AND assistant messages
      // Claude JSONL uses type "user" for user msgs, type "assistant" for assistant msgs
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line);
          const role = entry.type === "user" ? "user"
            : entry.type === "assistant" ? "assistant"
            : entry.message?.role;
          if (role !== "assistant" && role !== "user") continue;
          if (!entry.message?.content) continue;

          // Extract text content
          let text = "";
          const content = entry.message.content;
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n");
          }

          // Detect tool_use blocks in assistant messages
          if (role === "assistant" && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use" && block.name && block.id) {
                const actId = `tool-${++toolActivityCounter}`;
                const activity: ToolActivity = {
                  id: actId,
                  toolUseId: block.id,
                  agentId: sessionId,
                  agentName,
                  sessionId,
                  toolName: block.name,
                  toolInput: summarizeToolInput(block.name, block.input),
                  status: "running",
                  startedAt: Date.now(),
                };
                toolActivities.set(block.id, activity);
                if (toolActivities.size > 200) {
                  const oldest = toolActivities.keys().next().value;
                  if (oldest) toolActivities.delete(oldest);
                }
                broadcast("tool-activity", activity);
              }
            }
          }

          // Detect tool_result blocks in user messages
          if (role === "user" && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result" && block.tool_use_id) {
                const tracked = toolActivities.get(block.tool_use_id);
                if (tracked) {
                  tracked.status = block.is_error ? "error" : "complete";
                  tracked.completedAt = Date.now();
                  if (block.is_error) {
                    tracked.error = typeof block.content === "string"
                      ? block.content.slice(0, 200)
                      : "Tool returned error";
                  }
                  broadcast("tool-activity", tracked);
                }
              }
            }
          }

          if (!text) continue;

          // Skip if this message was already sent via chat panel (avoid dupes)
          const isDupe = chatHistory.some(
            (m) => m.sessionId === sessionId && m.role === role
              && m.content === text && Date.now() - m.timestamp < 5000
          );
          if (isDupe) continue;

          // Broadcast as chat message
          const chatMsg: ChatMessage = {
            id: `msg-${++chatCounter}`,
            role: role as "user" | "assistant",
            content: text,
            agentId: sessionId,
            agentName: role === "assistant" ? agentName : undefined,
            sessionId,
            sessionLabel,
            timestamp: Date.now(),
          };
          chatHistory.push(chatMsg);
          broadcast("chat-message", chatMsg);
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // File might not exist yet or be locked
    }
  }, 100); // Poll every 100ms for responsive chat

  chatWatchers.set(sessionId, interval);

  // Auto-cleanup after 2 hours (matches voice watcher lifetime)
  setTimeout(() => {
    clearInterval(interval);
    chatWatchers.delete(sessionId);
    console.log(`[chat-watch] Stopped watching ${sessionId}`);
  }, 7_200_000);
}

// ============================================================
// Voice — Session file watcher (detect assistant messages)
// ============================================================

const watchedSessions = new Map<string, { offset: number }>();
const recentVoiceTexts = new Map<string, number>(); // text hash → timestamp (dedup)
let voiceEnabled = false; // Off by default — user enables via Chat panel mute button

function splitSentences(text: string): string[] {
  // Strip markdown
  let clean = text
    .replace(/```[\s\S]*?```/g, "")          // code blocks
    .replace(/`[^`]+`/g, "")                  // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links
    .replace(/#{1,6}\s+/g, "")                // headers
    .replace(/\*\*([^*]+)\*\*/g, "$1")        // bold
    .replace(/\*([^*]+)\*/g, "$1")            // italic
    .replace(/^[-*]\s+/gm, "")               // lists
    .replace(/^\d+\.\s+/gm, "")              // numbered lists
    .trim();

  if (!clean) return [];

  // Split on sentence boundaries
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 500);
}

function watchSessionFile(filePath: string, agentId: string) {
  if (watchedSessions.has(filePath)) return;

  const fileSize = existsSync(filePath) ? statSync(filePath).size : 0;
  watchedSessions.set(filePath, { offset: fileSize });

  const checkInterval = setInterval(async () => {
    try {
      const currentSize = statSync(filePath).size;
      const state = watchedSessions.get(filePath);
      if (!state || currentSize <= state.offset) return;

      // Always advance the offset, even when voice is disabled, so that
      // messages accumulated while muted are NOT broadcast when voice is
      // re-enabled later.
      if (!voiceEnabled) {
        state.offset = currentSize;
        return;
      }

      // Read new content
      const stream = createReadStream(filePath, { start: state.offset });
      const rl = createInterface({ input: stream });
      const newLines: string[] = [];

      for await (const line of rl) {
        newLines.push(line);
      }

      state.offset = currentSize;

      // Parse JSONL for assistant messages
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line);
          if (!entry.message || entry.message.role !== "assistant") continue;

          // Extract text content
          let text = "";
          const content = entry.message.content;
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join(" ");
          }

          if (!text) continue;

          // Deduplicate: skip if we spoke very similar text recently
          const textKey = `${agentId}:${text.slice(0, 100)}`;
          const lastSpoken = recentVoiceTexts.get(textKey);
          if (lastSpoken && Date.now() - lastSpoken < 10_000) continue;

          // Summarize long responses — only speak first 2 sentences
          const sentences = splitSentences(text);
          const toSpeak = sentences.slice(0, 3);

          if (toSpeak.length > 0) {
            recentVoiceTexts.set(textKey, Date.now());
            // Clean old entries
            for (const [k, t] of recentVoiceTexts) {
              if (Date.now() - t > 30_000) recentVoiceTexts.delete(k);
            }

            broadcast("voice-message", {
              agentId,
              agentName: agents.get(agentId)?.displayName || "Claude",
              text: toSpeak.join(" "),
              sentences: toSpeak,
              voice: getVoiceForAgent(agentId),
            });
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // File might not exist yet
    }
  }, 500);

  // Clean up after 2 hours
  setTimeout(() => {
    clearInterval(checkInterval);
    watchedSessions.delete(filePath);
  }, 7_200_000);
}

app.post("/api/voice/toggle", (req, res) => {
  voiceEnabled = !voiceEnabled;
  // Start TTS worker on-demand when voice is first enabled
  if (voiceEnabled && !ttsReady) {
    startTTSWorker();
  }
  broadcast("voice-toggle", { enabled: voiceEnabled });
  res.json({ enabled: voiceEnabled });
});

app.get("/api/voice/status", (_req, res) => {
  res.json({
    enabled: voiceEnabled,
    ttsReady,
    watchedSessions: watchedSessions.size,
    voiceAssignments: Object.fromEntries(agentVoiceMap),
  });
});

// Auto-watch session files for known agents
function maybeWatchAgent(agentId: string) {
  // Try to find this agent's session file
  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) return;

  // The agentId from hooks IS the session_id, which matches the JSONL filename
  try {
    const projectDirs = readdirSync(claudeProjects);
    for (const dir of projectDirs) {
      const sessionFile = join(claudeProjects, dir, `${agentId}.jsonl`);
      if (existsSync(sessionFile)) {
        // Watch for voice (TTS)
        watchSessionFile(sessionFile, agentId);

        // Watch for chat — stream all messages to the chat panel
        const agent = agents.get(agentId);
        const project = findSessionProject(agentId);
        const label = project
          ? `${agent?.displayName || "Claude"} — ${project.projectName}`
          : agent?.displayName || "Claude";
        watchChatSession(agentId, label, agent?.displayName || "Claude");
        return;
      }
    }
  } catch {
    // Ignore
  }
}

// ============================================================
// Weather — project health → weather state
// ============================================================

type WeatherState = "clear" | "fog" | "rain" | "storm" | "snow" | "aurora";

interface WeatherInfo {
  state: WeatherState;
  reason: string;
  lastCheck: number;
}

let currentWeather: WeatherInfo = {
  state: "clear",
  reason: "Default — all clear",
  lastCheck: Date.now(),
};

function computeWeather(): WeatherInfo {
  const now = Date.now();
  const agentList = Array.from(agents.values());

  // If no agents at all → clear
  if (agentList.length === 0) {
    return { state: "clear", reason: "No agents active", lastCheck: now };
  }

  // All agents idle? → snow (peaceful)
  const allIdle = agentList.every(
    (a) => a.status === "idle" && !a.waitingForApproval
  );
  if (allIdle) {
    return { state: "snow", reason: "All agents resting", lastCheck: now };
  }

  // Any agent stuck / waiting for approval? → rain
  const stuckCount = agentList.filter(
    (a) => a.status === "stuck" || a.waitingForApproval
  ).length;

  if (stuckCount >= 2) {
    return {
      state: "storm",
      reason: `${stuckCount} agents stuck — storm!`,
      lastCheck: now,
    };
  }

  if (stuckCount === 1) {
    return {
      state: "rain",
      reason: "Agent waiting for approval",
      lastCheck: now,
    };
  }

  // Many agents writing simultaneously → aurora (busy deploy)
  const writingCount = agentList.filter((a) => a.status === "writing").length;
  if (writingCount >= 3) {
    return {
      state: "aurora",
      reason: `${writingCount} agents writing — deploy in progress`,
      lastCheck: now,
    };
  }

  // Many agents thinking → fog (processing)
  const thinkingCount = agentList.filter((a) => a.status === "thinking").length;
  if (thinkingCount >= 2) {
    return {
      state: "fog",
      reason: `${thinkingCount} agents thinking`,
      lastCheck: now,
    };
  }

  // Default: clear
  return { state: "clear", reason: "Normal operations", lastCheck: now };
}

// Recompute weather every 3 seconds and broadcast changes
setInterval(() => {
  const prev = currentWeather.state;
  currentWeather = computeWeather();
  if (currentWeather.state !== prev) {
    broadcast("weather", currentWeather);
  }
}, 3000);

app.get("/api/weather", (_req, res) => {
  res.json(currentWeather);
});

app.post("/api/weather/set", (req, res) => {
  const { state, reason } = req.body;
  const valid: WeatherState[] = ["clear", "fog", "rain", "storm", "snow", "aurora"];
  if (!valid.includes(state)) {
    return res.status(400).json({ error: "Invalid weather state" });
  }
  currentWeather = { state, reason: reason || "Manual override", lastCheck: Date.now() };
  broadcast("weather", currentWeather);
  res.json(currentWeather);
});

// ============================================================
// Idle cleanup
// ============================================================

setInterval(() => {
  const now = Date.now();
  for (const [id, agent] of agents) {
    if (now - agent.lastActivity > 120_000) {
      agents.delete(id);
      broadcast("agent-removed", { agentId: id });
    } else if (
      now - agent.lastActivity > 30_000 &&
      agent.status !== "idle" &&
      !agent.waitingForApproval
    ) {
      agent.status = "idle";
      agent.currentCommand = undefined;
      agent.toolInput = undefined;
      broadcast("thinking", { agents: Array.from(agents.values()) });
    }
  }
}, 5_000);

// ============================================================
// Start
// ============================================================

const PORT = parseInt(process.env.PORT || "5174");
server.listen(PORT, () => {
  console.log(`Neon City server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);

  // TTS worker starts on-demand when voice is first enabled (not on boot)
  // startTTSWorker();

  // Start session discovery scanners
  scanLockFiles();
  setInterval(scanLockFiles, 3000);
  setInterval(scanTerminalSessions, 10000);
});

// Clean shutdown
process.on("SIGINT", () => {
  indexer.stopWatching();
  ttsWorker?.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  indexer.stopWatching();
  ttsWorker?.kill();
  process.exit(0);
});
