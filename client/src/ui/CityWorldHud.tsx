import { useEffect, useMemo, useState } from "react";
import type { RawMessageListener } from "../hooks/useCityState";

interface EventRecord {
  id: string;
  timestamp: number;
  eventType: string;
  projectName?: string;
  toolName?: string;
  status?: string;
  reason?: string;
}

interface BillboardItem {
  id: string;
  tone: "urgent" | "warning" | "success" | "ambient";
  eyebrow: string;
  headline: string;
  detail: string;
  action: "alerts" | "history";
  priority: number;
  dwellMs?: number;
}

interface Props {
  liveAgentCount: number;
  workingAgentCount: number;
  liveSessionCount: number;
  approvalCount: number;
  focusMode: boolean;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
  onOpenAlerts: () => void;
  onOpenHistory: () => void;
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function formatClock(value: Date) {
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEventHeadline(event: EventRecord): BillboardItem | null {
  if (event.eventType === "PermissionRequest") {
    return {
      id: `approval-${event.id}`,
      tone: "urgent",
      eyebrow: "Needs Approval",
      headline: event.toolName ? `${event.toolName} request waiting` : "Approval waiting",
      detail: event.projectName || event.reason || "Claude is waiting for your go-ahead.",
      action: "alerts",
      priority: 3,
      dwellMs: 12000,
    };
  }

  if (event.eventType === "PostToolUseFailure") {
    return {
      id: `failure-${event.id}`,
      tone: "warning",
      eyebrow: "Attention",
      headline: event.toolName ? `${event.toolName} failed` : "Tool run failed",
      detail: event.reason || event.projectName || "Open alerts to inspect the failure.",
      action: "alerts",
      priority: 2,
      dwellMs: 9000,
    };
  }

  if (event.eventType === "SubagentStop" || event.eventType === "SessionEnd") {
    return {
      id: `complete-${event.id}`,
      tone: "success",
      eyebrow: "Completed",
      headline: event.projectName ? `${event.projectName} advanced` : "Agent finished work",
      detail: event.reason || "Review the latest event timeline in History.",
      action: "history",
      priority: 1,
      dwellMs: 7000,
    };
  }

  return null;
}

export function CityWorldHud({
  liveAgentCount,
  workingAgentCount,
  liveSessionCount,
  approvalCount,
  focusMode,
  subscribeToMessages,
  onOpenAlerts,
  onOpenHistory,
}: Props) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [billboardIndex, setBillboardIndex] = useState(0);
  const [interruptItem, setInterruptItem] = useState<BillboardItem | null>(null);
  const [interruptNonce, setInterruptNonce] = useState(0);

  useEffect(() => {
    fetch("/api/events/recent?limit=12")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.events)) {
          setEvents(data.events);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let clearTimer: number | undefined;

    return subscribeToMessages((msg) => {
      if (msg.type === "event" && msg.data) {
        const event = msg.data as EventRecord;
        setEvents((prev) => {
          const next = [event, ...prev.filter((existing) => existing.id !== event.id)];
          return next.slice(0, 12);
        });

        const interrupt = formatEventHeadline(event);
        if (interrupt) {
          window.clearTimeout(clearTimer);
          setInterruptItem(interrupt);
          setInterruptNonce((current) => current + 1);
          clearTimer = window.setTimeout(() => {
            setInterruptItem((current) => current?.id === interrupt.id ? null : current);
          }, interrupt.dwellMs ?? 8000);
        }
      }
    });
  }, [subscribeToMessages]);

  const completedToday = useMemo(() => {
    const today = startOfToday();
    return events.filter((event) => {
      if (event.timestamp < today) return false;
      return event.eventType === "SubagentStop" || event.eventType === "SessionEnd";
    }).length;
  }, [events]);

