# Neon City — Claude Code Hooks Integration

> This replaces the polling/JSONL-parsing architecture with event-driven hooks.
> Claude Code pushes events directly to the Neon City Express server.
> Reference: https://code.claude.com/docs/en/hooks

---

## Architecture Context

- **Neon City server** runs at `http://localhost:5174` (Express + WebSocket)
- **Server file**: `server/src/index.ts` (monolithic, ~2400 lines)
- **Current discovery**: lock file scanning, `ps aux` polling, JSONL file watching every 250-500ms
- **Current approval**: custom webhook-based system with `/api/approval/*` endpoints
- **WebSocket**: broadcasts state changes to all connected clients at `/ws`
- **State**: in-memory `agents` Map, `notifications` array, `chatHistory` array, `toolActivities` Map

### What hooks replace

| Current mechanism | Lines of code | Hook replacement |
|---|---|---|
| `scanLockFiles()` — polls `~/.claude/ide/*.lock` | ~80 lines | `SessionStart` / `SessionEnd` hooks |
| `scanTerminalSessions()` — runs `ps aux` + `lsof` | ~120 lines | `SessionStart` / `SessionEnd` hooks |
| JSONL session file watchers (`watchChatSession`) | ~200 lines | `PreToolUse` + `PostToolUse` + `UserPromptSubmit` + `Stop` hooks |
| Tool activity parsing from JSONL `tool_use`/`tool_result` blocks | ~150 lines | `PreToolUse` + `PostToolUse` + `PostToolUseFailure` hooks |
| Custom approval system (`/api/approval/*`) | ~100 lines | `PermissionRequest` hook (native) |
| Agent spawn completion detection | ~50 lines | `SubagentStart` + `SubagentStop` hooks |

**Total: ~700 lines of polling code replaced by ~15 HTTP endpoint handlers.**

---

## Phase 1: Add Hook Receiver Endpoints

Add new Express routes to `server/src/index.ts` that receive hook events. These run **alongside** existing polling (no removal yet). This lets you validate the hook data before cutting over.

### Hook event types and their JSON input

Every hook POST body includes these common fields:
```typescript
interface HookCommonInput {
  session_id: string;        // Claude Code session UUID
  transcript_path: string;   // path to conversation JSONL
  cwd: string;               // working directory
  permission_mode: string;   // "default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions"
  hook_event_name: string;   // which event fired
}
```

### Server endpoints to add

Add these routes in `server/src/index.ts`. Each one receives the hook JSON as `req.body`, updates the in-memory state, and broadcasts via WebSocket.

#### 1. `POST /api/hooks/session-start`

Fires when any Claude Code session starts or resumes. Replaces lock file + terminal scanning.

```typescript
// Hook input includes: session_id, cwd, source ("startup"|"resume"|"clear"|"compact"), model
app.post("/api/hooks/session-start", (req, res) => {
  const { session_id, cwd, source, model } = req.body;

  // Derive project name from cwd
  const projectName = basename(cwd);
  const agentId = `session-${session_id}`;

  // Register as a discovered session
  discoveredSessions.set(session_id, {
    sessionId: session_id,
    pid: 0, // not needed with hooks
    workspaceFolders: [cwd],
    ideName: "Claude Code",
    projectName,
    projectPath: cwd,
    title: null,
    lastActivity: Date.now(),
  });

  // Create agent in city
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

  broadcast("activity", { agentId, status: "idle", displayName: projectName, agentKind: "session" });
  res.json({ ok: true });
});
```

#### 2. `POST /api/hooks/session-end`

Fires when a session terminates. Replaces stale session cleanup.

```typescript
// Hook input includes: session_id, reason ("clear"|"logout"|"prompt_input_exit"|"other")
app.post("/api/hooks/session-end", (req, res) => {
  const { session_id } = req.body;
  const agentId = `session-${session_id}`;

  agents.delete(agentId);
  discoveredSessions.delete(session_id);
  broadcast("agent-removed", { agentId });

  res.json({ ok: true });
});
```

#### 3. `POST /api/hooks/pre-tool-use`

