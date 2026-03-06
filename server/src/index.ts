import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { createReadStream, existsSync, statSync, readdirSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { Indexer } from "./indexer/indexer.js";
import type {
  AgentState,
  ChatMessage,
  DiscoveredSession,
  Notification,
  ToolActivity,
  WeatherInfo,
  WeatherState,
} from "./types.js";
import { RuntimeState } from "./services/runtime-state.js";
import { SessionService } from "./services/session-service.js";
import { EventService } from "./services/event-service.js";
import { WeatherService } from "./services/weather-service.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerSpawnRoutes } from "./routes/spawn.js";
import { registerWeatherRoutes } from "./routes/weather.js";
import { registerEventRoutes } from "./routes/events.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const indexer = new Indexer(DATA_DIR);
const runtime = new RuntimeState();
const sessionService = new SessionService(indexer, runtime);
const eventService = new EventService(DATA_DIR, runtime, sessionService);
const weatherService = new WeatherService(runtime);

// ============================================================
// State
// ============================================================

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

/** Summarise a tool's response into a short human-readable string */
function summarizeToolResponse(toolName: string, response: any): string {
  if (!response) return "";
  if (typeof response === "string") return response.slice(0, 120);
  switch (toolName) {
    case "Write":
      return response.success ? "Written successfully" : "Write failed";
    case "Edit":
      return response.success ? "Edit applied" : "Edit failed";
    case "Bash": {
      const out = response.stdout || response.output || "";
      const exit = response.exitCode ?? response.exit_code;
      if (exit !== undefined && exit !== 0) return `Exit code ${exit}`;
      return typeof out === "string" ? out.trim().slice(0, 100) : "";
    }
    case "Grep": {
      if (Array.isArray(response)) return `${response.length} matches`;
      if (typeof response === "string") {
        let count = 1;
        let idx = -1;
        while ((idx = response.indexOf("\n", idx + 1)) !== -1) count++;
        // Don't count trailing newline as an extra line
        if (response.endsWith("\n")) count--;
        return `${count} result${count !== 1 ? "s" : ""}`;
      }
      return "";
    }
    case "Glob": {
      if (Array.isArray(response)) return `${response.length} files`;
      return "";
    }
    case "Read": {
      if (!response.content) return "";
      let count = 1;
      let idx = -1;
      const s = response.content;
      while ((idx = s.indexOf("\n", idx + 1)) !== -1) count++;
      return `${count} lines`;
    }
    default:
      return "";
  }
}

const AGENT_TYPE_NAMES: Record<string, string> = {
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

function agentTypeFriendlyName(agentType: string): string {
  return AGENT_TYPE_NAMES[agentType] || agentType;
}

const SESSION_END_REASONS: Record<string, string> = {
  clear: "Session cleared",
  logout: "User logged out",
  prompt_input_exit: "User exited",
  bypass_permissions_disabled: "Bypass permissions disabled",
};

const agents = runtime.agents;
const clients = runtime.clients;
const notifications = runtime.notifications;
const chatHistory = runtime.chatHistory;
const sessionToSpawnId = runtime.sessionToSpawnId;
const unlinkedSubagents = runtime.unlinkedSubagents;
const toolActivities = runtime.toolActivities;
const spawnedProcesses = runtime.spawnedProcesses;
const chatWatchers = runtime.chatWatchers;
const discoveredSessions = sessionService.discoveredSessions;

// Tool classification sets (shared across hooks and legacy routes)
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Search"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

// ============================================================
// Shared helpers for hooks and routes
// ============================================================

/** Clear a pending idle timer for an agent */
function clearIdleTimer(agentId: string) {
  runtime.clearIdleTimer(agentId);
}

/** Schedule a debounced idle transition (2s) after a tool completes */
function scheduleDebouncedIdle(agentId: string) {
  runtime.scheduleDebouncedIdle(agentId);
}

/** Push a notification, cap at 200, and broadcast */
function pushNotification(
  fields: Omit<Notification, "id" | "timestamp" | "resolved">,
  broadcastExtras?: Record<string, unknown>
): Notification {
  return runtime.pushNotification(fields, broadcastExtras);
}

/** Push a chat message, cap at 500, and broadcast */
function pushChatMessage(msg: ChatMessage) {
  runtime.pushChatMessage(msg);
}

function recordEvent(input: Parameters<typeof eventService.ingest>[0]) {
  try {
    eventService.ingest(input);
  } catch (err) {
    console.error("[events] ingest failed:", err);
  }
}

/** Resolve an agent's display name with fallback */
function agentDisplayName(agentId: string | undefined, fallback = "Claude"): string {
  return runtime.agentDisplayName(agentId, fallback);
}

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
        weather: weatherService.getCurrentWeather(),
        toolActivities: Array.from(toolActivities.values())
          .filter((a) => Date.now() - a.startedAt < 1_800_000)
          .slice(-30),
        stats: initStats,
      },
    })
  );

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function broadcast(type: string, data: unknown) {
  runtime.broadcast(type, data);
}

