import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename, dirname, resolve, extname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { createReadStream, existsSync, statSync, readdirSync, mkdirSync } from "fs";
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
  agentKind: "session" | "subagent";   // session = IDE/terminal, subagent = spawned
  agentType?: string;                   // "frontend-developer", "debugger", etc.
  spawnId?: string;                     // links back to spawn process
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

function agentTypeFriendlyName(agentType: string): string {
  const map: Record<string, string> = {
    "frontend-developer": "Frontend Dev",
    "backend-developer": "Backend Dev",
    "mobile-developer": "Mobile Dev",
    "mobile-app-developer": "Mobile App Dev",
    "ui-designer": "UI Designer",
    "database-administrator": "DBA",
    "ai-engineer": "AI Engineer",
    "security-engineer": "Security Eng",
    "security-auditor": "Security Auditor",
    "debugger": "Debugger",
    "code-reviewer": "Code Reviewer",
    "data-analyst": "Data Analyst",
    "seo-specialist": "SEO Specialist",
    "content-marketer": "Content Marketer",
    "business-analyst": "Business Analyst",
    "project-manager": "Project Manager",
    "multi-agent-coordinator": "Coordinator",
    "general-purpose": "General",
    "Explore": "Explorer",
    "Plan": "Planner",
  };
  return map[agentType] || agentType;
}

const agents = new Map<string, AgentState>();
const clients = new Set<WebSocket>();
const notifications: Notification[] = [];
const chatHistory: ChatMessage[] = [];
let notifCounter = 0;
let chatCounter = 0;
const sessionToSpawnId = new Map<string, string>(); // JSONL sessionId → spawnId
// Subagent agent_ids that haven't been linked to a session_id yet (from PreToolUse).
// When SubagentStart fires, we add the agent_id. When PreToolUse fires with an unknown
// session_id, we adopt the oldest unlinked subagent instead of creating a duplicate.
const unlinkedSubagents: string[] = [];
// Per-agent debounced idle timers — keeps working status visible for minimum duration
const agentIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

// Tool classification sets (shared across hooks and legacy routes)
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Search"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

// ============================================================
// Shared helpers for hooks and routes
// ============================================================

/** Clear a pending idle timer for an agent */
function clearIdleTimer(agentId: string) {
  clearTimeout(agentIdleTimers.get(agentId));
  agentIdleTimers.delete(agentId);
}

/** Schedule a debounced idle transition (2s) after a tool completes */
function scheduleDebouncedIdle(agentId: string) {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.lastActivity = Date.now();
  const completedTool = agent.currentCommand;
  clearIdleTimer(agentId);
  agentIdleTimers.set(agentId, setTimeout(() => {
    agentIdleTimers.delete(agentId);
    const a = agents.get(agentId);
    if (a && (a.currentCommand === completedTool || !a.currentCommand)) {
      a.currentCommand = undefined;
      a.toolInput = undefined;
      a.status = "idle";
      a.lastActivity = Date.now();
      broadcastThrottled("activity", { agent: a });
    }
  }, 2000));
}

/** Push a notification, cap at 200, and broadcast */
function pushNotification(
  fields: Omit<Notification, "id" | "timestamp" | "resolved">,
  broadcastExtras?: Record<string, unknown>
): Notification {
  const notif: Notification = {
    ...fields,
    id: `notif-${++notifCounter}`,
    timestamp: Date.now(),
    resolved: false,
  };
  notifications.push(notif);
  if (notifications.length > 200) notifications.splice(0, notifications.length - 200);
  broadcast("notification", broadcastExtras ? { ...notif, ...broadcastExtras } : notif);
  return notif;
}

/** Push a chat message, cap at 500, and broadcast */
function pushChatMessage(msg: ChatMessage) {
  chatHistory.push(msg);
  if (chatHistory.length > 500) chatHistory.splice(0, chatHistory.length - 500);
  broadcast("chat-message", msg);
}

/** Resolve an agent's display name with fallback */
function agentDisplayName(agentId: string | undefined, fallback = "Claude"): string {
  return agents.get(agentId || "")?.displayName || fallback;
}

// ============================================================
// Session Discovery
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

// ============================================================
// WebSocket
// ============================================================