Fires before every tool call. Provides real-time "agent is about to do X" status. This is an HTTP hook — it can return a decision to allow/deny.

```typescript
// Hook input includes: tool_name, tool_input (shape depends on tool), tool_use_id
app.post("/api/hooks/pre-tool-use", (req, res) => {
  const { session_id, tool_name, tool_input, tool_use_id } = req.body;
  const agentId = findAgentBySessionId(session_id);

  // Map tool to status
  const statusMap: Record<string, string> = {
    Read: "reading", Grep: "reading", Glob: "reading",
    Write: "writing", Edit: "writing",
    Bash: "writing",
    WebFetch: "reading", WebSearch: "reading",
  };
  const status = statusMap[tool_name] || "thinking";
  const toolInput = summarizeToolInput(tool_name, tool_input);

  // Update agent state
  if (agentId && agents.has(agentId)) {
    const agent = agents.get(agentId)!;
    agent.status = status as any;
    agent.currentCommand = tool_name;
    agent.toolInput = toolInput;
    agent.lastActivity = Date.now();
  }

  // Track tool activity
  const activityId = `ta-${++toolActivityCounter}`;
  toolActivities.set(tool_use_id, {
    id: activityId,
    toolUseId: tool_use_id,
    agentId: agentId || session_id,
    agentName: agents.get(agentId || "")?.displayName || "Claude",
    sessionId: session_id,
    toolName: tool_name,
    toolInput,
    status: "running",
    startedAt: Date.now(),
  });

  broadcast("activity", { agentId, status, currentCommand: tool_name, toolInput });
  broadcast("tool-activity", toolActivities.get(tool_use_id));

  // Return empty 200 to allow the tool call to proceed
  // To block: return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." } }
  res.json({});
});
```

#### 4. `POST /api/hooks/post-tool-use`

Fires after a tool completes successfully. Updates activity status and agent state.

```typescript
// Hook input includes: tool_name, tool_input, tool_response, tool_use_id
app.post("/api/hooks/post-tool-use", (req, res) => {
  const { session_id, tool_name, tool_input, tool_response, tool_use_id } = req.body;
  const agentId = findAgentBySessionId(session_id);

  // Update tool activity to complete
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "complete";
    activity.completedAt = Date.now();
    broadcast("tool-activity", activity);
  }

  // Set agent back to idle (will be overridden if another tool fires immediately)
  if (agentId && agents.has(agentId)) {
    const agent = agents.get(agentId)!;
    agent.status = "idle";
    agent.currentCommand = undefined;
    agent.toolInput = undefined;
    agent.lastActivity = Date.now();
  }

  broadcast("activity", { agentId, status: "idle" });
  res.json({});
});
```

#### 5. `POST /api/hooks/post-tool-use-failure`

Fires when a tool call fails. Shows error in notification center.

```typescript
// Hook input includes: tool_name, tool_input, tool_use_id, error, is_interrupt
app.post("/api/hooks/post-tool-use-failure", (req, res) => {
  const { session_id, tool_name, tool_input, tool_use_id, error } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agentName = agents.get(agentId || "")?.displayName || "Claude";

  // Update tool activity to error
  const activity = toolActivities.get(tool_use_id);
  if (activity) {
    activity.status = "error";
    activity.error = error;
    activity.completedAt = Date.now();
    broadcast("tool-activity", activity);
  }

  // Create error notification
  const notif = {
    id: `notif-${++notifCounter}`,
    type: "error",
    agentId: agentId || session_id,
    agentName,
    toolName: tool_name,
    description: `${tool_name} failed: ${error?.slice(0, 200)}`,
    timestamp: Date.now(),
    resolved: false,
  };
  notifications.push(notif);
  if (notifications.length > 200) notifications.splice(0, notifications.length - 200);
  broadcast("notification", notif);

  res.json({});
});
```

#### 6. `POST /api/hooks/permission-request`

**This is the big one.** Replaces the entire custom approval system. When Claude Code needs permission, it POSTs here. The endpoint holds the connection open until the user clicks Approve/Deny in Neon City's NotificationCenter, then returns the decision.

