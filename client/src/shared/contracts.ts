export interface ActiveSession {
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

export interface WorkspaceTarget {
  projectName: string;
  projectPath: string;
  preferredSessionId?: string;
  source: "session" | "project";
  isLive: boolean;
  ideName?: string;
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  sessionLabel?: string;
  timestamp: number;
}