wss.on("connection", (ws) => {
  clients.add(ws);

  // Compute stats eagerly so the client never has to wait for the 10-second
  // broadcast interval to see token usage and session counts.
  let initStats: Record<string, unknown> = {};
  try {
    const basic = indexer.getStats();
    const tokens = indexer.getTokenStats();
    initStats = {
      activeAgents: agents.size,
      totalProjects: basic.projects,
      totalSessions: basic.sessions,
      totalMessages: basic.messages,
      totalTokens: tokens.totalTokens,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      estimatedCost: tokens.estimatedCost,
      tokens24h: tokens.tokens24h,
      activeSessions: tokens.activeSessions,
    };
  } catch {
    // Non-fatal — client will get stats on the next periodic broadcast
  }

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
        stats: initStats,
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
      if (pendingBroadcasts.size === 0) {
        clearInterval(broadcastTimer!);
        broadcastTimer = null;
        return;
      }
      for (const [t, d] of pendingBroadcasts) {
        broadcast(t, d);
      }
      pendingBroadcasts.clear();
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
    if (agents.size >= 30) return null;

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
      agentKind: "session",
    };
    agents.set(agentId, agent);
    // Try to watch this agent's session file for voice
    maybeWatchAgent(agentId).catch(() => {});
  }
  return agent;
}

function findAgentBySessionId(sessionId: string): string | undefined {
  if (agents.has(sessionId)) return sessionId;
  const prefixed = `session-${sessionId}`;
  if (agents.has(prefixed)) return prefixed;
  const mapped = sessionToSpawnId.get(sessionId);
  if (mapped && agents.has(mapped)) return mapped;
  return undefined;
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

  let agent = agents.get(agentId);
  // If this agentId is a session ID that maps to a spawned agent, use that
  if (!agent) {
    const mappedSpawnId = sessionToSpawnId.get(agentId);
    if (mappedSpawnId) agent = agents.get(mappedSpawnId);
  }
  const agentName = agent?.displayName || "Unknown Agent";

  // Mark agent as waiting
  if (agent && type === "approval-needed") {
    agent.waitingForApproval = true;
    agent.status = "stuck";
  }

  const notif = pushNotification({
    type: type || "info",
    agentId,
    agentName,
    toolName,
    description: description || "",
  });
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
const approvalResolvers = new Map<string, (decision: string, updatedInput?: any) => void>();
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

  let agent = agents.get(agentId);
  // If this agentId is a session ID that maps to a spawned agent, use that
  if (!agent) {
    const mappedSpawnId = sessionToSpawnId.get(agentId);
    if (mappedSpawnId) agent = agents.get(mappedSpawnId);
  }
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
  pushNotification({
    type: "approval-needed",
    agentId,
    agentName,
    toolName,
    description: description || `${toolName}: ${(toolInput || "").slice(0, 100)}`,
  }, { approvalId: id });

  res.json({ id, status: "pending" });
});