```typescript
// Hook input includes: tool_name, tool_input, permission_suggestions[]
app.post("/api/hooks/permission-request", async (req, res) => {
  const { session_id, tool_name, tool_input } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agentName = agents.get(agentId || "")?.displayName || "Claude";
  const toolInput = summarizeToolInput(tool_name, tool_input);

  // Mark agent as stuck/waiting
  if (agentId && agents.has(agentId)) {
    const agent = agents.get(agentId)!;
    agent.status = "stuck";
    agent.waitingForApproval = true;
    agent.currentCommand = tool_name;
    agent.toolInput = toolInput;
  }
  broadcast("activity", { agentId, status: "stuck", currentCommand: tool_name, toolInput });

  // Create approval notification
  const approvalId = `approval-${++notifCounter}`;
  const notif = {
    id: approvalId,
    type: "approval-needed",
    agentId: agentId || session_id,
    agentName,
    toolName: tool_name,
    description: `${tool_name}: ${toolInput}`,
    timestamp: Date.now(),
    resolved: false,
    approvalId,
  };
  notifications.push(notif);
  broadcast("notification", { ...notif, approvalId });

  // Wait for user decision (up to 120 seconds)
  // Store a resolver that the /api/approval/:id/decide endpoint will call
  const decision = await new Promise<{ behavior: "allow" | "deny"; updatedInput?: any }>((resolve) => {
    const timeout = setTimeout(() => resolve({ behavior: "deny" }), 120_000);

    approvalResolvers.set(approvalId, (decision: string, updatedInput?: any) => {
      clearTimeout(timeout);
      resolve({
        behavior: decision === "approve" ? "allow" : "deny",
        updatedInput,
      });
    });
  });

  approvalResolvers.delete(approvalId);

  // Clear stuck status
  if (agentId && agents.has(agentId)) {
    const agent = agents.get(agentId)!;
    agent.status = "idle";
    agent.waitingForApproval = false;
  }
  broadcast("activity", { agentId, status: "idle" });

  // Return native Claude Code hook response format
  res.json({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: decision.behavior,
        ...(decision.updatedInput && { updatedInput: decision.updatedInput }),
        ...(decision.behavior === "deny" && { message: "Denied by Neon City operator" }),
      },
    },
  });
});

// In-memory map for pending approval resolvers
const approvalResolvers = new Map<string, (decision: string, updatedInput?: any) => void>();
```

Update the existing `/api/approval/:id/decide` endpoint to also resolve hook-based approvals:

```typescript
app.post("/api/approval/:id/decide", (req, res) => {
  const { id } = req.params;
  const { decision } = req.body;

  // Check if this is a hooks-based approval
  const resolver = approvalResolvers.get(id);
  if (resolver) {
    resolver(decision);
    res.json({ ok: true });
    return;
  }

  // ... existing legacy approval logic ...
});
```

#### 7. `POST /api/hooks/subagent-start`

Fires when a subagent spawns. Agent appears in city instantly.

```typescript
// Hook input includes: agent_id, agent_type (e.g. "Explore", "Plan", custom agent names)
// NOTE: SubagentStart only supports type: "command" hooks, not HTTP.
// The hook config uses curl to POST here.
app.post("/api/hooks/subagent-start", (req, res) => {
  const { session_id, agent_id, agent_type } = req.body;

  const displayName = agentTypeFriendlyName(agent_type || "General");

  agents.set(agent_id, {
    agentId: agent_id,
    displayName,
    source: "claude",
    isThinking: false,
    lastActivity: Date.now(),
    status: "walking",
    waitingForApproval: false,
    agentKind: "subagent",
    agentType: agent_type,
  });

  broadcast("activity", { agentId: agent_id, status: "walking", displayName, agentKind: "subagent", agentType: agent_type });
  res.json({});
});
```

#### 8. `POST /api/hooks/subagent-stop`

Fires when a subagent finishes. Removes from city immediately.