  const billboardItems = useMemo<BillboardItem[]>(() => {
    const items: BillboardItem[] = [];
    const primaryEvents = events
      .map(formatEventHeadline)
      .filter((item): item is BillboardItem => item !== null);

    const approvalItem = primaryEvents.find((item) => item.tone === "urgent");
    const failureItem = primaryEvents.find((item) => item.tone === "warning");
    const completionItem = primaryEvents.find((item) => item.tone === "success");

    if (approvalItem) items.push(approvalItem);
    if (failureItem) items.push(failureItem);
    if (completionItem) items.push(completionItem);

    items.push({
      id: "active-now",
      tone: workingAgentCount > 0 ? "ambient" : "success",
      eyebrow: "Active Now",
      headline: `${workingAgentCount} working agents across ${liveSessionCount} sessions`,
      detail: workingAgentCount > 0
        ? `${liveAgentCount} total agents are moving through the city.`
        : "No agents are actively working right now. Spawn one to light up the skyline.",
      action: "history",
      priority: 0,
    });

    const latestProject = events.find((event) => event.projectName)?.projectName;
    items.push({
      id: "mission-stats",
      tone: approvalCount > 0 ? "warning" : "ambient",
      eyebrow: "Mission Board",
      headline: `${approvalCount} approvals · ${completedToday} completions today`,
      detail: approvalCount > 0
        ? "Open Alerts to clear pending decisions."
        : latestProject
          ? `${latestProject} is the freshest workspace in the city feed.`
          : "Recent progress is flowing cleanly through the city.",
      action: approvalCount > 0 ? "alerts" : "history",
      priority: approvalCount > 0 ? 1 : 0,
    });

    return items;
  }, [approvalCount, completedToday, events, liveAgentCount, liveSessionCount, workingAgentCount]);

  useEffect(() => {
    if (interruptItem || billboardItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setBillboardIndex((current) => (current + 1) % billboardItems.length);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [billboardItems.length, interruptItem]);

  useEffect(() => {
    setBillboardIndex(0);
  }, [approvalCount, liveAgentCount, liveSessionCount, workingAgentCount]);

  const activeBillboard = interruptItem || billboardItems[billboardIndex] || billboardItems[0];
  const billboardMotionClass = interruptItem
    ? activeBillboard?.tone === "urgent"
      ? "billboard-flash"
      : activeBillboard?.tone === "warning"
        ? "billboard-alert"
        : "billboard-celebrate"
    : "";

  return (
    <div className={`city-world-hud ${focusMode ? "focus-mode" : ""}`}>
      <button
        type="button"
        className={`city-billboard tone-${activeBillboard?.tone || "ambient"} ${billboardMotionClass}`}
        onClick={activeBillboard?.action === "alerts" ? onOpenAlerts : onOpenHistory}
        key={`${activeBillboard?.id || "fallback"}-${interruptNonce}`}
      >
        <span className="city-billboard-pole left" />
        <span className="city-billboard-pole right" />
        <span className="city-billboard-frame" />
        <span className="city-billboard-inner">
          <span className="city-billboard-label">City Broadcast</span>
          <span className="city-billboard-eyebrow">{activeBillboard?.eyebrow || "Mission Board"}</span>
          <span className="city-billboard-headline">{activeBillboard?.headline || "Neon City standing by"}</span>
          <span className="city-billboard-detail">{activeBillboard?.detail || "Pick a workspace and the skyline will respond."}</span>
        </span>
      </button>

      <div className="city-mission-sign">
        <div className="city-world-label">Mission Counter</div>
        <div className="city-mission-grid">
          <div className="city-metric">
            <span className="city-metric-value">{liveSessionCount}</span>
            <span className="city-metric-label">Sessions</span>
          </div>
          <div className="city-metric">
            <span className="city-metric-value">{liveAgentCount}</span>
            <span className="city-metric-label">Agents</span>
          </div>
          <div className="city-metric warning">
            <span className="city-metric-value">{workingAgentCount}</span>
            <span className="city-metric-label">Working</span>
          </div>
          <div className="city-metric success">
            <span className="city-metric-value">{completedToday}</span>
            <span className="city-metric-label">Done Today</span>
          </div>
        </div>
      </div>

      <div className="city-clock">
        <span className="city-world-label">Local Time</span>
        <span className="city-clock-value">{formatClock(clockNow)}</span>
      </div>
    </div>
  );
}
