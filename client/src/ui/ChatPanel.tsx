import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVoice } from "../hooks/useVoice";
import type { RawMessageListener } from "../hooks/useCityState";
import { formatTime } from "../shared/format";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  sessionLabel?: string;
  timestamp: number;
}

interface ActiveSession {
  sessionId: string;
  label: string;
  agentName: string;
  projectName: string;
  status: string;
  color: string;
  isLive: boolean;
  ideName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  subscribe: (listener: (state: any) => void) => () => void;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
}

/** IDE icon character for session source */
function ideIcon(ideName: string): string {
  switch (ideName) {
    case "Cursor": return "⌨";
    case "VSCode": return "⌨";
    case "Terminal": return "▶";
    default: return "●";
  }
}

/** Status dot color: green for live, red for disconnected */
function statusColor(session: ActiveSession): string {
  return session.isLive ? "#40ff80" : "#ff4040";
}

// ---------------------------------------------------------------------------
// SessionDropdown — replaces both the top tab bar and the bottom agent bubbles
// ---------------------------------------------------------------------------

interface SessionDropdownProps {
  sessions: ActiveSession[];
  selectedId: string | null; // null = "All"
  onChange: (id: string | null) => void;
  speakingSessionId?: string | null;
}

function SessionDropdown({ sessions, selectedId, onChange, speakingSessionId }: SessionDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const selectedSession = selectedId ? sessions.find((s) => s.sessionId === selectedId) : null;

  // All sessions passed in are already live (filtered upstream)
  const liveSessions = sessions;

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="session-dropdown" ref={ref}>
      {/* Trigger button */}
      <button
        className="session-dropdown-trigger"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch session"
      >
        {selectedSession ? (
          <>
            <span
              className={`sdrop-dot ${selectedSession.isLive ? "live" : "dead"}`}
              style={{ background: selectedSession.color }}
            />
            <span className="sdrop-label">
              {ideIcon(selectedSession.ideName)} {selectedSession.projectName}
            </span>
            {speakingSessionId === selectedSession.sessionId && (
              <span className="sdrop-speaking-wave">
                {[...Array(3)].map((_, i) => (
                  <span key={i} className="sdrop-wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
                ))}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="sdrop-dot all" />
            <span className="sdrop-label">All sessions</span>
          </>
        )}
        <span className="sdrop-chevron">{open ? "▲" : "▼"}</span>
        {sessions.length > 0 && (
          <span className="sdrop-count">{sessions.length}</span>
        )}
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="session-dropdown-menu" role="listbox">
          {/* All option */}
          <button
            className={`sdrop-item ${selectedId === null ? "active" : ""}`}
            role="option"
            aria-selected={selectedId === null}
            onClick={() => handleSelect(null)}
          >
            <span className="sdrop-dot all" />
            <span className="sdrop-item-name">All sessions</span>
            <span className="sdrop-item-meta">Combined feed</span>
          </button>

          {/* Live sessions group */}
          {liveSessions.length > 0 && (
            <>
              <div className="sdrop-group-label">Live</div>
              {liveSessions.map((s) => (
                <button
                  key={s.sessionId}
                  className={`sdrop-item ${selectedId === s.sessionId ? "active" : ""}`}
                  role="option"
                  aria-selected={selectedId === s.sessionId}
                  onClick={() => handleSelect(s.sessionId)}
                >
                  <span
                    className="sdrop-dot live"
                    style={{ background: s.color }}
                  />
                  <span className="sdrop-item-name">
                    {ideIcon(s.ideName)} {s.projectName}
                  </span>
                  <span className="sdrop-item-meta">{s.ideName}</span>
                  {speakingSessionId === s.sessionId && (
                    <span className="sdrop-speaking-wave small">
                      {[...Array(3)].map((_, i) => (
                        <span key={i} className="sdrop-wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {sessions.length === 0 && (
            <div className="sdrop-empty">No active sessions</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock — renders fenced code blocks with a copy button
// ---------------------------------------------------------------------------

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const isBlock = className || (typeof children === "string" && children.includes("\n"));

  if (!isBlock) {
    return <code className={className}>{children}</code>;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="code-copy-btn"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

export function ChatPanel({ open, onClose, subscribe, subscribeToMessages }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);

  // Single unified selected session — drives both the message filter AND the send target
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevSessionIdsRef = useRef<Set<string>>(new Set());

  // Voice/TTS integration
  const voice = useVoice({ subscribeToMessages });
  const hasInitAudioRef = useRef(false);
  const initAudioRef = useRef(voice.initAudio);
  initAudioRef.current = voice.initAudio;

  const handlePanelClick = useCallback(() => {
    if (!hasInitAudioRef.current) {
      initAudioRef.current();
      hasInitAudioRef.current = true;
    }
  }, []);

  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;

  const fetchSessions = useCallback(() => {
    fetch("/api/sessions/active")
      .then((r) => r.json())
      .then((d) => {
        if (d.sessions) {
          // Only show live Claude sessions — filter out dead/recent history entries
          const liveSessions = (d.sessions as ActiveSession[]).filter((s) => s.isLive);
          setSessions(liveSessions);

          const newIds = new Set(liveSessions.map((s) => s.sessionId));
          const prevIds = prevSessionIdsRef.current;

          // Auto-select newly appeared live sessions
          for (const s of liveSessions) {
            if (!prevIds.has(s.sessionId)) {
              setSelectedSession(s.sessionId);
              break;
            }
          }

          // If only one live session and nothing selected, auto-select it
          if (!selectedSessionRef.current && liveSessions.length === 1) {
            setSelectedSession(liveSessions[0].sessionId);
          }

          prevSessionIdsRef.current = newIds;
        }
      })
      .catch(() => {});
  }, []);

  // Load sessions on open and refresh periodically
  useEffect(() => {
    if (!open) return;
    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, [open, fetchSessions]);

  // Load initial chat history
  useEffect(() => {
    fetch("/api/chat/history")
      .then((r) => r.json())
      .then((d) => {
        if (d.messages) setMessages(d.messages);
      })
      .catch(() => {});
  }, []);

  // Subscribe to new messages via the shared WS connection
  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (msg.type === "chat-message") {
        setMessages((prev) => [...prev, msg.data]);
      } else if (msg.type === "init" && msg.data.chatHistory) {
        setMessages(msg.data.chatHistory);
      }
    });
  }, [subscribeToMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);

    try {
      await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: selectedSession || undefined,
        }),
      });
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  }, [input, sending, selectedSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const getColor = (sid?: string): string => {
    if (!sid) return "#666";
    const session = sessions.find((s) => s.sessionId === sid);
    return session?.color || "#666";
  };

  // Filter messages to the selected session (null = show all)
  const visibleMessages = selectedSession
    ? messages.filter((m) => m.sessionId === selectedSession)
    : messages;

  const activeSession = selectedSession
    ? sessions.find((s) => s.sessionId === selectedSession)
    : null;

  const liveSessions = sessions.filter((s) => s.isLive);

  // Determine which session the voice is currently speaking for
  const speakingSessionId = voice.speaking && voice.currentSpeaker
    ? (sessions.find((s) => voice.currentSpeaker?.includes(s.ideName))?.sessionId ?? null)
    : null;

  const placeholder = activeSession
    ? activeSession.isLive
      ? `Message Claude in ${activeSession.ideName} — ${activeSession.projectName}...`
      : "Session ended — read-only history..."
    : "Message Claude... (all sessions)";

  return (
    <div
      className={`slide-panel right ${open ? "open" : ""}`}
      onClick={handlePanelClick}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Header: title + session dropdown + voice controls + close           */}
      {/* ------------------------------------------------------------------ */}
      <div className="panel-header chat-panel-header">
        <div className="panel-header-left">
          <span className="panel-title">CHAT</span>
          {voice.speaking && (
            <span className="voice-speaking-badge">
              <span className="voice-wave-mini">
                {[...Array(3)].map((_, i) => (
                  <span key={i} className="wave-bar-mini" style={{ animationDelay: `${i * 0.1}s` }} />
                ))}
              </span>
              <span className="voice-speaker-label">{voice.currentSpeaker}</span>
              {voice.sentenceCount > 1 && (
                <span className="voice-progress-label">
                  {voice.sentenceIndex}/{voice.sentenceCount}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="panel-header-right">
          <button
            className={`voice-mute-btn ${voice.enabled ? "on" : "off"}`}
            onClick={(e) => { e.stopPropagation(); voice.toggleVoice(); }}
            title={voice.enabled ? "Mute voice" : "Unmute voice"}
          >
            {voice.enabled ? "🔊" : "🔇"}
          </button>
          <button className="panel-close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      {/* Voice progress bar (only when speaking multi-sentence) */}
      {voice.speaking && voice.sentenceCount > 1 && (
        <div className="voice-progress-bar">
          <div
            className="voice-progress-fill"
            style={{ width: `${(voice.sentenceIndex / voice.sentenceCount) * 100}%` }}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Session selector row — single dropdown, replaces old top tabs AND   */}
      {/* the bottom agent-bubbles. Only shown when sessions exist.           */}
      {/* ------------------------------------------------------------------ */}
      <div className="chat-session-row">
        <SessionDropdown
          sessions={sessions}
          selectedId={selectedSession}
          onChange={setSelectedSession}
          speakingSessionId={speakingSessionId}
        />
        {activeSession && (
          <span
            className={`session-status-pill ${activeSession.isLive ? "live" : "dead"}`}
            style={{ color: statusColor(activeSession) }}
          >
            <span
              className={`sdrop-dot ${activeSession.isLive ? "live" : "dead"}`}
              style={{ background: statusColor(activeSession) }}
            />
            {activeSession.isLive ? "Live" : "Ended"}
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Messages                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="chat-messages">
        {visibleMessages.length === 0 && (
          <div className="notif-empty">
            <div className="notif-empty-icon">💬</div>
            <div>Send a message to Claude</div>
            <div className="notif-empty-hint">
              {liveSessions.length > 0
                ? "Select a session above to chat with a specific agent."
                : "Start Claude Code in Cursor or Terminal — sessions will appear automatically."}
            </div>
          </div>
        )}
        {visibleMessages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="msg-header">
              {msg.sessionLabel && (
                <span
                  className="msg-session-badge"
                  style={{
                    borderColor: getColor(msg.sessionId),
                    color: getColor(msg.sessionId),
                  }}
                >
                  {msg.sessionLabel}
                </span>
              )}
              {msg.agentName && msg.role === "assistant" && (
                <span className="msg-agent">{msg.agentName}</span>
              )}
            </div>
            <div className={`msg-content${msg.role === "assistant" ? " md" : ""}`}>
              {msg.role === "assistant" ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ code: CodeBlock }}
                >
                  {msg.content}
                </ReactMarkdown>
              ) : msg.content}
            </div>
            <div className="msg-meta">{formatTime(msg.timestamp)}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Input area — fixed at bottom, never clipped                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="chat-input-area">
        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            name="chat-message"
            className="chat-input"
            placeholder={placeholder}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || (activeSession !== null && activeSession !== undefined && !activeSession.isLive)}
          />
          <button
            className="chat-send"
            onClick={send}
            disabled={!input.trim() || sending || (activeSession !== null && activeSession !== undefined && !activeSession.isLive)}
            title="Send (Enter)"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