```typescript
// Hook input includes: agent_id, agent_type, last_assistant_message
// NOTE: SubagentStop only supports type: "command" hooks, not HTTP.
app.post("/api/hooks/subagent-stop", (req, res) => {
  const { agent_id, agent_type, last_assistant_message } = req.body;

  const agent = agents.get(agent_id);
  const agentName = agent?.displayName || agentTypeFriendlyName(agent_type || "Agent");

  // Create completion notification
  const notif = {
    id: `notif-${++notifCounter}`,
    type: "task-complete",
    agentId: agent_id,
    agentName,
    description: last_assistant_message?.slice(0, 200) || "Agent completed its task",
    timestamp: Date.now(),
    resolved: false,
  };
  notifications.push(notif);
  broadcast("notification", notif);

  // Remove agent from city
  agents.delete(agent_id);
  broadcast("agent-removed", { agentId: agent_id });

  res.json({});
});
```

#### 9. `POST /api/hooks/stop`

Fires when Claude finishes responding. Updates agent to idle.

```typescript
// Hook input includes: stop_hook_active, last_assistant_message
// NOTE: Stop only supports type: "command" hooks, not HTTP.
app.post("/api/hooks/stop", (req, res) => {
  const { session_id, last_assistant_message } = req.body;
  const agentId = findAgentBySessionId(session_id);

  if (agentId && agents.has(agentId)) {
    const agent = agents.get(agentId)!;
    agent.status = "idle";
    agent.currentCommand = undefined;
    agent.toolInput = undefined;
    agent.isThinking = false;
  }

  // Broadcast the assistant's final message to chat
  if (last_assistant_message) {
    const chatMsg: ChatMessage = {
      id: `msg-${++chatCounter}`,
      role: "assistant",
      content: last_assistant_message,
      agentName: agents.get(agentId || "")?.displayName || "Claude",
      sessionId: session_id,
      timestamp: Date.now(),
    };
    chatHistory.push(chatMsg);
    if (chatHistory.length > 500) chatHistory.splice(0, chatHistory.length - 500);
    broadcast("chat-message", chatMsg);
  }

  broadcast("activity", { agentId, status: "idle" });
  res.json({});
});
```

#### 10. `POST /api/hooks/user-prompt-submit`

Fires when user submits a prompt in their IDE/terminal. Feeds into Neon City chat.

```typescript
// Hook input includes: prompt
// NOTE: UserPromptSubmit only supports type: "command" hooks, not HTTP.
app.post("/api/hooks/user-prompt-submit", (req, res) => {
  const { session_id, prompt } = req.body;
  const agentId = findAgentBySessionId(session_id);
  const agent = agents.get(agentId || "");

  // Set agent to thinking
  if (agent) {
    agent.status = "thinking";
    agent.isThinking = true;
    agent.lastActivity = Date.now();
  }
  broadcast("activity", { agentId, status: "thinking" });
  broadcast("thinking", { agentId, isThinking: true });

  // Add to chat history
  const chatMsg: ChatMessage = {
    id: `msg-${++chatCounter}`,
    role: "user",
    content: prompt,
    sessionId: session_id,
    sessionLabel: agent?.displayName || "Claude",
    timestamp: Date.now(),
  };
  chatHistory.push(chatMsg);
  if (chatHistory.length > 500) chatHistory.splice(0, chatHistory.length - 500);
  broadcast("chat-message", chatMsg);

  res.json({});
});
```

#### 11. `POST /api/hooks/notification`

Fires on Claude Code system notifications.

```typescript
// Hook input includes: message, title, notification_type
// NOTE: Notification only supports type: "command" hooks, not HTTP.
app.post("/api/hooks/notification", (req, res) => {
  const { session_id, message, title, notification_type } = req.body;
  const agentId = findAgentBySessionId(session_id);

  const notif = {
    id: `notif-${++notifCounter}`,
    type: notification_type === "permission_prompt" ? "approval-needed" : "info",
    agentId: agentId || session_id,
    agentName: agents.get(agentId || "")?.displayName || "Claude",
    description: message,
    timestamp: Date.now(),
    resolved: false,
  };
  notifications.push(notif);
  broadcast("notification", notif);

  res.json({});
});
```

### Helper function

Add this to the server to look up agents by Claude Code session ID:

