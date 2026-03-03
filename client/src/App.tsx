import { useEffect, useRef, useState, useCallback } from "react";
import { initCityApp, destroyCityApp, resizeCityApp } from "./pixi/city-app";
import { CityRenderer, type CityAgent } from "./pixi/city/city-renderer";
import { useCityState } from "./hooks/useCityState";
import { AgentStatusBar } from "./ui/AgentStatusBar";
import { ChatPanel } from "./ui/ChatPanel";
import { NotificationCenter } from "./ui/NotificationCenter";
import { WeatherIndicator } from "./ui/WeatherIndicator";
import { HistoryDrawer } from "./ui/HistoryDrawer";
import { ProjectSwitcher } from "./ui/ProjectSwitcher";
import { Minimap } from "./ui/Minimap";
import { Tooltip } from "./ui/Tooltip";
import { ClaudeLogo } from "./ui/ClaudeLogo";
import { SessionStats } from "./ui/SessionStats";
import { TokenMeter } from "./ui/TokenMeter";
import { SpawnModal } from "./ui/SpawnModal";

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
  const { stateRef, subscribe, subscribeToMessages } = useCityState();
  const [ready, setReady] = useState(false);

  // Panel state
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  // Weather
  const [weather, setWeather] = useState({ state: "clear", reason: "Starting up" });

  // History drawer + project switcher + spawn modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnContext, setSpawnContext] = useState<{ prompt?: string; projectPath?: string } | null>(null);

  // Live agent count for header stats
  const [liveAgentCount, setLiveAgentCount] = useState(0);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipInfo>({
    visible: false, x: 0, y: 0, title: "", type: "building",
  });

  // Minimap state
  const [minimapData, setMinimapData] = useState({
    worldWidth: 0,
    worldHeight: 0,
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 1,
    screenWidth: 0,
    screenHeight: 0,
    agents: [] as Array<{ id: string; x: number; y: number; status: string }>,
    roadYFraction: 0.72,
  });

  // Active sessions for header logos
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);

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
              type: info.type as "building" | "agent",
            });
          } else {
            setTooltip((t) => ({ ...t, visible: false }));
          }
        },
      });

      // Get world dimensions for minimap
      const dims = renderer.getWorldDimensions();
      setMinimapData((prev) => ({
        ...prev,
        worldWidth: dims.width,
        worldHeight: dims.height,
        screenWidth: app.screen.width,
        screenHeight: app.screen.height,
        roadYFraction: dims.roadYFraction,
      }));

      setReady(true);
      addDemoAgents(renderer);
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
        // Keep the minimap viewport framing in sync with the actual canvas size.
        setMinimapData((prev) => ({
          ...prev,
          screenWidth: width,
          screenHeight: height,
        }));
      }
    });

    // Guaranteed resize at the end of CSS transition (ResizeObserver may
    // not fire on every frame during a CSS transition in all browsers).
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target !== el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resizeCityApp(rect.width, rect.height);
        // Same camera fit-to-width adjustment at transition end.
        rendererRef.current?.onViewportResize(rect.width, rect.height);
        setMinimapData((prev) => ({
          ...prev,
          screenWidth: rect.width,
          screenHeight: rect.height,
        }));
      }
    };

    observer.observe(el);
    el.addEventListener("transitionend", onTransitionEnd);
    return () => {
      observer.disconnect();
      el.removeEventListener("transitionend", onTransitionEnd);
    };
  }, []);

  // Sync WebSocket state -> Pixi renderer
  useEffect(() => {
    if (!ready) return;

    return subscribe((state) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      let index = 0;
      for (const [id, agent] of state.agents) {
        const pos = renderer.getAgentPosition(agent.status, index);
        renderer.setAgent({
          agentId: id,
          displayName: agent.displayName,
          colorIndex: index,
          status: agent.status,
          currentCommand: agent.currentCommand,
          toolInput: agent.toolInput,
          x: pos.x,
          y: pos.y,
          targetX: pos.x,
          targetY: pos.y,
        });
        index++;
      }

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
          return { state: state.weather.state, reason: state.weather.reason };
        });
      }

      // Update live agent count
      setLiveAgentCount(state.agents.size);
    });
  // stateRef is a React ref (stable object) — omitting it from deps is correct.
  // subscribe is a stable useCallback from useCityState.
  }, [ready, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update minimap periodically
  useEffect(() => {
    if (!ready) return;

    const interval = setInterval(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      setMinimapData((prev) => ({
        ...prev,
        cameraX: renderer.camera.panX,
        cameraY: renderer.camera.panY,
        cameraZoom: renderer.camera.zoom,
        agents: renderer.getAgentPositions(),
      }));
    }, 200);

    return () => clearInterval(interval);
  }, [ready]);

  // Fetch active sessions for header logos
  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions/active");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setActiveSessions(Array.isArray(data) ? data : (data.sessions ?? []));
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
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatOpen(false);
        setNotifOpen(false);
        setHistoryOpen(false);
        setProjectsOpen(false);
        setSpawnOpen(false);
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
      <div className="city-header">
        <div className="header-brand">
          <div>
            <span className="city-title">NEON CITY</span>
            <span className="city-subtitle">CLAUDE CODE MISSION CONTROL</span>
          </div>
          {activeSessions.filter(s => s.isLive).length > 0 && (
            <div className="session-logos-col">
              {activeSessions.filter(s => s.isLive).map((session) => (
                <div key={session.sessionId} className="session-logo-item">
                  <ClaudeLogo
                    size={22}
                    thinking={session.status !== "idle"}
                    className="session-logo-icon"
                  />
                  <span
                    className="session-logo-name"
                    style={{ color: session.color || "#00f0ff" }}
                  >
                    {session.projectName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="header-actions">
          <SessionStats liveAgentCount={liveAgentCount} />
          <WeatherIndicator
            weather={weather.state}
            reason={weather.reason}
            onSetWeather={(state) => {
              setWeather({ state, reason: "Manual override" });
              rendererRef.current?.setWeather(state === "sunny" ? "clear" : state);
            }}
          />
          <button
            className={`glass-btn alerts-btn ${!notifOpen ? "police-flash" : ""}`}
            onClick={() => setNotifOpen((p) => !p)}
          >
            <span className="police-light" />
            <span>Alerts</span>
            {notifCount > 0 && (
              <span className="badge urgent">{notifCount}</span>
            )}
          </button>
          <button
            className="glass-btn"
            onClick={() => setChatOpen((p) => !p)}
          >
            <span>Chat</span>
          </button>
          <button
            className="glass-btn"
            onClick={() => setHistoryOpen((p) => !p)}
          >
            <span>History</span>
          </button>
          <button
            className="glass-btn"
            onClick={() => setProjectsOpen((p) => !p)}
          >
            <span>Projects</span>
          </button>
        </div>
      </div>

      {/* Canvas — shifts when side panels open */}
      <div ref={wrapRef} className={canvasClass}>
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

      {/* Minimap */}
      {ready && (
        <Minimap
          worldWidth={minimapData.worldWidth}
          worldHeight={minimapData.worldHeight}
          cameraX={minimapData.cameraX}
          cameraY={minimapData.cameraY}
          cameraZoom={minimapData.cameraZoom}
          screenWidth={minimapData.screenWidth}
          screenHeight={minimapData.screenHeight}
          agents={minimapData.agents}
          roadYFraction={minimapData.roadYFraction}
        />
      )}

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
      />

      {/* Token meter (power grid) */}
      {ready && <TokenMeter />}

      {/* Agent bar */}
      <AgentStatusBar
        stateRef={stateRef}
        subscribe={subscribe}
        onSpawn={() => setSpawnOpen(true)}
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

/** Demo agents for first load */
function addDemoAgents(renderer: CityRenderer) {
  const demos: Array<{
    id: string;
    name: string;
    status: CityAgent["status"];
    cmd?: string;
    file?: string;
  }> = [
    { id: "demo-1", name: "Claude 1", status: "writing", cmd: "Write", file: "button.tsx" },
    { id: "demo-2", name: "Claude 2", status: "reading", cmd: "Read", file: "api.ts" },
    { id: "demo-3", name: "Claude 3", status: "thinking" },
    { id: "demo-4", name: "Claude 4", status: "stuck", cmd: "Bash", file: "helpers.ts" },
    { id: "demo-5", name: "Claude 5", status: "idle" },
  ];

  demos.forEach((d, i) => {
    const pos = renderer.getAgentPosition(d.status, i);
    renderer.setAgent({
      agentId: d.id,
      displayName: d.name,
      colorIndex: i,
      status: d.status,
      currentCommand: d.cmd,
      toolInput: d.file,
      x: pos.x,
      y: pos.y,
      targetX: pos.x,
      targetY: pos.y,
    });
  });
}
