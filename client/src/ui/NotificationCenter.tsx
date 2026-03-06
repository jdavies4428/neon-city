import { useEffect, useState } from "react";
import type { RawMessageListener } from "../hooks/useCityState";
import { formatTime } from "../shared/format";
import { translateToolActivity } from "../shared/activityTranslator";

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

interface ApprovalRequestDetails {
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

interface EventRecord {
  id: string;
  timestamp: number;
  eventType: string;
  sessionId?: string;
  agentId?: string;
  agentKind?: string;
  agentType?: string;
  projectPath?: string;
  projectName?: string;
  toolName?: string;
  toolUseId?: string;
  status?: string;
  reason?: string;
  payload: Record<string, unknown>;
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
  responseSummary?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
  onSpawnFromAlert?: (context: { prompt?: string; projectPath?: string }) => void;
}

type DiffLine = {
  type: "context" | "add" | "remove";
  text: string;
};

type DiffToken = {
  type: "context" | "add" | "remove";
  text: string;
};

function buildLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "context", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ type: "remove", text: a[i]! });
      i++;
    } else {
      lines.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) {
    lines.push({ type: "remove", text: a[i]! });
    i++;
  }
  while (j < b.length) {
    lines.push({ type: "add", text: b[j]! });
    j++;
  }
  return lines;
}

function ApprovalDiff({ before, after }: { before: string; after: string }) {
  const lines = buildLineDiff(before, after);
  const rendered: React.ReactNode[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const next = lines[index + 1];

    if (line.type === "remove" && next?.type === "add") {
      const tokenDiff = compactDiffTokens(buildTokenDiff(line.text, next.text));
      rendered.push(
        <div key={`pair-${index}`} className="approval-diff-pair">
          <DiffRow line={line} tokens={tokenDiff.filter((token) => token.type !== "add")} />
          <DiffRow line={next} tokens={tokenDiff.filter((token) => token.type !== "remove")} />
        </div>
      );
      index += 1;
      continue;
    }

    rendered.push(<DiffRow key={`line-${index}`} line={line} />);
  }

  return (
    <div className="approval-inline-diff">
      {rendered}
    </div>
  );
}

function tokenizeForDiff(value: string): string[] {
  return value.split(/(\s+)/).filter((token) => token.length > 0);
}