```typescript
function findAgentBySessionId(sessionId: string): string | undefined {
  // Check direct match first
  if (agents.has(sessionId)) return sessionId;
  // Check session- prefixed
  const prefixed = `session-${sessionId}`;
  if (agents.has(prefixed)) return prefixed;
  // Check discovered sessions
  for (const [, ds] of discoveredSessions) {
    if (ds.sessionId === sessionId) {
      const agentId = `session-${sessionId}`;
      if (agents.has(agentId)) return agentId;
    }
  }
  return undefined;
}
```

---

## Phase 2: Install Hooks Configuration

After the endpoints are working, install the hooks config so Claude Code starts POSTing events.

### Auto-install via setup script

Add to `bin/setup.js` (or create a new `bin/install-hooks.js`):

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOOKS_CONFIG = {
  PreToolUse: [{
    hooks: [{
      type: "http",
      url: "http://localhost:5174/api/hooks/pre-tool-use",
      timeout: 5
    }]
  }],
  PostToolUse: [{
    hooks: [{
      type: "http",
      url: "http://localhost:5174/api/hooks/post-tool-use",
      timeout: 5
    }]
  }],
  PostToolUseFailure: [{
    hooks: [{
      type: "http",
      url: "http://localhost:5174/api/hooks/post-tool-use-failure",
      timeout: 5
    }]
  }],
  PermissionRequest: [{
    hooks: [{
      type: "http",
      url: "http://localhost:5174/api/hooks/permission-request",
      timeout: 120
    }]
  }],
  SessionStart: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/session-start -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  SessionEnd: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/session-end -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  SubagentStart: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/subagent-start -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  SubagentStop: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/subagent-stop -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  Stop: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/stop -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  UserPromptSubmit: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/user-prompt-submit -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }],
  Notification: [{
    hooks: [{
      type: "command",
      command: "curl -sf -X POST http://localhost:5174/api/hooks/notification -H 'Content-Type: application/json' -d \"$(cat)\" || true"
    }]
  }]
};