function broadcastThrottled(type: string, data: unknown) {
  runtime.broadcastThrottled(type, data);
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
  rawToolInput?: unknown;
  projectPath?: string;
  projectName?: string;
  source: "api" | "hook";
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

const approvalRequests = new Map<string, ApprovalRequest>();
const approvalResolvers = new Map<string, (decision: {
  decision: string;
  updatedInput?: unknown;
  updatedPermissions?: unknown;
  message?: string;
}) => void>();
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
    rawToolInput: toolInput,
    source: "api",
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

app.get("/api/approval/:id", (req, res) => {
  const request = approvalRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  res.json({ request });
});

app.post("/api/approval/:id/decide", (req, res) => {
  const { id } = req.params;
  const { decision, updatedInput, updatedPermissions, message, approveAll } = req.body;

  // Check if this is a hooks-based approval (PermissionRequest hook)
  const resolver = approvalResolvers.get(id);
  if (resolver) {
    const request = approvalRequests.get(id);
    if (request && request.status === "pending") {
      request.status = decision === "approve" ? "approved" : "denied";
      if (approveAll && decision === "approve") {
        autoApproveTools.add(request.toolName);
      }
    }
    resolver({ decision, updatedInput, updatedPermissions, message });
    res.json({ ok: true, id, decision, updatedInput, updatedPermissions });
    return;
  }

  const request = approvalRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  if (request.status !== "pending") {
    return res.json({ id: request.id, status: request.status });
  }

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
  const { session_id, cwd, model, source } = req.body;
  const projectName = sessionService.friendlyProjectName(cwd || "unknown");
  const agentId = `session-${session_id}`;

  // Idempotent: update if exists
  const existing = agents.get(agentId);
  if (existing) {
    existing.lastActivity = Date.now();
    if (model) existing.model = model;
    if (source) existing.sessionSource = source;
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
    model,
    sessionSource: source,
  };
  agents.set(agentId, newAgent);

  recordEvent({
    eventType: "SessionStart",
    sessionId: session_id,
    agentId,
    agentKind: "session",
    projectPath: cwd || undefined,
    projectName,
    status: "idle",
    reason: typeof source === "string" ? source : undefined,
    payload: { cwd, model, source },
  });

  broadcast("activity", { agent: newAgent });
  res.json({});
});

// Hook 2: Session End
app.post("/api/hooks/session-end", (req, res) => {
  const { session_id, reason } = req.body;
  const agentId = findAgentBySessionId(session_id) || `session-${session_id}`;
  const agentName = agentDisplayName(agentId);
  const discovered = discoveredSessions.get(`hook-${session_id}`);

  // Create a system message for session end with context
  // Must happen before agents.delete so agentDisplayName can still resolve
  if (reason && reason !== "other") {
    pushChatMessage({
      id: runtime.nextChatMessageId(),
      role: "system",
      content: SESSION_END_REASONS[reason] || `Session ended: ${reason}`,
      agentName,
      sessionId: session_id,
      timestamp: Date.now(),
    });
  }

  agents.delete(agentId);
  discoveredSessions.delete(`hook-${session_id}`);
  clearIdleTimer(agentId);

  recordEvent({
    eventType: "SessionEnd",
    sessionId: session_id,
    agentId,
    agentKind: "session",
    projectPath: discovered?.projectPath,
    projectName: discovered?.projectName,
    status: "idle",
    reason: typeof reason === "string" ? reason : undefined,
    payload: { reason, agentName },
  });

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
      const projectName = cwd ? sessionService.friendlyProjectName(cwd) : "Claude";
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
  const activityId = runtime.nextToolActivityId();
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
  recordEvent({
    eventType: "PreToolUse",
    sessionId: session_id,
    agentId,
    agentKind: agent.agentKind,
    agentType: agent.agentType,
    projectPath: cwd || undefined,
    projectName: cwd ? sessionService.friendlyProjectName(cwd) : undefined,
    toolName: tool_name,
    toolUseId: tool_use_id,
    status: agent.status,
    payload: { toolInput: tool_input, summarizedInput: agent.toolInput },
  });
  broadcast("activity", { agent });
  broadcast("tool-activity", toolActivities.get(tool_use_id));
  res.json({});
});

// Hook 4: Post Tool Use
app.post("/api/hooks/post-tool-use", (req, res) => {
  const { session_id, tool_use_id, tool_name, tool_response } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agent = agentId ? agents.get(agentId) : undefined;

  // Update tool activity
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "complete";
    activity.completedAt = Date.now();
    // Summarize the tool response for the activity feed
    if (tool_response) {
      activity.responseSummary = summarizeToolResponse(tool_name, tool_response);
    }
    broadcast("tool-activity", activity);
  }

  // Debounced idle transition (2s)
  recordEvent({
    eventType: "PostToolUse",
    sessionId: session_id,
    agentId: agentId || undefined,
    agentKind: agent?.agentKind,
    agentType: agent?.agentType,
    projectPath: session_id ? discoveredSessions.get(`hook-${session_id}`)?.projectPath : undefined,
    projectName: session_id ? discoveredSessions.get(`hook-${session_id}`)?.projectName : undefined,
    toolName: tool_name,
    toolUseId: tool_use_id,
    status: "complete",
    payload: { toolResponse: tool_response, responseSummary: activity?.responseSummary },
  });
  if (agentId) scheduleDebouncedIdle(agentId);

  res.json({});
});