function buildTokenDiff(before: string, after: string): DiffToken[] {
  const a = tokenizeForDiff(before);
  const b = tokenizeForDiff(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      tokens.push({ type: "context", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      tokens.push({ type: "remove", text: a[i]! });
      i++;
    } else {
      tokens.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) {
    tokens.push({ type: "remove", text: a[i]! });
    i++;
  }
  while (j < b.length) {
    tokens.push({ type: "add", text: b[j]! });
    j++;
  }
  return tokens;
}

function compactDiffTokens(tokens: DiffToken[]): DiffToken[] {
  const compacted: DiffToken[] = [];

  for (const token of tokens) {
    const last = compacted[compacted.length - 1];
    if (last && last.type === token.type) {
      last.text += token.text;
      continue;
    }
    compacted.push({ ...token });
  }

  return compacted;
}

function DiffRow({ line, tokens }: { line: DiffLine; tokens?: DiffToken[] }) {
  const renderTokens = tokens ?? [{ type: "context", text: line.text || " " }];

  return (
    <div className={`approval-diff-line ${line.type}`}>
      <span className="approval-diff-gutter">
        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
      </span>
      <code className="approval-diff-code">
        {renderTokens.map((token, index) => (
          <span key={`${token.type}-${index}`} className={`approval-diff-token ${token.type}`}>
            {token.text}
          </span>
        ))}
      </code>
    </div>
  );
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
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"alerts" | "activity">("alerts");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [approvalDetails, setApprovalDetails] = useState<Record<string, ApprovalRequestDetails>>({});
  const [editedCommands, setEditedCommands] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    fetch("/api/events/recent?limit=30")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.events)) {
          setEvents(data.events);
        }
      })
      .catch(() => {});
  }, [open]);

  // Receive notification and tool-activity events through the shared WS
  // connection — no separate WebSocket needed here.
  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (msg.type === "init") {
        if (msg.data.notifications) {
          setNotifications(msg.data.notifications);
        }
        if (msg.data.toolActivities) {
          setToolActivities(msg.data.toolActivities);
        }
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
      } else if (msg.type === "event") {
        setEvents((prev) => [msg.data, ...prev.filter((event) => event.id !== msg.data.id)].slice(0, 50));
      }
    });
  }, [subscribeToMessages]);

  // Report unresolved alert count to parent
  useEffect(() => {
    const pending = notifications.filter((n) => !n.resolved);
    onCountChange(pending.length);
  }, [notifications, onCountChange]);

  // ----- Approval actions -----

  const approveAction = async (
    approvalId: string,
    notifId: string,
    options?: { updatedInput?: unknown; approveAll?: boolean }
  ) => {
    try {
      await fetch(`/api/approval/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve", ...options }),
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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    for (const notif of notifications) {
      if (!notif.approvalId || !expandedIds.has(notif.id) || approvalDetails[notif.approvalId]) continue;
      fetch(`/api/approval/${notif.approvalId}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.request) return;
          setApprovalDetails((prev) => ({ ...prev, [notif.approvalId!]: data.request }));
          const raw = data.request.rawToolInput as { command?: string } | undefined;
          if (raw?.command) {
            setEditedCommands((prev) => ({ ...prev, [notif.approvalId!]: raw.command || "" }));
          }
        })
        .catch(() => {});
    }
  }, [notifications, expandedIds, approvalDetails]);

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
  const approvalCount = notifications.filter(
    (n) => n.type === "approval-needed" && !n.resolved && n.approvalId
  ).length;
  const interestingEvents = events.filter((event) =>
    ["PermissionRequest", "PostToolUseFailure", "SubagentStart", "SubagentStop", "SessionStart", "SessionEnd"].includes(event.eventType)
  );
  const pendingApprovals = notifications.filter((n) => n.type === "approval-needed" && !n.resolved && n.approvalId);
  const errorNotifications = notifications.filter((n) => n.type === "error" && !n.resolved);
  const otherNotifications = notifications.filter((n) => n.type !== "approval-needed" && n.type !== "error" && !n.resolved);

  const isCommandInput = (value: unknown): value is { command: string; description?: string } =>
    Boolean(value && typeof value === "object" && "command" in value && typeof (value as { command?: unknown }).command === "string");

  const isEditLikeInput = (value: unknown): value is { file_path?: string; path?: string; old_string?: string; new_string?: string; content?: string } =>
    Boolean(value && typeof value === "object" && ("file_path" in value || "path" in value || "content" in value));

  const renderApprovalInput = (approvalId: string, detail?: ApprovalRequestDetails) => {
    const raw = detail?.rawToolInput;
    if (!raw) return null;

    if (isCommandInput(raw)) {
      const currentCommand = editedCommands[approvalId] ?? raw.command;
      const danger = /\b(rm\s+-rf|sudo|chmod\s+777|git\s+reset\s+--hard|mkfs|dd\s+if=|shutdown)\b/i.test(currentCommand);
      return (
        <div className="approval-detail-block">
          <div className="approval-detail-label">Command</div>
          <textarea
            className="approval-command-editor"
            value={currentCommand}
            onChange={(e) =>
              setEditedCommands((prev) => ({ ...prev, [approvalId]: e.target.value }))
            }
          />
          <div className={`approval-risk ${danger ? "danger" : "normal"}`}>
            {danger ? "High-impact shell command. Review carefully before allowing." : "Command looks routine. You can edit it before approval."}
          </div>
        </div>
      );
    }

    if (isEditLikeInput(raw)) {
      const targetPath = raw.file_path || raw.path || detail?.projectPath || "Unknown target";
      const hasPatch = typeof raw.old_string === "string" || typeof raw.new_string === "string";
      const hasContent = typeof raw.content === "string";

      return (
        <div className="approval-detail-block">
          <div className="approval-detail-label">Target</div>
          <div className="approval-file-target">{String(targetPath)}</div>
          {hasPatch && (
            <>
              <div className="approval-diff-label">Diff Preview</div>
              <ApprovalDiff
                before={String(raw.old_string || "")}
                after={String(raw.new_string || "")}
              />
            </>
          )}
          {hasContent && (
            <>
              <div className="approval-diff-label">Proposed Content</div>
              <pre className="approval-input-preview">{String(raw.content)}</pre>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="approval-detail-block">
        <div className="approval-detail-label">Requested Input</div>
        <pre className="approval-input-preview">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    );
  };

  const renderApprovalCard = (notif: Notification) => {
    const detail = notif.approvalId ? approvalDetails[notif.approvalId] : undefined;
    const raw = detail?.rawToolInput;
    const updatedInput = isCommandInput(raw)
      ? { ...raw, command: editedCommands[notif.approvalId!] ?? raw.command }
      : undefined;
    const targetPath = isEditLikeInput(raw) ? raw.file_path || raw.path : undefined;
    return (
      <div
        key={notif.id}
        className={`notif-item approval approval-card ${expandedIds.has(notif.id) ? "expanded" : ""}`}
        onClick={() => toggleExpand(notif.id)}
        style={{ cursor: "pointer" }}
      >
        <div className="approval-card-topline">
          <span className="approval-card-kicker">Needs Approval</span>
          <span className="notif-time">{formatTime(notif.timestamp)}</span>
        </div>
        <div className="approval-card-title">{notif.toolName || "Action"} for {detail?.projectName || notif.agentName}</div>
        <div className="approval-card-summary">
          {detail?.projectPath || notif.description}
        </div>
        <div className="approval-card-meta">
          <span>{detail?.agentName || notif.agentName}</span>
          {targetPath ? <span>{String(targetPath)}</span> : null}
        </div>

        <div className="notif-actions approval-actions" onClick={(e) => e.stopPropagation()}>
          {renderApprovalInput(notif.approvalId!, detail)}
          <button
            className="notif-approve"
            onClick={() => approveAction(notif.approvalId!, notif.id, updatedInput ? { updatedInput } : undefined)}
          >
            Allow Once
          </button>
          <button
            className="notif-approve-all"
            onClick={() => approveAllAction(notif.approvalId!, notif.toolName ?? "", notif.id)}
          >
            Allow Always
          </button>
          <button
            className="notif-deny"
            onClick={() => denyAction(notif.approvalId!, notif.id)}
          >
            Deny
          </button>
        </div>
      </div>
    );
  };

  const renderStandardNotification = (notif: Notification) => (
    <div
      key={notif.id}
      className={`notif-item ${typeToClass(notif.type)} ${expandedIds.has(notif.id) ? "expanded" : ""}`}
      onClick={() => toggleExpand(notif.id)}
      style={{ cursor: "pointer" }}
    >
      <div className="notif-header">
        <span className="notif-agent">{notif.agentName}</span>
        <span className="notif-time">{formatTime(notif.timestamp)}</span>
      </div>
      <div className={`notif-type ${typeToClass(notif.type)}`}>
        {typeToLabel(notif.type)}
      </div>
      <div className={`notif-desc ${expandedIds.has(notif.id) ? "expanded" : "truncated"}`}>
        {notif.toolName && (
          <span className="notif-tool">{notif.toolName}</span>
        )}
        {notif.description}
      </div>
      {!expandedIds.has(notif.id) && notif.description && notif.description.length > 100 && (
        <span className="notif-read-more">Click to read more...</span>
      )}
      <div className="notif-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="notif-dismiss"
          onClick={() => resolve(notif.id)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );

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
          {approvalCount > 0 && <span className="approval-count-badge">{approvalCount}</span>}
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
          {pendingApprovals.length === 0 && errorNotifications.length === 0 && otherNotifications.length === 0 && (
            <div className="notif-empty">
              <div className="notif-empty-icon">v</div>
              <div>All clear — no pending alerts</div>
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <div className="alert-section">
              <div className="alert-section-title">Needs Approval</div>
              {pendingApprovals.map(renderApprovalCard)}
            </div>
          )}
          {errorNotifications.length > 0 && (
            <div className="alert-section">
              <div className="alert-section-title">Errors</div>
              {errorNotifications.map(renderStandardNotification)}
            </div>
          )}
          {otherNotifications.length > 0 && (
            <div className="alert-section">
              <div className="alert-section-title">Recent Activity</div>
              {otherNotifications.map(renderStandardNotification)}
            </div>
          )}
          {interestingEvents.length > 0 && (
            <div className="alert-event-section">
              <div className="alert-event-section-title">Recent Event Feed</div>
              {interestingEvents.slice(0, 8).map((event) => (
                <div key={event.id} className={`event-feed-item ${event.eventType}`}>
                  <div className="event-feed-header">
                    <span className="event-feed-type">{event.eventType}</span>
                    <span className="event-feed-time">{formatTime(event.timestamp)}</span>
                  </div>
                  <div className="event-feed-copy">
                    {String(event.projectName || event.agentId || "Claude")}{event.reason ? ` · ${String(event.reason)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
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
          {toolActivities.map((activity) => {
            const translated = translateToolActivity(activity.toolName, activity.toolInput);
            return (
            <div
              key={activity.id}
              className={`tool-activity-card ${activity.status}`}
              title={`${activity.toolName}: ${activity.toolInput}`}
            >
              <div className="tool-activity-header">
                <span
                  className="tool-activity-icon"
                  style={{ color: translated.color }}
                >
                  {translated.icon}
                </span>
                <span className="tool-activity-name">{translated.friendlyText}</span>
                <span className={`tool-activity-status ${activity.status}`}>
                  {activity.status.toUpperCase()}
                </span>
              </div>
              <div className="tool-activity-input">{activity.toolInput}</div>
              {activity.responseSummary && activity.status === "complete" && (
                <div style={{
                  fontSize: "10px",
                  color: "#40ff80",
                  fontFamily: "monospace",
                  marginTop: "2px",
                  opacity: 0.85,
                }}>
                  → {activity.responseSummary}
                </div>
              )}
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
            );
          })}
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