app.post("/api/approval/:id/decide", (req, res) => {
  const { id } = req.params;
  const { decision } = req.body;

  // Check if this is a hooks-based approval (PermissionRequest hook)
  const resolver = approvalResolvers.get(id);
  if (resolver) {
    resolver(decision, req.body.updatedInput);
    res.json({ ok: true, id, decision });
    return;
  }

  const request = approvalRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  if (request.status !== "pending") {
    return res.json({ id: request.id, status: request.status });
  }

  const { approveAll } = req.body;
  request.status = decision === "approve" ? "approved" : "denied";

  if (approveAll && decision === "approve") {
    autoApproveTools.add(request.toolName);
  }

  let agent = agents.get(request.agentId);
  // If this agentId is a session ID that maps to a spawned agent, use that
  if (!agent) {
    const mappedSpawnId = sessionToSpawnId.get(request.agentId);
    if (mappedSpawnId) agent = agents.get(mappedSpawnId);
  }
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
// Routes — Claude Code Hooks (native event-driven integration)
// ============================================================

// Hook 1: Session Start
app.post("/api/hooks/session-start", (req, res) => {
  const { session_id, cwd } = req.body;
  const projectName = friendlyProjectName(cwd || "unknown");
  const agentId = `session-${session_id}`;

  // Idempotent: update if exists
  const existing = agents.get(agentId);
  if (existing) {
    existing.lastActivity = Date.now();
    broadcast("activity", { agent: existing });
    res.json({});
    return;
  }

  discoveredSessions.set(`hook-${session_id}`, {
    sessionId: session_id,
    pid: 0,
    workspaceFolders: [cwd || ""],
    ideName: "Claude Code",
    projectName,
    projectPath: cwd || "",
    title: null,
    lastActivity: Date.now(),
  });

  const newAgent: AgentState = {
    agentId,
    displayName: projectName,
    source: "claude",
    isThinking: false,
    lastActivity: Date.now(),
    status: "idle",
    waitingForApproval: false,
    agentKind: "session",
  };
  agents.set(agentId, newAgent);

  broadcast("activity", { agent: newAgent });
  res.json({});
});

// Hook 2: Session End
app.post("/api/hooks/session-end", (req, res) => {
  const { session_id } = req.body;
  const agentId = findAgentBySessionId(session_id) || `session-${session_id}`;

  agents.delete(agentId);
  discoveredSessions.delete(`hook-${session_id}`);
  clearIdleTimer(agentId);

  // Stop any JSONL watcher for this session
  const watcher = chatWatchers.get(session_id);
  if (watcher) {
    clearInterval(watcher);
    chatWatchers.delete(session_id);
  }

  broadcast("agent-removed", { agentId });
  res.json({});
});

// Hook 3: Pre Tool Use
app.post("/api/hooks/pre-tool-use", (req, res) => {
  const { session_id, tool_name, tool_input, tool_use_id, cwd } = req.body;
  let agentId = findAgentBySessionId(session_id);

  // Auto-create agent if not found (hook may fire before session-start)
  if (!agentId) {
    // Check if this is a subagent whose session_id we haven't seen yet.
    // Adopt the oldest unlinked subagent instead of creating a duplicate.
    const unlinkedId = unlinkedSubagents.length > 0 ? unlinkedSubagents.shift()! : null;
    if (unlinkedId && agents.has(unlinkedId)) {
      agentId = unlinkedId;
      // Map this session_id → subagent so future hooks find it
      sessionToSpawnId.set(session_id, unlinkedId);
    } else {
      agentId = `session-${session_id}`;
      const projectName = cwd ? friendlyProjectName(cwd) : "Claude";
      agents.set(agentId, {
        agentId,
        displayName: projectName,
        source: "claude",
        isThinking: false,
        lastActivity: Date.now(),
        status: "idle",
        waitingForApproval: false,
        agentKind: "session",
      });
    }
  }

  const agent = agents.get(agentId);
  if (!agent) { res.json({}); return; }

  // Cancel pending idle timer
  clearIdleTimer(agentId);

  // Map tool to status
  if (READ_TOOLS.has(tool_name)) {
    agent.status = "reading";
  } else if (WRITE_TOOLS.has(tool_name)) {
    agent.status = "writing";
  } else {
    agent.status = "thinking";
  }

  agent.currentCommand = tool_name;
  agent.toolInput = summarizeToolInput(tool_name, tool_input || {});
  agent.lastActivity = Date.now();
  agent.isThinking = false;

  // Track tool activity
  const activityId = `tool-${++toolActivityCounter}`;
  toolActivities.set(tool_use_id, {
    id: activityId,
    toolUseId: tool_use_id,
    agentId,
    agentName: agent.displayName,
    sessionId: session_id,
    toolName: tool_name,
    toolInput: agent.toolInput || tool_name,
    status: "running",
    startedAt: Date.now(),
  });
  if (toolActivities.size > 200) {
    // Prefer evicting completed/errored entries over running ones
    let evictKey: string | undefined;
    for (const [key, act] of toolActivities) {
      if (act.status !== "running") { evictKey = key; break; }
    }
    if (!evictKey) evictKey = toolActivities.keys().next().value;
    if (evictKey) toolActivities.delete(evictKey);
  }

  // Immediate broadcast (not throttled) — tool-start is high-signal
  broadcast("activity", { agent });
  broadcast("tool-activity", toolActivities.get(tool_use_id));
  res.json({});
});

// Hook 4: Post Tool Use
app.post("/api/hooks/post-tool-use", (req, res) => {
  const { session_id, tool_use_id } = req.body;
  const agentId = findAgentBySessionId(session_id);

  // Update tool activity
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "complete";
    activity.completedAt = Date.now();
    broadcast("tool-activity", activity);
  }

  // Debounced idle transition (2s)
  if (agentId) scheduleDebouncedIdle(agentId);

  res.json({});
});

// Hook 5: Post Tool Use Failure
app.post("/api/hooks/post-tool-use-failure", (req, res) => {
  const { session_id, tool_name, tool_use_id, error } = req.body;
  const agentId = findAgentBySessionId(session_id);
  // Update tool activity
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "error";
    activity.error = typeof error === "string" ? error : JSON.stringify(error);
    activity.completedAt = Date.now();
    broadcast("tool-activity", activity);
  }

  // Create error notification
  pushNotification({
    type: "error",
    agentId: agentId || session_id,
    agentName: agentDisplayName(agentId),
    toolName: tool_name,
    description: `${tool_name} failed: ${(typeof error === "string" ? error : "Unknown error").slice(0, 200)}`,
  });

  // Debounced idle transition (same as post-tool-use)
  if (agentId) scheduleDebouncedIdle(agentId);

  res.json({});
});