// Hook 5: Post Tool Use Failure
app.post("/api/hooks/post-tool-use-failure", (req, res) => {
  const { session_id, tool_name, tool_use_id, error, is_interrupt } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agent = agentId ? agents.get(agentId) : undefined;
  // Update tool activity
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "error";
    activity.error = typeof error === "string" ? error : JSON.stringify(error);
    activity.completedAt = Date.now();
    broadcast("tool-activity", activity);
  }

  // Create error notification
  const errorMsg = typeof error === "string" ? error : "Unknown error";
  const prefix = is_interrupt ? "Interrupted" : `${tool_name} failed`;
  pushNotification({
    type: "error",
    agentId: agentId || session_id,
    agentName: agentDisplayName(agentId),
    toolName: tool_name,
    description: `${prefix}: ${errorMsg.slice(0, 200)}`,
  });

  // Debounced idle transition (same as post-tool-use)
  recordEvent({
    eventType: "PostToolUseFailure",
    sessionId: session_id,
    agentId: agentId || undefined,
    agentKind: agent?.agentKind,
    agentType: agent?.agentType,
    projectPath: session_id ? discoveredSessions.get(`hook-${session_id}`)?.projectPath : undefined,
    projectName: session_id ? discoveredSessions.get(`hook-${session_id}`)?.projectName : undefined,
    toolName: tool_name,
    toolUseId: tool_use_id,
    status: is_interrupt ? "interrupted" : "error",
    reason: errorMsg,
    payload: { error, isInterrupt: !!is_interrupt },
  });
  if (agentId) scheduleDebouncedIdle(agentId);

  res.json({});
});

