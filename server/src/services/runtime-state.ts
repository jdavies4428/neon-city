import type { ChildProcess } from "child_process";
import { WebSocket } from "ws";
import type { AgentState, ChatMessage, Notification, ToolActivity } from "../types.js";

export class RuntimeState {
  readonly agents = new Map<string, AgentState>();
  readonly clients = new Set<WebSocket>();
  readonly notifications: Notification[] = [];
  readonly chatHistory: ChatMessage[] = [];
  readonly sessionToSpawnId = new Map<string, string>();
  readonly unlinkedSubagents: string[] = [];
  readonly agentIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly toolActivities = new Map<string, ToolActivity>();
  readonly spawnedProcesses = new Map<string, ChildProcess>();
  readonly chatWatchers = new Map<string, ReturnType<typeof setInterval>>();

  private notifCounter = 0;
  private chatCounter = 0;
  private toolActivityCounter = 0;
  private pendingBroadcasts = new Map<string, unknown>();
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  broadcast(type: string, data: unknown) {
    const msg = JSON.stringify({ type, data });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  broadcastThrottled(type: string, data: unknown) {
    this.pendingBroadcasts.set(type, data);

    if (!this.broadcastTimer) {
      this.broadcastTimer = setInterval(() => {
        if (this.pendingBroadcasts.size === 0) {
          clearInterval(this.broadcastTimer!);
          this.broadcastTimer = null;
          return;
        }
        for (const [pendingType, pendingData] of this.pendingBroadcasts) {
          this.broadcast(pendingType, pendingData);
        }
        this.pendingBroadcasts.clear();
      }, 66);
    }
  }

  pushNotification(
    fields: Omit<Notification, "id" | "timestamp" | "resolved">,
    broadcastExtras?: Record<string, unknown>
  ): Notification {
    const notif: Notification = {
      ...fields,
      id: `notif-${++this.notifCounter}`,
      timestamp: Date.now(),
      resolved: false,
    };
    this.notifications.push(notif);
    if (this.notifications.length > 200) {
      this.notifications.splice(0, this.notifications.length - 200);
    }
    this.broadcast("notification", broadcastExtras ? { ...notif, ...broadcastExtras } : notif);
    return notif;
  }

  pushChatMessage(msg: Omit<ChatMessage, "id"> & { id?: string }) {
    const nextMessage: ChatMessage = {
      ...msg,
      id: msg.id ?? this.nextChatMessageId(),
    };
    this.chatHistory.push(nextMessage);
    if (this.chatHistory.length > 500) {
      this.chatHistory.splice(0, this.chatHistory.length - 500);
    }
    this.broadcast("chat-message", nextMessage);
    return nextMessage;
  }

  nextChatMessageId() {
    return `msg-${++this.chatCounter}`;
  }

  nextToolActivityId() {
    return `tool-${++this.toolActivityCounter}`;
  }

  clearIdleTimer(agentId: string) {
    clearTimeout(this.agentIdleTimers.get(agentId));
    this.agentIdleTimers.delete(agentId);
  }

  scheduleDebouncedIdle(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.lastActivity = Date.now();
    const completedTool = agent.currentCommand;
    this.clearIdleTimer(agentId);
    this.agentIdleTimers.set(agentId, setTimeout(() => {
      this.agentIdleTimers.delete(agentId);
      const activeAgent = this.agents.get(agentId);
      if (activeAgent && (activeAgent.currentCommand === completedTool || !activeAgent.currentCommand)) {
        activeAgent.currentCommand = undefined;
        activeAgent.toolInput = undefined;
        activeAgent.status = "idle";
        activeAgent.lastActivity = Date.now();
        this.broadcastThrottled("activity", { agent: activeAgent });
      }
    }, 2000));
  }

  agentDisplayName(agentId: string | undefined, fallback = "Claude") {
    return this.agents.get(agentId || "")?.displayName || fallback;
  }
}