// Hook 6: PermissionRequest intentionally excluded from setup.js — it blocks tool
// execution until the Neon City UI approves, which deadlocks if the UI is unavailable.
// The endpoint is removed to avoid dead code. Re-add if an opt-in mechanism is built.

// Hook 7: Subagent Start
app.post("/api/hooks/subagent-start", (req, res) => {
  const { session_id: _session_id, agent_id, agent_type } = req.body;
  const displayName = agentTypeFriendlyName(agent_type || "General");
  const agentId = agent_id || `subagent-${Date.now()}`;

  const newAgent: AgentState = {
    agentId,
    displayName,
    source: "claude",
    isThinking: false,
    lastActivity: Date.now(),
    status: "walking",
    waitingForApproval: false,
    agentKind: "subagent",
    agentType: agent_type,
  };
  agents.set(agentId, newAgent);

  // Track as unlinked — will be adopted when PreToolUse fires with its session_id
  unlinkedSubagents.push(agentId);

  broadcast("activity", { agent: newAgent });
  res.json({});
});

// Hook 8: Subagent Stop
app.post("/api/hooks/subagent-stop", (req, res) => {
  const { agent_id, agent_type, last_assistant_message } = req.body;
  const agentId = agent_id;
  const agentName = agents.get(agentId)?.displayName || agentTypeFriendlyName(agent_type || "Agent");

  // Create completion notification
  pushNotification({
    type: "task-complete",
    agentId: agentId || "unknown",
    agentName,
    description: (typeof last_assistant_message === "string" ? last_assistant_message : "")?.slice(0, 200) || "Agent completed its task",
  });

  // Remove agent and clean up mappings
  agents.delete(agentId);
  clearIdleTimer(agentId);
  const unlinkedIdx = unlinkedSubagents.indexOf(agentId);
  if (unlinkedIdx !== -1) unlinkedSubagents.splice(unlinkedIdx, 1);
  // Clean up sessionToSpawnId reverse mapping
  for (const [sid, aid] of sessionToSpawnId) {
    if (aid === agentId) { sessionToSpawnId.delete(sid); break; }
  }
  broadcast("agent-removed", { agentId });

  res.json({});
});

// Hook 9: Stop (Claude finished responding)
app.post("/api/hooks/stop", (req, res) => {
  const { session_id, last_assistant_message } = req.body;
  const agentId = findAgentBySessionId(session_id);

  const agent = agentId ? agents.get(agentId) : undefined;
  if (agent) {
    agent.status = "idle";
    agent.currentCommand = undefined;
    agent.toolInput = undefined;
    agent.isThinking = false;
    agent.lastActivity = Date.now();
  }
  if (agentId) clearIdleTimer(agentId);

  // Add assistant's final message to chat
  if (last_assistant_message && typeof last_assistant_message === "string") {
    pushChatMessage({
      id: `msg-${++chatCounter}`,
      role: "assistant",
      content: last_assistant_message,
      agentName: agentDisplayName(agentId),
      sessionId: session_id,
      timestamp: Date.now(),
    });
  }

  broadcast("activity", { agent: agent || { agentId: agentId || session_id, status: "idle" } });
  res.json({});
});

