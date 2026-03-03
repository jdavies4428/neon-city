import { useEffect, useState } from "react";
import type { RawMessageListener } from "../hooks/useCityState";

interface Notification {
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

interface Props {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
  onSpawnFromAlert?: (context: { prompt?: string; projectPath?: string }) => void;
}

export function NotificationCenter({
  open,
  onClose,
  onCountChange,
  subscribeToMessages,
  onSpawnFromAlert,
}: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [activeTab, setActiveTab] = useState<"alerts" | "activity">("alerts");

  // Receive notification and tool-activity events through the shared WS
  // connection — no separate WebSocket needed here.
  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (msg.type === "init" && msg.data.notifications) {
        setNotifications(msg.data.notifications);
      } else if (msg.type === "init" && msg.data.toolActivities) {
        setToolActivities(msg.data.toolActivities);
      } else if (msg.type === "notification") {
        setNotifications((prev) => [msg.data, ...prev]);
      } else if (msg.type === "notification-resolved") {
        setNotifications((prev) => prev.filter((n) => n.id !== msg.data.id));
      } else if (msg.type === "tool-activity") {
        setToolActivities((prev) => {
          const idx = prev.findIndex((a) => a.id === msg.data.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = msg.data;
            return updated;
          }
          return [msg.data, ...prev].slice(0, 50);
        });
      }
    });
  }, [subscribeToMessages]);

  // Report unresolved alert count to parent
  useEffect(() => {
    const pending = notifications.filter((n) => !n.resolved);
    onCountChange(pending.length);
  }, [notifications, onCountChange]);

  // ----- Approval actions -----

  const approveAction = async (approvalId: string, notifId: string) => {
    try {
      await fetch(`/api/approval/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    } catch (err) {
      console.error("Approve failed:", err);
    }
  };

  const approveAllAction = async (
    approvalId: string,
    toolName: string,
    notifId: string
  ) => {
    try {
      await fetch(`/api/approval/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve", approveAll: true }),
      });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    } catch (err) {
      console.error("Approve-all failed:", err);
    }
  };

  const denyAction = async (approvalId: string, notifId: string) => {
    try {
      await fetch(`/api/approval/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "deny" }),
      });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    } catch (err) {
      console.error("Deny failed:", err);
    }
  };

  // Dismiss for non-approval notifications
  const resolve = async (id: string) => {
    try {
      await fetch(`/api/notification/${id}/resolve`, { method: "POST" });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error("Resolve failed:", err);
    }
  };

  const resolveAll = async () => {
    for (const n of notifications) {
      await fetch(`/api/notification/${n.id}/resolve`, { method: "POST" });
    }
    setNotifications([]);
  };

  // ----- Helpers -----

  const typeToClass = (type: string) => {
    if (type === "approval-needed") return "approval";
    if (type === "task-complete") return "complete";
    if (type === "error") return "error";
    return "info";
  };

  const typeToLabel = (type: string) => {
    if (type === "approval-needed") return "APPROVAL NEEDED";
    if (type === "task-complete") return "COMPLETE";
    if (type === "error") return "ERROR";
    return "INFO";
  };

  const pendingCount = notifications.filter((n) => !n.resolved).length;

  return (
    <div className={`slide-panel left ${open ? "open" : ""}`}>
      {/* Panel header */}
      <div className="panel-header">
        <span className="panel-title">ALERTS</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {notifications.length > 0 && (
            <button
              className="notif-dismiss"
              onClick={resolveAll}
              style={{ fontSize: 9 }}
            >
              Clear all
            </button>
          )}
          <button className="panel-close" onClick={onClose}>
            x
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="notif-tabs">
        <button
          className={`notif-tab ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => setActiveTab("alerts")}
        >
          Alerts
          {pendingCount > 0 && (
            <span className="notif-tab-badge">{pendingCount}</span>
          )}
        </button>
        <button
          className={`notif-tab ${activeTab === "activity" ? "active" : ""}`}
          onClick={() => setActiveTab("activity")}
        >
          Activity
        </button>
      </div>

      {/* Alerts tab */}
      {activeTab === "alerts" && (
        <div className="notif-list">
          {notifications.length === 0 && (
            <div className="notif-empty">
              <div className="notif-empty-icon">v</div>
              <div>All clear — no pending alerts</div>
            </div>
          )}
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`notif-item ${typeToClass(notif.type)}`}
            >
              <div className="notif-header">
                <span className="notif-agent">{notif.agentName}</span>
                <span className="notif-time">{formatTime(notif.timestamp)}</span>
              </div>
              <div className={`notif-type ${typeToClass(notif.type)}`}>
                {typeToLabel(notif.type)}
              </div>
              <div className="notif-desc">
                {notif.toolName && (
                  <span className="notif-tool">{notif.toolName}</span>
                )}
                {notif.description}
              </div>

              {notif.type === "approval-needed" && notif.approvalId ? (
                <div className="notif-actions approval-actions">
                  <button
                    className="notif-approve"
                    onClick={() =>
                      approveAction(notif.approvalId!, notif.id)
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="notif-approve-all"
                    onClick={() =>
                      approveAllAction(
                        notif.approvalId!,
                        notif.toolName ?? "",
                        notif.id
                      )
                    }
                  >
                    Approve All ({notif.toolName})
                  </button>
                  <button
                    className="notif-deny"
                    onClick={() => denyAction(notif.approvalId!, notif.id)}
                  >
                    Deny
                  </button>
                </div>
              ) : (
                <div className="notif-actions">
                  <button
                    className="notif-dismiss"
                    onClick={() => resolve(notif.id)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div className="notif-list">
          {toolActivities.length === 0 && (
            <div className="notif-empty">
              <div className="notif-empty-icon">~</div>
              <div>No recent tool activity</div>
            </div>
          )}
          {toolActivities.map((activity) => (
            <div
              key={activity.id}
              className={`tool-activity-card ${activity.status}`}
            >
              <div className="tool-activity-header">
                <span className="tool-activity-icon">
                  {toolIcon(activity.toolName)}
                </span>
                <span className="tool-activity-name">{activity.toolName}</span>
                <span className={`tool-activity-status ${activity.status}`}>
                  {activity.status.toUpperCase()}
                </span>
              </div>
              <div className="tool-activity-input">{activity.toolInput}</div>
              <div className="tool-activity-meta">
                <span className="tool-activity-agent">{activity.agentName}</span>
                <span className="tool-activity-time">
                  {formatTime(activity.startedAt)}
                </span>
              </div>
              {activity.error && (
                <div className="tool-activity-error">{activity.error}</div>
              )}
              {activity.status === "error" && onSpawnFromAlert && (
                <button
                  className="notif-spawn-btn"
                  onClick={() =>
                    onSpawnFromAlert({
                      prompt: `Fix the error from ${activity.toolName}: ${activity.toolInput}\nError: ${activity.error}`,
                    })
                  }
                >
                  Spawn Agent to Fix
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Pure helpers (no hooks) -----

function toolIcon(toolName: string): string {
  switch (toolName) {
    case "Bash":
      return ">";
    case "Read":
      return "R";
    case "Write":
      return "W";
    case "Edit":
      return "E";
    case "Grep":
      return "?";
    case "Glob":
      return "*";
    case "WebFetch":
      return "@";
    case "Agent":
      return "A";
    default:
      return "#";
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
