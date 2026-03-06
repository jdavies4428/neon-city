import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVoice } from "../hooks/useVoice";
import type { RawMessageListener } from "../hooks/useCityState";
import { formatTime } from "../shared/format";
import type { ActiveSession, ChatMessageRecord, WorkspaceTarget } from "../shared/contracts";
import { CommandChips, CommandDropdown } from "./CommandPalette";
import { ChatMessage } from "./ChatMessage";

interface Props {
  open: boolean;
  onClose: () => void;
  subscribeToMessages: (listener: RawMessageListener) => () => void;
  activeSessions: ActiveSession[];
  currentWorkspace: WorkspaceTarget | null;
  onWorkspaceChange: (workspace: WorkspaceTarget) => void;
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

  const liveSessions = sessions.filter((s) => s.isLive);
  const recentSessions = (() => {
    const raw = sessions.filter((s) => !s.isLive);
    const byProject = new Map<string, typeof raw[0]>();
    for (const s of raw) {
      const existing = byProject.get(s.projectName);
      if (!existing || s.lastActivity > existing.lastActivity) {
        byProject.set(s.projectName, s);
      }
    }
    return Array.from(byProject.values());
  })();

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

          {/* Recent sessions group */}
          {recentSessions.length > 0 && (
            <>
              <div className="sdrop-group-label">Recent</div>
              {recentSessions.map((s) => (
                <button
                  key={s.sessionId}
                  className={`sdrop-item ${selectedId === s.sessionId ? "active" : ""}`}
                  role="option"
                  aria-selected={selectedId === s.sessionId}
                  onClick={() => handleSelect(s.sessionId)}
                >
                  <span
                    className="sdrop-dot dead"
                    style={{ background: s.color }}
                  />
                  <span className="sdrop-item-name">
                    {ideIcon(s.ideName)} {s.projectName}
                  </span>
                  <span className="sdrop-item-meta">{s.ideName}</span>
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

export function ChatPanel({
  open,
  onClose,
  subscribeToMessages,
  activeSessions,
  currentWorkspace,
  onWorkspaceChange,
}: Props) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Single unified selected session — drives both the message filter AND the send target
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    if (currentWorkspace?.preferredSessionId) {
      setSelectedSession(currentWorkspace.preferredSessionId);
      return;
    }
    if (currentWorkspace && !currentWorkspace.preferredSessionId) {
      setSelectedSession(null);
      return;
    }

    if (activeSessions.length === 0) {
      setSelectedSession(null);
      return;
    }

    const existing = selectedSessionRef.current;
    const hasExisting = existing && activeSessions.some((s) => s.sessionId === existing);
    if (hasExisting) return;

    const liveSessions = activeSessions.filter((s) => s.isLive);
    if (liveSessions.length === 1) {
      setSelectedSession(liveSessions[0].sessionId);
      return;
    }

    const newestLive = [...liveSessions].sort((a, b) => b.lastActivity - a.lastActivity)[0];
    if (newestLive) {
      setSelectedSession(newestLive.sessionId);
    }
  }, [activeSessions, currentWorkspace]);

  // Load chat history whenever the panel opens. This covers both the initial
  // open and re-opens after the server has accumulated more messages. We do
  // not rely solely on the WS init message because it may fire before this
  // component's subscribeToMessages listener is registered.
  useEffect(() => {
    if (!open) return;
    fetch("/api/chat/history")
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.messages)) return;
        const history = d.messages as ChatMessageRecord[];
        if (history.length === 0) return;
        setMessages((prev) => {
          // Merge history with any live messages already in state, deduplicating
          // by id and preserving chronological order.
          const historyIds = new Set(history.map((m) => m.id));
          const liveOnly = prev.filter((m) => !historyIds.has(m.id));
          return [...history, ...liveOnly].sort((a, b) => a.timestamp - b.timestamp);
        });
      })
      .catch(() => {});
  }, [open]);

  // Subscribe to new messages via the shared WS connection
  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (msg.type === "chat-message") {
        setMessages((prev) => [...prev, msg.data]);
      } else if (msg.type === "init" && Array.isArray(msg.data.chatHistory)) {
        const history = msg.data.chatHistory as ChatMessageRecord[];
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id));
          const liveOnly = prev.filter((m) => !historyIds.has(m.id));
          return [...history, ...liveOnly].sort((a, b) => a.timestamp - b.timestamp);
        });
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
          projectPath: currentWorkspace?.projectPath || undefined,
        }),
      });
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  }, [input, sending, selectedSession]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setShowDropdown(val.startsWith("/") && val.length < 20);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const getColor = (sid?: string): string => {
    if (!sid) return "#666";
    const normalizedId = sid.startsWith("session-") ? sid.slice(8) : sid;
    const session = activeSessions.find((s) => {
      const candidateId = s.sessionId.startsWith("session-") ? s.sessionId.slice(8) : s.sessionId;
      return candidateId === normalizedId;
    });
    return session?.color || "#666";
  };

  // Filter messages to the selected session (null = show all)
  const visibleMessages = selectedSession
    ? messages.filter((m) => {
        if (!m.sessionId) return false;
        if (m.sessionId === selectedSession) return true;
        const rawMsg = m.sessionId.startsWith("session-") ? m.sessionId.slice(8) : m.sessionId;
        const rawSel = selectedSession.startsWith("session-") ? selectedSession.slice(8) : selectedSession;
        return rawMsg === rawSel;
      })
    : messages;

  const activeSession = selectedSession
    ? activeSessions.find((s) => s.sessionId === selectedSession)
    : null;

  const liveSessions = activeSessions.filter((s) => s.isLive);

  // Determine which session the voice is currently speaking for
  const speakingSessionId = voice.speaking && voice.currentSpeaker
    ? (activeSessions.find((s) => voice.currentSpeaker?.includes(s.ideName))?.sessionId ?? null)
    : null;

  const placeholder = activeSession
    ? activeSession.isLive
      ? `Message Claude in ${activeSession.ideName} — ${activeSession.projectName}...`
      : "Session ended — read-only history..."
    : currentWorkspace
      ? `Message Claude about ${currentWorkspace.projectName}...`
      : "Message Claude... (all sessions)";

  const viewingLabel = activeSession
    ? `${activeSession.projectName} · ${activeSession.isLive ? activeSession.ideName : "Recent session"}`
    : selectedSession === null
      ? "All sessions"
      : "Workspace feed";

  const sendTargetLabel = activeSession?.isLive
    ? `${activeSession.ideName} live session`
    : currentWorkspace
      ? `${currentWorkspace.projectName} workspace`
      : "General chat";

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
          sessions={activeSessions}
          selectedId={selectedSession}
          onChange={(sessionId) => {
            setSelectedSession(sessionId);
            if (!sessionId) return;
            const session = activeSessions.find((item) => item.sessionId === sessionId);
            if (!session) return;
            onWorkspaceChange({
              projectName: session.projectName,
              projectPath: session.projectPath,
              preferredSessionId: session.sessionId,
              source: "session",
              isLive: session.isLive,
              ideName: session.ideName,
            });
          }}
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
      {currentWorkspace && (
        <div className="chat-workspace-summary">
          <div className="chat-context-card">
            <span className="chat-context-label">Viewing</span>
            <span className="chat-context-value">{viewingLabel}</span>
          </div>
          <div className="chat-context-card">
            <span className="chat-context-label">Sending To</span>
            <span className="chat-context-value">{sendTargetLabel}</span>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Messages                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="chat-messages">
        {visibleMessages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-kicker">Ready</div>
            <div className="chat-empty-title">Start from one clear target</div>
            <div className="chat-empty-copy">
              {liveSessions.length > 0
                ? "Use the session picker above to talk to a live Claude session, or keep the current workspace selected to send broader project context."
                : "No live sessions are connected yet. You can still choose a workspace and send context-rich prompts, or start Claude Code in Cursor or Terminal to attach a live session."}
            </div>
            <div className="chat-empty-tips">
              <span className="chat-empty-tip">Viewing: {viewingLabel}</span>
              <span className="chat-empty-tip">Sending to: {sendTargetLabel}</span>
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
            <ChatMessage role={msg.role} content={msg.content}>
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
            </ChatMessage>
            <div className="msg-meta">{formatTime(msg.timestamp)}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Input area — fixed at bottom, never clipped                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="chat-input-area">
        <CommandChips
          onSelect={(cmd) => {
            setInput(cmd + " ");
            inputRef.current?.focus();
            setShowDropdown(false);
          }}
          hasActiveProject={!!selectedSession}
        />
        <div style={{ position: "relative" }}>
          {showDropdown && (
            <CommandDropdown
              filter={input}
              onSelect={(cmd) => {
                setInput(cmd);
                setShowDropdown(false);
                inputRef.current?.focus();
              }}
              hasActiveProject={!!selectedSession}
            />
          )}
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              name="chat-message"
              className="chat-input"
              placeholder={placeholder}
              rows={1}
              value={input}
              onChange={handleInputChange}
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
    </div>
  );
}