// Hook 10: User Prompt Submit
app.post("/api/hooks/user-prompt-submit", (req, res) => {
  const { session_id, prompt } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agent = agentId ? agents.get(agentId) : undefined;

  if (agent) {
    agent.status = "thinking";
    agent.isThinking = true;
    agent.lastActivity = Date.now();
    broadcast("activity", { agent });
  }

  // Add to chat history (with dedup check — scan from end since dupes are recent)
  if (prompt && typeof prompt === "string") {
    let isDupe = false;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (Date.now() - m.timestamp >= 5000) break;
      if (m.role === "user" && m.content === prompt && m.sessionId === session_id) {
        isDupe = true;
        break;
      }
    }
    if (!isDupe) {
      pushChatMessage({
        id: `msg-${++chatCounter}`,
        role: "user",
        content: prompt,
        sessionId: session_id,
        sessionLabel: agent?.displayName || "Claude",
        timestamp: Date.now(),
      });
    }
  }

  res.json({});
});

// Hook 11: Notification
app.post("/api/hooks/notification", (req, res) => {
  const { session_id, message, title, notification_type } = req.body;
  const agentId = findAgentBySessionId(session_id);

  pushNotification({
    type: notification_type === "permission_prompt" ? "approval-needed" : "info",
    agentId: agentId || session_id,
    agentName: agentDisplayName(agentId),
    description: message || title || "System notification",
  });

  res.json({});
});

// ============================================================
// Routes — Chat / Messaging
// ============================================================

