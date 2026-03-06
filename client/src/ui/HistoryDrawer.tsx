import { useEffect, useState, useRef, useCallback } from "react";
import { useHistory, type HistoryEvent, type HistorySession } from "../hooks/useHistory";
import type { RawMessageListener } from "../hooks/useCityState";

interface Props {
  open: boolean;
  onClose: () => void;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
}

type Tab = "sessions" | "search" | "plans" | "events";

const EVENT_TYPE_OPTIONS = [
  "PermissionRequest",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreToolUse",
  "PostToolUse",
] as const;

function renderSearchSnippet(snippet: string) {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
      return <mark key={`${part}-${index}`}>{part.slice(6, -7)}</mark>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function HistoryDrawer({ open, onClose, subscribeToMessages }: Props) {
  const {
    projects, sessions, messages, searchResults, plans, events, eventsTotal, eventsHasMore, eventsCursor, stats, loading,
    fetchProjects, fetchSessions, fetchSessionMessages, search, fetchPlans, fetchEvents, appendEventsPage, fetchStats, prependEvent,
  } = useHistory();

  const [tab, setTab] = useState<Tab>("sessions");
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [eventProjectPath, setEventProjectPath] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [approvalOnly, setApprovalOnly] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const EVENTS_PAGE_SIZE = 25;

  // Load data when drawer opens
  useEffect(() => {
    if (!open) return;
    fetchProjects();
    fetchStats();
    fetchSessions(undefined);
    fetchPlans();
    fetchEvents({ limit: EVENTS_PAGE_SIZE });
  }, [open, fetchProjects, fetchStats, fetchSessions, fetchPlans, fetchEvents]);

  // Fetch sessions when project filter changes
  useEffect(() => {
    if (open) fetchSessions(selectedProject);
  }, [selectedProject, open, fetchSessions]);

  useEffect(() => {
    if (!open || tab !== "events") return;
    fetchEvents({
      limit: EVENTS_PAGE_SIZE,
      eventType: eventTypeFilter || undefined,
      projectPath: eventProjectPath || undefined,
      approvalOnly,
    });
  }, [open, tab, eventProjectPath, eventTypeFilter, approvalOnly, fetchEvents]);

  useEffect(() => {
    if (!open) return;
    return subscribeToMessages((msg) => {
      if (msg.type === "event" && msg.data) {
        prependEvent(msg.data as HistoryEvent);
      }
    });
  }, [open, prependEvent, subscribeToMessages]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Debounced search
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => search(q), 300);
  }, [search]);

  const handleSessionClick = (session: HistorySession) => {
    setSelectedSession(session.id);
    fetchSessionMessages(session.id);
  };

  const handleBack = () => {
    setSelectedSession(null);
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return "";
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const truncate = (s: string | null, len: number) => {
    if (!s) return "";
    return s.length > len ? s.slice(0, len) + "..." : s;
  };

  const formatEventTitle = (event: HistoryEvent) => {
    if (event.eventType === "PermissionRequest") return "Approval requested";
    if (event.eventType === "PostToolUseFailure") return "Tool failed";
    if (event.eventType === "SubagentStart") return "Agent started";
    if (event.eventType === "SubagentStop") return "Agent finished";
    if (event.eventType === "SessionStart") return "Session started";
    if (event.eventType === "SessionEnd") return "Session ended";
    return event.eventType;
  };

  const formatEventSummary = (event: HistoryEvent) => {
    if (event.reason) return event.reason;
    if (event.toolName) return `${event.toolName} in ${event.projectName || "workspace"}`;
    if (typeof event.payload.message === "string") return event.payload.message;
    if (typeof event.payload.description === "string") return event.payload.description;
    if (event.projectName) return `Activity in ${event.projectName}`;
    return "Recent Claude activity";
  };

  const handleLoadMoreEvents = () => {
    if (!eventsCursor) return;
    appendEventsPage({
      limit: EVENTS_PAGE_SIZE,
      eventType: eventTypeFilter || undefined,
      projectPath: eventProjectPath || undefined,
      approvalOnly,
      beforeTimestamp: eventsCursor.beforeTimestamp,
      beforeId: eventsCursor.beforeId,
    });
  };

  return (
    <div className={`history-drawer ${open ? "open" : ""}`}>
      {/* Handle */}
      <div className="drawer-handle" onClick={open ? onClose : undefined}>
        <div className="drawer-handle-bar" />
      </div>

      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title-row">
          <span className="panel-title">HISTORY</span>
          {stats && (
            <span className="drawer-stats">
              {stats.projects}P / {stats.sessions}S / {stats.messages}M
            </span>
          )}
          <button className="panel-close" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {(["sessions", "search", "plans", "events"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`drawer-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "sessions" ? "Sessions" : t === "search" ? "Search" : t === "plans" ? "Plans" : "Events"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="drawer-content">
        {/* Sessions Tab */}
        {tab === "sessions" && !selectedSession && (
          <>
            {/* Project filter */}
            <div className="drawer-filter">
              <select
                name="drawer-project"
                className="drawer-select"
                value={selectedProject ?? ""}
                onChange={(e) => setSelectedProject(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.session_count})</option>
                ))}
              </select>
            </div>

            {/* Session list */}
            <div className="drawer-list">
              {loading && sessions.length === 0 && (
                <div className="drawer-empty drawer-empty-rich">
                  <div className="drawer-empty-icon">⌛</div>
                  <div className="drawer-empty-title">Building session history</div>
                  <div className="drawer-empty-copy">
                    Neon City is indexing Claude sessions so search, plans, and project history can open with real context.
                  </div>
                </div>
              )}
              {!loading && sessions.length === 0 && (
                <div className="drawer-empty drawer-empty-rich">
                  <div className="drawer-empty-icon">📭</div>
                  <div className="drawer-empty-title">No sessions found</div>
                  <div className="drawer-empty-copy">
                    Try a different project filter, or start a Claude session in one of your workspaces to populate this view.
                  </div>
                </div>
              )}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className="session-card"
                  onClick={() => handleSessionClick(s)}
                >
                  <div className="session-card-header">
                    <span className="session-project">{s.project_name}</span>
                    <span className="session-time">{formatTime(s.last_message_at)}</span>
                  </div>
                  <div className="session-title">{truncate(s.title, 80) || "Untitled session"}</div>
                  <div className="session-meta">
                    {s.message_count} messages
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Session detail view */}
        {tab === "sessions" && selectedSession && (
          <>
            <div className="drawer-filter">
              <button className="drawer-back" onClick={handleBack}>← Back to sessions</button>
            </div>
            <div className="drawer-messages">
              {messages.map((m) => (
                <div key={m.id} className={`history-msg ${m.role}`}>
                  <div className="history-msg-header">
                    <span className={`history-msg-role ${m.role}`}>
                      {m.role === "user" ? "You" : "Claude"}
                    </span>
                    {m.tool_name && <span className="history-msg-tool">{m.tool_name}</span>}
                    <span className="history-msg-time">{formatTime(m.timestamp)}</span>
                  </div>
                  <div className="history-msg-content">
                    {truncate(m.content, 500)}
                  </div>
                  {m.file_path && (
                    <div className="history-msg-file">{m.file_path}</div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}

        {/* Search Tab */}
        {tab === "search" && (
          <>
            <div className="drawer-filter">
              <input
                name="drawer-search"
                className="drawer-search-input"
                type="text"
                placeholder="Search across all sessions..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                autoFocus={tab === "search"}
              />
            </div>
            <div className="drawer-list">
              {loading && (
                <div className="drawer-empty drawer-empty-rich">
                  <div className="drawer-empty-icon">⌕</div>
                  <div className="drawer-empty-title">Searching history</div>
                  <div className="drawer-empty-copy">Scanning indexed sessions, plans, and messages for the best matches.</div>
                </div>
              )}
              {!loading && searchQuery && searchResults.length === 0 && (
                <div className="drawer-empty drawer-empty-rich">
                  <div className="drawer-empty-icon">∅</div>
                  <div className="drawer-empty-title">No results for "{searchQuery}"</div>
                  <div className="drawer-empty-copy">Try a tool name, file path, branch term, or a shorter phrase from the conversation.</div>
                </div>
              )}
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  className="search-result"
                  onClick={() => {
                    setTab("sessions");
                    setSelectedSession(r.session_id);
                    fetchSessionMessages(r.session_id);
                  }}
                >
                  <div className="search-result-header">
                    <span className="session-project">{r.project_name}</span>
                    <span className={`history-msg-role ${r.role}`}>
                      {r.role === "user" ? "You" : "Claude"}
                    </span>
                    <span className="session-time">{formatTime(r.timestamp)}</span>
                  </div>
                  <div
                    className="search-result-snippet"
                  >
                    {renderSearchSnippet(r.snippet)}
                  </div>
                  {r.session_title && (
                    <div className="search-result-session">
                      {truncate(r.session_title, 60)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Plans Tab */}
        {tab === "plans" && (
          <div className="drawer-list">
            {plans.length === 0 && (
              <div className="drawer-empty drawer-empty-rich">
                <div className="drawer-empty-icon">📋</div>
                <div className="drawer-empty-title">No plans found</div>
                <div className="drawer-empty-copy">Plans appear here after Claude creates or updates markdown planning files in your indexed workspaces.</div>
              </div>
            )}
            {plans.map((p) => (
              <div key={p.id} className="plan-card">
                <div className="plan-header">
                  <span className="plan-title">{p.title}</span>
                  {p.project_name && (
                    <span className="session-project">{p.project_name}</span>
                  )}
                </div>
                <div className="plan-content">{truncate(p.content, 300)}</div>
                <div className="session-time">{formatTime(p.created_at)}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "events" && (
          <>
            <div className="drawer-filter drawer-filter-events">
              <select
                name="event-project-filter"
                className="drawer-select"
                value={eventProjectPath}
                onChange={(e) => setEventProjectPath(e.target.value)}
              >
                <option value="">All workspaces</option>
                {projects.map((project) => (
                  <option key={project.path} value={project.path}>{project.name}</option>
                ))}
              </select>
              <select
                name="event-type-filter"
                className="drawer-select"
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
              >
                <option value="">All event types</option>
                {EVENT_TYPE_OPTIONS.map((eventType) => (
                  <option key={eventType} value={eventType}>{eventType}</option>
                ))}
              </select>
              <button
                className={`drawer-toggle-chip ${approvalOnly ? "active" : ""}`}
                onClick={() => setApprovalOnly((current) => !current)}
                type="button"
              >
                Approval Only
              </button>
            </div>
            <div className="drawer-list">
            {loading && events.length === 0 && (
              <div className="drawer-empty drawer-empty-rich">
                <div className="drawer-empty-icon">⚡</div>
                <div className="drawer-empty-title">Loading recent events</div>
                <div className="drawer-empty-copy">Collecting approvals, failures, agent lifecycle, and session activity from the event stream.</div>
              </div>
            )}
            {!loading && events.length === 0 && (
              <div className="drawer-empty drawer-empty-rich">
                <div className="drawer-empty-icon">🛰️</div>
                <div className="drawer-empty-title">No matching events</div>
                <div className="drawer-empty-copy">Try clearing one of the filters, or start a Claude session using the hook-backed event pipeline.</div>
              </div>
            )}
            {events.map((event) => (
              <div key={event.id} className="history-event-card">
                <div className="history-event-header">
                  <span className="history-event-title">{formatEventTitle(event)}</span>
                  <span className="session-time">{formatTime(event.timestamp)}</span>
                </div>
                <div className="history-event-summary">{formatEventSummary(event)}</div>
                <div className="history-event-meta">
                  {event.projectName && <span className="session-project">{event.projectName}</span>}
                  {event.toolName && <span className="history-event-badge">{event.toolName}</span>}
                  {event.status && <span className="history-event-badge">{event.status}</span>}
                  {event.agentType && <span className="history-event-badge">{event.agentType}</span>}
                </div>
              </div>
            ))}
            {events.length > 0 && (
              <div className="history-events-footer">
                <span className="session-time">
                  Showing {events.length} of {eventsTotal}
                </span>
                {eventsHasMore && (
                  <button
                    className="drawer-toggle-chip"
                    onClick={handleLoadMoreEvents}
                    type="button"
                  >
                    Load More
                  </button>
                )}
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