// Hook 6: Permission Request (holds connection open until UI approves/denies)
app.post("/api/hooks/permission-request", (req, res) => {
  const { session_id, tool_name, tool_input } = req.body;
  const agentId = findAgentBySessionId(session_id) || `session-${session_id}`;

  // Auto-approve if user previously clicked "Approve All" for this tool
  if (autoApproveTools.has(tool_name)) {
    return res.json({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  }

  const inputSummary = summarizeToolInput(tool_name, tool_input || {});
  const agent = agents.get(agentId);

  // Set agent to stuck/waiting state
  if (agent) {
    agent.status = "stuck";
    agent.waitingForApproval = true;
    agent.currentCommand = tool_name;
    agent.toolInput = inputSummary;
    agent.lastActivity = Date.now();
    broadcast("activity", { agent });
  }

  // Create approval notification
  const approvalId = `hook-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectPath = discoveredSessions.get(`hook-${session_id}`)?.projectPath;
  const projectName = discoveredSessions.get(`hook-${session_id}`)?.projectName;
  const notif = pushNotification({
    type: "approval-needed",
    agentId,
    agentName: agentDisplayName(agentId),
    toolName: tool_name,
    description: `${tool_name}: ${inputSummary}`,
    approvalId,
  });

  recordEvent({
    eventType: "PermissionRequest",
    sessionId: session_id,
    agentId,
    agentKind: agent?.agentKind ?? "session",
    agentType: agent?.agentType,
    projectPath,
    projectName,
    toolName: tool_name,
    status: "pending",
    reason: inputSummary,
    payload: { toolInput: tool_input, approvalId, notificationId: notif.id },
  });

  approvalRequests.set(approvalId, {
    id: approvalId,
    agentId,
    agentName: agentDisplayName(agentId),
    toolName: tool_name,
    toolInput: inputSummary,
    rawToolInput: tool_input,
    projectPath,
    projectName,
    source: "hook",
    status: "pending",
    createdAt: Date.now(),
  });

  // Hold connection open — resolve when user clicks Approve/Deny
  const timeout = setTimeout(() => {
    cleanup();
    if (!res.headersSent) {
      res.json({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "deny", message: "Neon City approval timed out" },
        },
      });
    }
  }, 120_000);

  function cleanup() {
    clearTimeout(timeout);
    approvalResolvers.delete(approvalId);
    // Resolve the notification
    if (notif && !notif.resolved) {
      notif.resolved = true;
      broadcast("notification-resolved", { id: notif.id });
    }
    const a = agents.get(agentId);
    if (a) {
      a.waitingForApproval = false;
      a.status = "idle";
      broadcast("activity", { agent: a });
    }
  }

  approvalResolvers.set(approvalId, ({ decision, updatedInput, updatedPermissions, message }) => {
    cleanup();
    if (res.headersSent) return;

    if (decision === "approve" || decision === "allow") {
      res.json({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: {
            behavior: "allow",
            ...(updatedInput ? { updatedInput } : {}),
            ...(updatedPermissions ? { updatedPermissions } : {}),
          },
        },
      });
    } else {
      res.json({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "deny", message: message || "Denied via Neon City UI" },
        },
      });
    }
  });

  // Cleanup if client disconnects (idempotent — safe to call even if already cleaned up)
  req.on("close", () => cleanup());
});

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

  recordEvent({
    eventType: "SubagentStart",
    agentId,
    agentKind: "subagent",
    agentType: agent_type,
    status: "walking",
    payload: { agentType: agent_type },
  });

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
  recordEvent({
    eventType: "SubagentStop",
    agentId: agentId || undefined,
    agentKind: "subagent",
    agentType: agent_type,
    status: "complete",
    reason: typeof last_assistant_message === "string" ? last_assistant_message.slice(0, 200) : "Agent completed its task",
    payload: { lastAssistantMessage: last_assistant_message },
  });
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
      id: runtime.nextChatMessageId(),
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
        id: runtime.nextChatMessageId(),
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

const routeContext = {
  indexer,
  runtime,
  sessionService,
  eventService,
  weatherService,
  cleanEnvForClaude,
  agentTypeFriendlyName,
};

app.use("/api/chat", registerChatRoutes(routeContext));
app.use("/api/sessions", registerSessionRoutes(routeContext));
app.use("/api/history", registerHistoryRoutes(routeContext));
app.use("/api/events", registerEventRoutes(routeContext));
app.use("/api/projects", registerProjectRoutes(routeContext));
app.use("/api/git", registerGitRoutes(routeContext));
app.use("/api/spawn", registerSpawnRoutes(routeContext));
app.use("/api/weather", registerWeatherRoutes(routeContext));
weatherService.startAutoUpdates();

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

  // Keep the indexed project/session database warm for history and project views.
  indexer.indexAll().catch((err) => {
    console.error("[Indexer] Initial index failed:", err);
  });
  indexer.startWatching();

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