/** Extract first user message from a session JSONL to use as title */
// getSessionTitle removed — replaced by indexer.getSessionTitle() (fast SQLite lookup)

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
  pushChatMessage(userMsg);

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
        pushChatMessage({
          id: `msg-${++chatCounter}`,
          role: "assistant",
          content,
          agentName: agent?.displayName || "Claude",
          sessionId: targetSessionId || "neon-chat",
          sessionLabel,
          timestamp: Date.now(),
        });
      }
    });

    // Give it 2 seconds to fail fast (voice-mode pattern)
    setTimeout(() => {
      if (child.exitCode !== null && child.exitCode !== 0) {
        pushChatMessage({
          id: `msg-${++chatCounter}`,
          role: "assistant",
          content: `(Error: ${stderr.trim() || "claude exited with code " + child.exitCode})`,
          agentName: "Claude",
          sessionId: targetSessionId || "neon-chat",
          sessionLabel,
          timestamp: Date.now(),
        });
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

/** Find which project a session file belongs to (returns project name or null).
 *  Results are cached to avoid repeated sync filesystem scans. */
const sessionProjectCache = new Map<string, { projectName: string; projectPath: string } | null>();
let sessionProjectCacheTime = 0;

function findSessionProject(sessionId: string): { projectName: string; projectPath: string } | null {
  // Rebuild cache every 30s
  const now = Date.now();
  if (now - sessionProjectCacheTime > 30_000) {
    sessionProjectCache.clear();
    sessionProjectCacheTime = now;
  }

  if (sessionProjectCache.has(sessionId)) {
    return sessionProjectCache.get(sessionId)!;
  }

  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) { sessionProjectCache.set(sessionId, null); return null; }

  try {
    const projectDirs = readdirSync(claudeProjects);
    for (const dir of projectDirs) {
      const sessionFile = join(claudeProjects, dir, `${sessionId}.jsonl`);
      if (existsSync(sessionFile)) {
        const decoded = decodeProjectDir(dir);
        const result = { projectName: friendlyProjectName(decoded), projectPath: decoded };
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }
  } catch {
    // Ignore
  }
  sessionProjectCache.set(sessionId, null);
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

// Cache for expensive recent-session filesystem scan (statSync per .jsonl file)
let recentSessionsCache: Array<{
  sessionId: string; label: string; agentName: string; projectName: string;
  projectPath: string; status: string; lastActivity: number; color: string;
  isLive: boolean; ideName: string;
}> = [];
let recentSessionsCacheTime = 0;
const RECENT_SESSIONS_CACHE_TTL = 10_000; // 10s

async function getRecentSessions(seenSessionIds: Set<string>) {
  const now = Date.now();
  if (now - recentSessionsCacheTime < RECENT_SESSIONS_CACHE_TTL && recentSessionsCache.length > 0) {
    return recentSessionsCache.filter(s => !seenSessionIds.has(s.sessionId));
  }

  const results: typeof recentSessionsCache = [];
  const claudeProjects = join(homedir(), ".claude", "projects");
  try { await stat(claudeProjects); } catch { recentSessionsCache = []; recentSessionsCacheTime = now; return []; }

  const cutoff = now - 24 * 60 * 60 * 1000;
  const projectDirs = await readdir(claudeProjects);

  for (const dir of projectDirs.slice(0, 20)) {
    const projectPath = join(claudeProjects, dir);
    try {
      const st = await stat(projectPath);
      if (!st.isDirectory()) continue;

      const dirFiles = await readdir(projectPath);
      const jsonlNames = dirFiles.filter((f) => f.endsWith(".jsonl"));
      const files: Array<{ name: string; sessionId: string; mtime: number }> = [];
      for (const f of jsonlNames) {
        try {
          const fst = await stat(join(projectPath, f));
          if (fst.mtimeMs > cutoff) {
            files.push({ name: f, sessionId: f.replace(".jsonl", ""), mtime: fst.mtimeMs });
          }
        } catch { /* skip */ }
      }
      files.sort((a, b) => b.mtime - a.mtime);
      const top5 = files.slice(0, 5);

      const decoded = decodeProjectDir(dir);
      const projName = friendlyProjectName(decoded);

      for (const f of top5) {
        const title = indexer.getSessionTitle(f.sessionId);
        results.push({
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

  recentSessionsCache = results;
  recentSessionsCacheTime = now;
  return results.filter(s => !seenSessionIds.has(s.sessionId));
}

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
      // Skip citizen placeholder agents — they're city decoration, not real sessions
      if (id.startsWith("citizen-")) continue;
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

    // 3. Recent session files (last 24h) — cached to avoid expensive statSync per file
    const recentSessions = await getRecentSessions(seenSessionIds);
    for (const s of recentSessions) {
      seenSessionIds.add(s.sessionId);
      activeSessions.push(s);
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

// Defer initial indexing so the server can respond immediately with
// stale-but-present data from the persisted SQLite database.  The DB
// survives restarts, so stats/sessions are available from the start.
// indexAll() is kicked off after a short delay to avoid blocking HTTP/WS.
setTimeout(() => {
  indexer.indexAll().then(() => {
    console.log("[Indexer] Initial indexing complete");
    indexer.startWatching();
  });
}, 2000);

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

app.get("/api/projects", async (_req, res) => {
  try {
    const claudeProjects = join(homedir(), ".claude", "projects");
    try { await stat(claudeProjects); } catch { return res.json({ projects: [] }); }

    const projectDirs = await readdir(claudeProjects);
    const projects: Array<{ name: string; path: string; lastActivity: number }> = [];
    const seenPaths = new Set<string>();

    for (const dir of projectDirs) {
      const fullDir = join(claudeProjects, dir);
      try {
        const st = await stat(fullDir);
        if (!st.isDirectory()) continue;

        const decoded = decodeProjectDir(dir);
        if (seenPaths.has(decoded)) continue;
        seenPaths.add(decoded);

        let lastActivity = st.mtimeMs;
        try {
          const files = (await readdir(fullDir)).filter((f) => f.endsWith(".jsonl"));
          for (const f of files) {
            const fstat = await stat(join(fullDir, f));
            if (fstat.mtimeMs > lastActivity) lastActivity = fstat.mtimeMs;
          }
        } catch { /* ignore */ }

        const name = friendlyProjectName(decoded);
        projects.push({ name, path: decoded, lastActivity });
      } catch {
        continue;
      }
    }

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

app.get("/api/projects/tree", async (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) return res.status(400).json({ error: "path required" });

  const resolved = resolve(targetPath);

  try {
    const st = await stat(resolved);
    if (!st.isDirectory()) return res.status(400).json({ error: "not a directory" });
  } catch {
    return res.status(404).json({ error: "path not found" });
  }

  const IGNORED = new Set([
    ".git", "node_modules", ".next", "__pycache__", ".venv", "dist", "build",
    ".DS_Store", ".cache", ".turbo", ".svelte-kit", "coverage", ".nyc_output",
  ]);
  const MAX_ENTRIES = 200;

  try {
    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries: Array<{ name: string; path: string; type: "file" | "dir"; size?: number }> = [];

    for (const d of dirents) {
      if (IGNORED.has(d.name) || d.name.startsWith(".")) continue;
      if (entries.length >= MAX_ENTRIES) break;

      const fullPath = join(resolved, d.name);
      const type = d.isDirectory() ? "dir" as const : "file" as const;

      let size: number | undefined;
      if (type === "file") {
        try {
          const fst = await stat(fullPath);
          size = fst.size;
        } catch { /* skip */ }
      }

      entries.push({ name: d.name, path: fullPath, type, size });
    }

    // Sort: directories first, then files, alphabetical within each group
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "failed to read directory" });
  }
});

app.get("/api/projects/file", async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: "path required" });

  const resolved = resolve(filePath);
  const ext = extname(resolved).toLowerCase();

  // Reject paths inside .git directories
  if (resolved.includes("/.git/") || resolved.includes("\\.git\\")) {
    return res.status(403).json({ error: "access denied" });
  }

  const ALLOWED = new Set([
    ".md", ".prd", ".txt", ".json", ".yaml", ".yml", ".toml",
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
    ".css", ".html", ".svg", ".sh", ".sql", ".cfg", ".ini",
    ".gitignore", ".editorconfig", ".env.example",
  ]);

  // Also allow files with no extension that are common config files
  const base = basename(resolved);
  const isAllowedNoExt = ["Makefile", "Dockerfile", "Procfile", "LICENSE", "Gemfile", "Rakefile"].includes(base);

  if (!ALLOWED.has(ext) && !isAllowedNoExt) {
    return res.status(403).json({ error: `file type '${ext || "none"}' not allowed` });
  }

  // Reject .env files (but allow .env.example)
  if (base === ".env" || (base.startsWith(".env.") && !base.endsWith(".example"))) {
    return res.status(403).json({ error: "env files not allowed" });
  }

  const MAX_SIZE = 500 * 1024; // 500KB

  try {
    const st = await stat(resolved);
    if (!st.isFile()) return res.status(400).json({ error: "not a file" });
    if (st.size > MAX_SIZE) {
      return res.status(413).json({ error: "file too large", size: st.size });
    }

    const content = await readFile(resolved, "utf-8");
    res.json({ content, extension: ext, size: st.size });
  } catch (err: any) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "file not found" });
    if (err.code === "EACCES") return res.status(403).json({ error: "permission denied" });
    res.status(500).json({ error: err.message || "failed to read file" });
  }
});

// ============================================================
// Routes — Agent Spawning
// ============================================================

const spawnedProcesses = new Map<string, ChildProcess>();

app.post("/api/spawn", (req, res) => {
  const { prompt, projectPath, agentType } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const friendlyName = agentType ? agentTypeFriendlyName(agentType) : "Subagent";

  // Create a real AgentState immediately so it appears in the city
  const agentState: AgentState = {
    agentId: spawnId,
    displayName: friendlyName,
    source: "claude",
    isThinking: true,
    currentCommand: undefined,
    toolInput: undefined,
    lastActivity: Date.now(),
    status: "thinking",
    waitingForApproval: false,
    agentKind: "subagent",
    agentType: agentType || undefined,
    spawnId,
  };
  agents.set(spawnId, agentState);
  broadcast("activity", { agent: agentState });

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
      // Keep agent alive while producing output
      const agent = agents.get(spawnId);
      if (agent) agent.lastActivity = Date.now();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      spawnedProcesses.delete(spawnId);

      // Set agent to idle briefly, then remove after 10s
      const agent = agents.get(spawnId);
      if (agent) {
        agent.status = "idle";
        agent.isThinking = false;
        agent.currentCommand = undefined;
        agent.toolInput = undefined;
        agent.lastActivity = Date.now();
        broadcastThrottled("activity", { agent });

        setTimeout(() => {
          agents.delete(spawnId);
          broadcast("agent-removed", { agentId: spawnId });
          // Clean up reverse mapping
          for (const [sid, sid2] of sessionToSpawnId) {
            if (sid2 === spawnId) sessionToSpawnId.delete(sid);
          }
        }, 10_000);
      }

      broadcast("spawn-complete", {
        spawnId,
        code,
        output: output.slice(0, 2000),
      });
    });

    child.unref();
    spawnedProcesses.set(spawnId, child);

    broadcast("spawn-started", {
      spawnId,
      prompt: prompt.slice(0, 100),
      projectPath: cwd,
      agentType,
    });

    res.json({ ok: true, spawnId });
  } catch (err: any) {
    // Remove agent on spawn failure
    agents.delete(spawnId);
    broadcast("agent-removed", { agentId: spawnId });
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
// Chat — Session watcher state (entries cleared by session-end hook)
// ============================================================

const chatWatchers = new Map<string, ReturnType<typeof setInterval>>();

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
      const st = await stat(filePath);
      const currentSize = st.size;
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
async function maybeWatchAgent(agentId: string) {
  const claudeProjects = join(homedir(), ".claude", "projects");
  try { await stat(claudeProjects); } catch { return; }

  try {
    const projectDirs = await readdir(claudeProjects);
    for (const dir of projectDirs) {
      const sessionFile = join(claudeProjects, dir, `${agentId}.jsonl`);
      try {
        await stat(sessionFile);
      } catch { continue; }

      watchSessionFile(sessionFile, agentId);
      return;
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
    // Don't remove subagents whose process is still alive
    if (agent.agentKind === "subagent" && agent.spawnId && spawnedProcesses.has(agent.spawnId)) {
      agent.lastActivity = now; // keep alive while process runs
      continue;
    }
    // Never remove citizen placeholder agents (they're permanent city residents)
    if (id.startsWith("citizen-")) continue;
    if (now - agent.lastActivity > 120_000) {
      agents.delete(id);
      clearIdleTimer(id);
      broadcast("agent-removed", { agentId: id });
    } else if (
      now - agent.lastActivity > (agent.agentKind === "session" ? 90_000 : 30_000) &&
      agent.status !== "idle" &&
      !agent.waitingForApproval
    ) {
      agent.status = "idle";
      agent.currentCommand = undefined;
      agent.toolInput = undefined;
      broadcastThrottled("thinking", { agents: Array.from(agents.values()) });
    }
  }
}, 5_000);

// ============================================================
// Start
// ============================================================

const PORT = parseInt(process.env.SERVER_PORT || "5174");
server.listen(PORT, () => {
  console.log(`Neon City server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);

  // TTS worker starts on-demand when voice is first enabled (not on boot)
  // startTTSWorker();

  // Populate idle subagent citizens — one per available agent type.
  // These are placeholder agents that hang out in the city (park, cafe, bar)
  // until summoned. When a real spawn happens, it replaces the placeholder.
  const CITIZEN_AGENT_TYPES = [
    "general-purpose", "frontend-developer", "backend-developer", "ui-designer",
    "mobile-developer", "mobile-app-developer", "debugger", "code-reviewer",
    "security-engineer", "security-auditor", "data-analyst", "database-administrator",
    "ai-engineer", "project-manager", "business-analyst", "seo-specialist",
    "content-marketer", "multi-agent-coordinator", "explore", "plan",
  ];
  for (let i = 0; i < CITIZEN_AGENT_TYPES.length; i++) {
    const agentType = CITIZEN_AGENT_TYPES[i]!;
    const citizenId = `citizen-${agentType}`;
    // ~30% of citizens walk around, the rest hang out idle
    const isWalker = i % 3 === 0;
    agents.set(citizenId, {
      agentId: citizenId,
      displayName: agentTypeFriendlyName(agentType),
      source: "claude",
      isThinking: false,
      lastActivity: Date.now(),
      status: isWalker ? "walking" : "idle",
      waitingForApproval: false,
      agentKind: "subagent",
      agentType,
    });
  }
  console.log(`[citizens] Populated ${CITIZEN_AGENT_TYPES.length} idle subagent citizens`);
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
