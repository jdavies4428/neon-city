import { useEffect, useRef, useState, useCallback } from "react";
import { initCityApp, destroyCityApp, resizeCityApp } from "./pixi/city-app";
import { CityRenderer } from "./pixi/city/city-renderer";
import { useCityState } from "./hooks/useCityState";
import type { HistoryProject } from "./hooks/useHistory";
import { useCityAudio } from "./hooks/useCityAudio";
import { useDesktopNotifications } from "./hooks/useDesktopNotifications";
import { AgentStatusBar } from "./ui/AgentStatusBar";
import { ChatPanel } from "./ui/ChatPanel";
import { NotificationCenter } from "./ui/NotificationCenter";
import { WeatherIndicator } from "./ui/WeatherIndicator";
import { HistoryDrawer } from "./ui/HistoryDrawer";
import { ProjectSwitcher } from "./ui/ProjectSwitcher";
import { Tooltip } from "./ui/Tooltip";
import { ClaudeLogo } from "./ui/ClaudeLogo";
import { SessionStats } from "./ui/SessionStats";
import { PowerGridModal } from "./ui/PowerGridModal";
import { SpawnModal } from "./ui/SpawnModal";
import { ProjectDetailModal } from "./ui/ProjectDetailModal";
interface ActiveSession {
  sessionId: string;
  projectName: string;
  ideName: string;
  isLive: boolean;
  status: string;
  color: string;
}

interface TooltipInfo {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  details?: string;
  type: "building" | "agent" | "district";
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CityRenderer | null>(null);
  const { stateRef, subscribe, subscribeToMessages, notify } = useCityState();
  const { permission: notifPermission, requestPermission } = useDesktopNotifications(subscribeToMessages);
  const [ready, setReady] = useState(false);

  // Audio system — lazy-init on first user click
  const audioControls = useCityAudio();
  const audioInitedRef = useRef(false);
  const handleRootClick = useCallback(() => {
    if (!audioInitedRef.current) {
      audioInitedRef.current = true;
      audioControls.init();
      if (notifPermission === "default") requestPermission();
    }
  }, [audioControls, notifPermission, requestPermission]);

  // Panel state
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  // Weather
  const [weather, setWeather] = useState({ state: "clear", reason: "Starting up" });

  // History drawer + project switcher + spawn modal + power grid modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnContext, setSpawnContext] = useState<{ prompt?: string; projectPath?: string } | null>(null);
  const [powerGridOpen, setPowerGridOpen] = useState(false);
  const [projectDetailOpen, setProjectDetailOpen] = useState(false);
  const [projectDetailProject, setProjectDetailProject] = useState<HistoryProject | null>(null);

  // Live agent count for header stats
  const [liveAgentCount, setLiveAgentCount] = useState(0);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipInfo>({
    visible: false, x: 0, y: 0, title: "", type: "building",
  });

