import { useEffect, useState, useRef, useCallback } from "react";
import { useHistory, type HistorySession, type HistoryMessage } from "../hooks/useHistory";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "sessions" | "search" | "plans";

export function HistoryDrawer({ open, onClose }: Props) {
  const {
    projects, sessions, messages, searchResults, plans, stats, loading,
    fetchProjects, fetchSessions, fetchSessionMessages, search, fetchPlans, fetchStats,
  } = useHistory();

  const [tab, setTab] = useState<Tab>("sessions");
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load data when drawer opens
  useEffect(() => {
    if (!open) return;
    fetchProjects();
    fetchStats();
    fetchSessions(undefined);
    fetchPlans();
  }, [open, fetchProjects, fetchStats, fetchSessions, fetchPlans]);

  // Fetch sessions when project filter changes
  useEffect(() => {
    if (open) fetchSessions(selectedProject);
  }, [selectedProject, open, fetchSessions]);

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
          {(["sessions", "search", "plans"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`drawer-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "sessions" ? "Sessions" : t === "search" ? "Search" : "Plans"}
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
                <div className="drawer-empty">Indexing sessions...</div>
              )}
              {!loading && sessions.length === 0 && (
                <div className="drawer-empty">
                  <div className="drawer-empty-icon">📭</div>
                  No sessions found
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
              {loading && <div className="drawer-empty">Searching...</div>}
              {!loading && searchQuery && searchResults.length === 0 && (
                <div className="drawer-empty">No results for "{searchQuery}"</div>
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
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
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
              <div className="drawer-empty">
                <div className="drawer-empty-icon">📋</div>
                No plans found
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
      </div>
    </div>
  );
}