function installHooks() {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsDir = join(homedir(), ".claude");

  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  }

  // Merge hooks — don't overwrite existing user hooks
  settings.hooks = settings.hooks || {};
  for (const [event, config] of Object.entries(HOOKS_CONFIG)) {
    settings.hooks[event] = settings.hooks[event] || [];

    // Check if a Neon City hook already exists for this event
    const hasNeonCityHook = settings.hooks[event].some(group =>
      group.hooks?.some(h =>
        (h.url && h.url.includes("localhost:5174")) ||
        (h.command && h.command.includes("localhost:5174"))
      )
    );

    if (!hasNeonCityHook) {
      settings.hooks[event].push(...config);
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log("Neon City hooks installed in ~/.claude/settings.json");
}

function uninstallHooks() {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;

  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  if (!settings.hooks) return;

  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter(group =>
      !group.hooks?.some(h =>
        (h.url && h.url.includes("localhost:5174")) ||
        (h.command && h.command.includes("localhost:5174"))
      )
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log("Neon City hooks removed from ~/.claude/settings.json");
}

const isUninstall = process.argv.includes("--uninstall");
isUninstall ? uninstallHooks() : installHooks();
```

Add npm scripts to root `package.json`:
```json
{
  "scripts": {
    "hooks:install": "node bin/install-hooks.js",
    "hooks:uninstall": "node bin/install-hooks.js --uninstall"
  }
}
```

### Important: `|| true` on curl commands

The `|| true` at the end of each curl command ensures that if the Neon City server is not running, the hook fails silently instead of blocking Claude Code. Non-HTTP hooks (`SessionStart`, `Stop`, etc.) use `type: "command"`, and a non-zero exit code would show errors to the user. The `|| true` makes the exit code always 0.

For HTTP hooks (`PreToolUse`, `PostToolUse`, `PermissionRequest`), connection failures are already non-blocking — Claude Code treats them as non-fatal errors and continues.

### Important: Hook timeout for PermissionRequest

The `PermissionRequest` hook timeout is set to 120 seconds. This is the window the user has to click Approve/Deny in Neon City before the hook times out. On timeout, Claude Code shows the normal permission dialog in the terminal. Adjust this value if needed.

---

## Phase 3: Remove Legacy Polling

After hooks are validated and working, remove the legacy polling code:

### Server code to remove

1. **`scanLockFiles()`** function and its `setInterval` call
2. **`scanTerminalSessions()`** function and its `setInterval` call
3. **JSONL session file watchers** (`watchChatSession`, `chatWatchers` Map, the `createInterface` + `createReadStream` polling loop)
4. **Legacy tool activity parsing** from JSONL (the `tool_use` / `tool_result` block detection in the watcher)
5. **Legacy approval polling** (`/api/approval/:id/wait` endpoint that polls for decisions)

### Keep these

- **SQLite indexer** (`server/src/indexer/`) — still needed for History search and session archive
- **Lock file scanning** — keep as a **fallback** for sessions that don't have hooks installed (e.g. old Claude Code versions). Run it less frequently (every 60s instead of 10s).
- **`/api/spawn`** endpoint — still needed for Neon City's "Summon Agent" feature

---

## Phase 4: Enhanced Features Enabled by Hooks

### Real-time thinking indicator

The `UserPromptSubmit` hook fires when the user sends a prompt. The next `PreToolUse` or `Stop` fires when Claude starts acting. The time between these two events is Claude's "thinking" time. Use this to show a pulsing thinking animation on the agent sprite and status bar card.

### Tool execution timeline

With `PreToolUse` (start) and `PostToolUse`/`PostToolUseFailure` (end) paired by `tool_use_id`, build a timeline view of every tool execution with duration. Show in the Activity tab of NotificationCenter.

### Smart weather from real tool data

Currently weather is computed from agent count heuristics. With hooks, compute it from actual tool usage:
- **Aurora**: 3+ `Write`/`Edit` tools in last 30 seconds
- **Fog**: 2+ agents with no tool calls for 10+ seconds (deep thinking)
- **Storm**: 2+ `PostToolUseFailure` events in last 60 seconds
- **Rain**: `PermissionRequest` pending for 30+ seconds

### Auto-approve rules

The `PermissionRequest` hook can return instant allow/deny without showing the UI. Add configurable auto-approve rules in Neon City:
- Always allow `Read`, `Glob`, `Grep` (read-only tools)
- Always allow `Bash` for specific commands (e.g. `npm test`, `npm run build`)
- Always deny `Bash` for specific patterns (e.g. `rm -rf`, `sudo`)

Store rules in `data/auto-approve-rules.json` and check them in the `/api/hooks/permission-request` handler before creating a notification.

---

## Hook Type Reference

Which hooks support `type: "http"` (direct POST) vs `type: "command"` only (need curl wrapper):

| Event | HTTP support | Notes |
|---|---|---|
| `PreToolUse` | Yes | Use `type: "http"` directly |
| `PostToolUse` | Yes | Use `type: "http"` directly |
| `PostToolUseFailure` | Yes | Use `type: "http"` directly |
| `PermissionRequest` | Yes | Use `type: "http"` directly. Can return allow/deny decision |
| `SessionStart` | No | Use `type: "command"` with curl |
| `SessionEnd` | No | Use `type: "command"` with curl |
| `SubagentStart` | No | Use `type: "command"` with curl |
| `SubagentStop` | No | Use `type: "command"` with curl |
| `Stop` | No | Use `type: "command"` with curl |
| `UserPromptSubmit` | No | Use `type: "command"` with curl |
| `Notification` | No | Use `type: "command"` with curl |

---

## Implementation Order

1. Add all `/api/hooks/*` endpoints to `server/src/index.ts` (Phase 1)
2. Add `findAgentBySessionId` helper
3. Add `approvalResolvers` Map and update `/api/approval/:id/decide`
4. Test endpoints manually with curl to verify they update state and broadcast correctly
5. Run `npm run hooks:install` to install hooks config
6. Restart Claude Code sessions so hooks take effect (hooks are captured at session startup)
7. Verify events flow through by watching the Neon City UI while using Claude Code
8. Once validated, remove legacy polling (Phase 3)
9. Build enhanced features (Phase 4)
