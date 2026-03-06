export interface AgentState {
  agentId: string;
  displayName: string;
  source: "claude" | "cursor" | "vscode";
  isThinking: boolean;
  currentCommand?: string;
  toolInput?: string;
  lastActivity: number;
  status: "idle" | "reading" | "writing" | "thinking" | "stuck" | "walking";
  waitingForApproval: boolean;
  agentKind: "session" | "subagent";
  agentType?: string;
  spawnId?: string;
  model?: string;
  sessionSource?: "startup" | "resume" | "clear" | "compact";
}

export interface Notification {
  id: string;
  type: "approval-needed" | "task-complete" | "error" | "info";
  agentId: string;
  agentName: string;
  toolName?: string;
  description: string;
  timestamp: number;
  resolved: boolean;
  approvalId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  sessionLabel?: string;
  timestamp: number;
}

export interface ToolActivity {
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
  responseSummary?: string;
}

export interface DiscoveredSession {
  sessionId: string;
  pid: number;
  workspaceFolders: string[];
  ideName: string;
  projectName: string;
  projectPath: string;
  title: string | null;
  lastActivity: number;
}

export type WeatherState = "clear" | "sunny" | "fog" | "rain" | "storm" | "snow" | "aurora";

export interface WeatherInfo {
  state: WeatherState;
  reason: string;
  lastCheck: number;
}

export interface ActiveSessionRecord {
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
}

export type EventType =
  | "SessionStart"
  | "SessionEnd"
  | "SubagentStart"
  | "SubagentStop"
  | "PermissionRequest"
  | "PostToolUseFailure"
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "PreCompact";

export interface EventRecord {
  id: string;
  timestamp: number;
  eventType: EventType;
  sessionId?: string;
  agentId?: string;
  agentKind?: "session" | "subagent";
  agentType?: string;
  projectPath?: string;
  projectName?: string;
  toolName?: string;
  toolUseId?: string;
  status?: string;
  reason?: string;
  payload: Record<string, unknown>;
}

export interface EventIngestPayload {
  eventType: EventType;
  timestamp?: number;
  sessionId?: string;
  agentId?: string;
  agentKind?: "session" | "subagent";
  agentType?: string;
  projectPath?: string;
  projectName?: string;
  toolName?: string;
  toolUseId?: string;
  status?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}