  // Active sessions for header logos
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);

  // Toggle a boolean state setter with panel open/close audio
  const toggleWithAudio = useCallback(
    (setter: React.Dispatch<React.SetStateAction<boolean>>) => () => {
      setter((p) => {
        if (!p) audioControls.playPanelOpen(); else audioControls.playPanelClose();
        return !p;
      });
    },
    [audioControls]
  );

  // Initialize Pixi.js
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    initCityApp(canvasRef.current).then((app) => {
      if (cancelled) return;
      const renderer = new CityRenderer(app);
      rendererRef.current = renderer;

      // Set up interactivity callbacks
      renderer.setCallbacks({
        onBuildingClick: (label, district, x, y) => {
          renderer.camera.focusOn(x, y, 1.5);
          setTooltip({
            visible: true,
            x: window.innerWidth / 2,
            y: window.innerHeight / 3,
            title: label,
            details: `District: ${district}`,
            type: "building",
          });
          setTimeout(() => setTooltip((t) => ({ ...t, visible: false })), 3000);
        },
        onAgentClick: (agentId) => {
          renderer.focusAgent(agentId);
        },
        onHover: (info) => {
          if (info) {
            setTooltip({
              visible: true,
              x: info.x,
              y: info.y,
              title: info.label,
              details: info.details,
              type: info.type as "building" | "agent",
            });
          } else {
            setTooltip((t) => ({ ...t, visible: false }));
          }
        },
      });

      setReady(true);
    });

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      destroyCityApp();
    };
  }, []);

  // Keep the PixiJS canvas sized to its wrapper div.
  // We use a ResizeObserver instead of `resizeTo` on the PixiJS app to avoid
  // the infinite ResizeObserver loop that `resizeTo: wrapRef.current` causes.
  // The observer fires once when the wrapper's layout changes (e.g. a sidebar
  // slides open/closed or the browser window is resized), and we simply push
  // the new dimensions into the renderer — a one-way write that cannot trigger
  // further resize events.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Use borderBoxSize when available for pixel-accurate dimensions,
      // fall back to contentRect which excludes padding/border.
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width > 0 && height > 0) {
        resizeCityApp(width, height);
        // After the PixiJS renderer has been resized, tell the city renderer to
        // adjust the camera zoom so all world content stays visible.
        rendererRef.current?.onViewportResize(width, height);
      }
    });

    // Guaranteed resize at the end of CSS transition (ResizeObserver may
    // not fire on every frame during a CSS transition in all browsers).
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target !== el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resizeCityApp(rect.width, rect.height);
        // Same camera fit-to-viewport adjustment at transition end.
        rendererRef.current?.onViewportResize(rect.width, rect.height);
      }
    };

    observer.observe(el);
    el.addEventListener("transitionend", onTransitionEnd);
    return () => {
      observer.disconnect();
      el.removeEventListener("transitionend", onTransitionEnd);
    };
  }, []);

  // Wire error notifications and token stats to the city pulse
  useEffect(() => {
    if (!ready) return;

    return subscribeToMessages((msg) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      // Error notifications trigger a district flash in the pulse
      if (msg.type === "notification" && msg.data?.type === "error") {
        // Map agent to a district if available; fall back to "data"
        const district: string = msg.data?.district ?? "data";
        renderer.getPulse().onError(district);
        audioControls.playErrorAlert();
      }

      // Non-error notifications get a chime
      if (msg.type === "notification" && msg.data?.type !== "error") {
        audioControls.playNotificationChime();
      }

      // Stats updates feed token counts into the pulse
      if (msg.type === "stats" && typeof msg.data?.totalTokens === "number") {
        renderer.getPulse().onTokenUpdate(msg.data.totalTokens as number);
      }
    });
  }, [ready, subscribeToMessages]);

  // Sync WebSocket state -> Pixi renderer
  useEffect(() => {
    if (!ready) return;

    return subscribe((state) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      // --- Cross-update: propagate real-time WebSocket status to synthetic agents ---
      // WebSocket agents use raw sessionId. Synthetic agents use "session-<sessionId>".
      // The user sees the synthetic card (with project name), so we must keep it current.
      // After syncing, DELETE the raw WebSocket entry so AgentStatusBar doesn't render duplicates.
      const rawSessionIdsToDelete: string[] = [];
      for (const [id, agent] of state.agents) {
        if (agent.agentKind === "session" && !id.startsWith("session-")) {
          const syntheticId = `session-${id}`;
          const synthetic = state.agents.get(syntheticId);
          if (synthetic) {
            synthetic.status = agent.status;
            synthetic.currentCommand = agent.currentCommand;
            synthetic.toolInput = agent.toolInput;
            synthetic.lastActivity = agent.lastActivity;
            synthetic.isThinking = agent.isThinking;
            rawSessionIdsToDelete.push(id);
          }
        }
      }
      for (const id of rawSessionIdsToDelete) {
        renderer.removeAgent(id);
        state.agents.delete(id);
      }

      let index = 0;
      let hasWriting = false;
      let hasReading = false;
      for (const [id, agent] of state.agents) {
        const variant = agent.agentKind === "session" ? "session" : (agent.agentKind === "subagent" ? "agent" : undefined);
        const pos = renderer.getAgentPosition(agent.status, agent.currentCommand, index, agent.agentType, agent.agentKind);
        // Store colorIndex on agent state so AgentStatusBar uses the same value
        agent.colorIndex = index;
        renderer.setAgent({
          agentId: id,
          displayName: agent.displayName,
          colorIndex: index,
          status: agent.status,
          currentCommand: agent.currentCommand,
          toolInput: agent.toolInput,
          agentType: agent.agentType,
          agentKind: agent.agentKind,
          x: pos.x,
          y: pos.y,
          targetX: pos.x,
          targetY: pos.y,
          variant,
        });
        if (agent.status === "writing") hasWriting = true;
        if (agent.status === "reading") hasReading = true;
        index++;
      }
      // Single pulse flush after all agents have been updated — O(N) instead of O(N²)
      renderer.flushPulse();
      audioControls.setAgentActivity(hasWriting, hasReading);

      // Sync weather — use functional update and only change state when
      // values actually differ to avoid cascading re-renders.
      if (state.weather) {
        renderer.setWeather(state.weather.state);
        setWeather((prev) => {
          if (
            prev.state === state.weather.state &&
            prev.reason === state.weather.reason
          ) {
            return prev; // same values → same reference → no re-render
          }
          audioControls.setWeatherState(state.weather.state);
          return { state: state.weather.state, reason: state.weather.reason };
        });
      }

      // Update live agent count
      setLiveAgentCount(state.agents.size);
    });
  // stateRef is a React ref (stable object) — omitting it from deps is correct.
  // subscribe is a stable useCallback from useCityState.
  // audioControls methods are stable useCallback refs.
  }, [ready, subscribe, audioControls]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch active sessions for header logos and city citizens
  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions/active");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const allSessions: ActiveSession[] = Array.isArray(data) ? data : (data.sessions ?? []);
        setActiveSessions(allSessions);

        // Convert live sessions into synthetic city agents
        const liveSessions = allSessions.filter((s) => s.isLive);
        const renderer = rendererRef.current;
        if (renderer) {
          for (let i = 0; i < liveSessions.length; i++) {
            const session = liveSessions[i];
            if (!session) continue;
            const syntheticId = `session-${session.sessionId}`;
            // Check if this session is already tracked via WebSocket (with richer state)
            const wsAgent = stateRef.current.agents.get(session.sessionId);
            const effectiveStatus = wsAgent?.status ?? (session.status === "idle" ? "idle" : "walking");
            const effectiveCommand = wsAgent?.currentCommand;
            const pos = renderer.getAgentPosition(
              effectiveStatus,
              effectiveCommand,
              i,
              undefined,
              "session"
            );
            renderer.setAgent({
              agentId: syntheticId,
              displayName: session.projectName,
              colorIndex: i % 5,
              status: effectiveStatus,
              currentCommand: effectiveCommand,
              x: pos.x,
              y: pos.y,
              targetX: pos.x,
              targetY: pos.y,
              variant: "session",
              agentKind: "session",
              ideName: session.ideName,
            });
            // Add/update synthetic agent in state so AgentStatusBar shows the card
            // Always update (not just first creation) so polling keeps status fresh
            const existing = stateRef.current.agents.get(syntheticId);
            stateRef.current.agents.set(syntheticId, {
              agentId: syntheticId,
              displayName: session.projectName,
              source: "claude",
              isThinking: false,
              currentCommand: existing?.currentCommand ?? effectiveCommand,
              toolInput: existing?.toolInput,
              lastActivity: Date.now(),
              status: existing?.status ?? effectiveStatus,
              agentKind: "session",
              colorIndex: existing?.colorIndex ?? i % 5,
            });
          }
          notify(); // Trigger AgentStatusBar to pick up synthetic session agents
        }
      } catch {
        // silently ignore — server may not be up yet
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [notify]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatOpen(false);
        setNotifOpen(false);
        setHistoryOpen(false);
        setProjectsOpen(false);
        setSpawnOpen(false);
        setPowerGridOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setChatOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setNotifOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault();
        setHistoryOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleNotifCount = useCallback((count: number) => {
    setNotifCount(count);
  }, []);

  // Compute canvas shift class based on which panels are open
  const canvasClass = [
    "city-canvas-wrap",
    notifOpen ? "panel-left-open" : "",
    chatOpen ? "panel-right-open" : "",
    (notifOpen && chatOpen) ? "panel-both-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {/* Header */}
      <div className="city-header" onClick={handleRootClick}>
        <div className="header-brand">
          <div>
            <span className="city-title">NEON CITY</span>
            <span className="city-subtitle">CLAUDE CODE MISSION CONTROL</span>
          </div>
        </div>
        <div className="header-actions">
          <SessionStats liveAgentCount={liveAgentCount} />
          <WeatherIndicator
            weather={weather.state}
            reason={weather.reason}
            onSetWeather={(state) => {
              setWeather({ state, reason: "Manual override" });
              rendererRef.current?.setWeather(state, true);
              audioControls.setWeatherState(state);
              // Sync to server so WebSocket broadcasts the correct state
              fetch("/api/weather/set", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state, reason: "Manual override" }),
              }).catch(() => {});
            }}
          />
          <button
            className={`glass-btn alerts-btn ${!notifOpen ? "police-flash" : ""}`}
            onClick={toggleWithAudio(setNotifOpen)}
          >
            <span className="police-light" />
            <span>Alerts</span>
            {notifCount > 0 && (
              <span className="badge urgent">{notifCount}</span>
            )}
          </button>
          <button
            className="glass-btn"
            onClick={toggleWithAudio(setChatOpen)}
          >
            <span>Chat</span>
          </button>
          <button
            className="glass-btn"
            onClick={toggleWithAudio(setHistoryOpen)}
          >
            <span>History</span>
          </button>
          <button
            className="glass-btn"
            onClick={() => setProjectsOpen((p) => !p)}
          >
            <span>Projects</span>
          </button>
          <button
            className="glass-btn"
            onClick={() => setSpawnOpen(true)}
          >
            <span>+ Agents</span>
          </button>
          <button
            className="glass-btn"
            onClick={() => setPowerGridOpen(true)}
          >
            <span>⚡ Power Grid</span>
          </button>
        </div>
      </div>

      {/* Canvas — shifts when side panels open.
          Clicking the canvas also initialises the AudioContext (browser gesture requirement). */}
      <div ref={wrapRef} className={canvasClass} onClick={handleRootClick}>
        <canvas ref={canvasRef} id="city-canvas" />
      </div>

      {/* Tooltip */}
      <Tooltip
        visible={tooltip.visible}
        x={tooltip.x}
        y={tooltip.y}
        title={tooltip.title}
        details={tooltip.details}
        type={tooltip.type}
      />

      {/* Overlay dimmer — only for modals (project switcher), not side panels */}
      <div
        className={`panel-overlay ${projectsOpen ? "visible" : ""}`}
        onClick={() => setProjectsOpen(false)}
      />

      {/* Panels */}
      <NotificationCenter
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onCountChange={handleNotifCount}
        subscribeToMessages={subscribeToMessages}
        onSpawnFromAlert={(ctx) => {
          setSpawnContext(ctx);
          setSpawnOpen(true);
        }}
      />
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        subscribe={subscribe}
        subscribeToMessages={subscribeToMessages}
      />

      {/* History drawer */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Project switcher */}
      <ProjectSwitcher
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        onSelectProject={() => {}}
        currentWeather={weather.state}
        onProjectDetail={(project) => {
          setProjectDetailProject(project);
          setProjectDetailOpen(true);
          setProjectsOpen(false);
        }}
      />
      <ProjectDetailModal
        open={projectDetailOpen}
        onClose={() => { setProjectDetailOpen(false); setProjectDetailProject(null); }}
        project={projectDetailProject}
        onOpenProject={() => { setProjectDetailOpen(false); setProjectDetailProject(null); }}
      />

      {/* Agent bar */}
      <AgentStatusBar
        stateRef={stateRef}
        subscribe={subscribe}
      />

      {/* Power Grid modal */}
      <PowerGridModal
        open={powerGridOpen}
        onClose={() => setPowerGridOpen(false)}
      />

      {/* Spawn modal */}
      <SpawnModal
        open={spawnOpen}
        onClose={() => { setSpawnOpen(false); setSpawnContext(null); }}
        initialPrompt={spawnContext?.prompt}
        initialProjectPath={spawnContext?.projectPath}
      />
    </>
  );
}

