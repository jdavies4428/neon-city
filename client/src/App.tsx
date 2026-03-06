import { useEffect, useRef, useState, useCallback } from "react";
import { initCityApp, destroyCityApp, resizeCityApp } from "./pixi/city-app";
import { CityRenderer } from "./pixi/city/city-renderer";
import { useCityState } from "./hooks/useCityState";
import type { HistoryProject } from "./hooks/useHistory";
import { useCityAudio } from "./hooks/useCityAudio";
import { useDesktopNotifications } from "./hooks/useDesktopNotifications";
import { AgentStatusBar } from "./ui/AgentStatusBar";
import { RecentProjects } from "./ui/RecentProjects";
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
import { WelcomeOverlay } from "./ui/WelcomeOverlay";
import { WorkspaceSwitcher } from "./ui/WorkspaceSwitcher";
import { CityWorldHud } from "./ui/CityWorldHud";
import type { ActiveSession, WorkspaceTarget } from "./shared/contracts";

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

  // Canonical city metrics shared by header and diegetic HUD.
  const [visibleAgentCount, setVisibleAgentCount] = useState(0);
  const [workingAgentCount, setWorkingAgentCount] = useState(0);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipInfo>({
    visible: false, x: 0, y: 0, title: "", type: "building",
  });

  // Active sessions for header logos
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const renderedSessionIdsRef = useRef<Set<string>>(new Set());
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceTarget | null>(null);

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

  const selectWorkspace = useCallback((workspace: WorkspaceTarget) => {
    setCurrentWorkspace(workspace);
  }, []);

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

      let index = 0;
      let hasWriting = false;
      let hasReading = false;
      let visibleSubagentCount = 0;
      let workingSubagentCount = 0;
      for (const [id, agent] of state.agents) {
        if (agent.agentKind === "session") continue;
        const isAmbientCitizen = id.startsWith("citizen-") && !agent.currentCommand;
        const variant = agent.agentKind === "subagent" ? "agent" : undefined;
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
        if (!isAmbientCitizen) {
          visibleSubagentCount++;
          if (agent.status !== "idle" && agent.status !== "walking") {
            workingSubagentCount++;
          }
        }
        index++;
      }
      // Single pulse flush after all agents have been updated — O(N) instead of O(N²)
      renderer.flushPulse();
      audioControls.setAgentActivity(hasWriting, hasReading);
      const visibleSessionCount = activeSessions.length;
      const workingSessionCount = activeSessions.filter((session) => session.status !== "idle").length;
      setVisibleAgentCount(visibleSessionCount + visibleSubagentCount);
      setWorkingAgentCount(workingSessionCount + workingSubagentCount);

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

    });
  // stateRef is a React ref (stable object) — omitting it from deps is correct.
  // subscribe is a stable useCallback from useCityState.
  // audioControls methods are stable useCallback refs.
  }, [activeSessions, ready, subscribe, audioControls]); // eslint-disable-line react-hooks/exhaustive-deps

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

        // Convert active sessions into synthetic city agents.
        // Relying only on `isLive` makes the city look empty when the backend
        // has discovered active sessions but hasn't yet promoted them to live.
        const visibleSessions = allSessions;
        const liveSessions = allSessions.filter((s) => s.isLive);
        const liveSubagentCount = Array.from(stateRef.current.agents.values()).filter((agent) => {
          if (agent.agentKind === "session") return false;
          if (agent.agentId.startsWith("citizen-") && !agent.currentCommand) return false;
          return true;
        }).length;
        const workingSubagentCount = Array.from(stateRef.current.agents.values()).filter((agent) => {
          if (agent.agentKind === "session") return false;
          if (agent.agentId.startsWith("citizen-") && !agent.currentCommand) return false;
          return agent.status !== "idle" && agent.status !== "walking";
        }).length;
        const workingSessionCount = allSessions.filter((session) => session.status !== "idle").length;
        setVisibleAgentCount(allSessions.length + liveSubagentCount);
        setWorkingAgentCount(workingSessionCount + workingSubagentCount);
        const renderer = rendererRef.current;
        if (renderer) {
          const nextRenderedIds = new Set<string>();
          for (let i = 0; i < visibleSessions.length; i++) {
            const session = visibleSessions[i];
            if (!session) continue;
            const syntheticId = `session-${session.sessionId}`;
            nextRenderedIds.add(syntheticId);
            // Check if this session is already tracked via WebSocket (with richer state)
            const wsAgent = stateRef.current.agents.get(session.sessionId);
            const effectiveStatus = wsAgent?.status ?? (session.isLive ? (session.status === "idle" ? "idle" : "walking") : "idle");
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
          }
          for (const renderedId of renderedSessionIdsRef.current) {
            if (!nextRenderedIds.has(renderedId)) {
              renderer.removeAgent(renderedId);
            }
          }
          renderedSessionIdsRef.current = nextRenderedIds;
        }
      } catch {
        // silently ignore — server may not be up yet
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stateRef]);

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

  useEffect(() => {
    if (activeSessions.length === 0) {
      return;
    }

    setCurrentWorkspace((current) => {
      if (current && activeSessions.some((session) => session.projectPath === current.projectPath)) {
        const matchingSession = activeSessions.find((session) => session.projectPath === current.projectPath && session.isLive);
        return matchingSession
          ? {
              projectName: matchingSession.projectName,
              projectPath: matchingSession.projectPath,
              preferredSessionId: matchingSession.sessionId,
              source: "session",
              isLive: true,
              ideName: matchingSession.ideName,
            }
          : current;
      }

      const preferred = activeSessions.find((session) => session.isLive) ?? activeSessions[0];
      if (!preferred) return current;
      return {
        projectName: preferred.projectName,
        projectPath: preferred.projectPath,
        preferredSessionId: preferred.isLive ? preferred.sessionId : undefined,
        source: preferred.isLive ? "session" : "project",
        isLive: preferred.isLive,
        ideName: preferred.ideName,
      };
    });
  }, [activeSessions]);

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
  const focusMode = notifOpen || chatOpen || historyOpen || projectsOpen || spawnOpen || powerGridOpen;

  return (
    <>
      {/* Header */}
      <div className={`city-header ${focusMode ? "focus-mode" : ""}`} onClick={handleRootClick}>
        <div className="header-brand">
          <div>
            <span className="city-title">NEON CITY</span>
            <span className="city-subtitle">CLAUDE CODE MISSION CONTROL</span>
          </div>
        </div>
        <div className="header-actions">
          <SessionStats
            sessionCount={activeSessions.length}
            agentCount={visibleAgentCount}
            workingCount={workingAgentCount}
          />
          <WorkspaceSwitcher
            activeSessions={activeSessions}
            currentWorkspace={currentWorkspace}
            onChange={selectWorkspace}
          />
          <WeatherIndicator
            weather={weather.state}
            reason={weather.reason}
            onSetWeather={(state) => {
              setWeather({ state, reason: "Manual override" });
              rendererRef.current?.setWeather(state, true);
              audioControls.setWeatherState(state);
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
            className={`glass-btn ${chatOpen ? "active" : ""}`}
            onClick={toggleWithAudio(setChatOpen)}
          >
            <span>Chat</span>
          </button>
          <button
            className={`glass-btn ${historyOpen ? "active" : ""}`}
            onClick={toggleWithAudio(setHistoryOpen)}
          >
            <span>History</span>
          </button>
          <button
            className={`glass-btn ${projectsOpen ? "active" : ""}`}
            onClick={() => setProjectsOpen((p) => !p)}
          >
            <span>Projects</span>
          </button>
          <button
            className="glass-btn primary-action"
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
        <CityWorldHud
          liveAgentCount={visibleAgentCount}
          workingAgentCount={workingAgentCount}
          liveSessionCount={activeSessions.length}
          approvalCount={notifCount}
          focusMode={focusMode}
          subscribeToMessages={subscribeToMessages}
          onOpenAlerts={() => setNotifOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      </div>
      <div className={`city-focus-scrim ${focusMode ? "visible" : ""}`} />

      {/* Welcome overlay — shown when no agents are active and not yet dismissed */}
      <WelcomeOverlay
        hasAgents={visibleAgentCount > 0}
        onOpenChat={() => { setChatOpen(true); }}
        onOpenProjects={() => { setProjectsOpen(true); }}
        onOpenSpawn={() => { setSpawnOpen(true); }}
        onOpenHistory={() => { setHistoryOpen(true); }}
      />

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
        subscribeToMessages={subscribeToMessages}
        activeSessions={activeSessions}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={selectWorkspace}
      />

      {/* History drawer */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        subscribeToMessages={subscribeToMessages}
      />

      {/* Project switcher */}
      <ProjectSwitcher
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        onSelectProject={(project) => {
          setCurrentWorkspace({
            projectName: project.name,
            projectPath: project.path,
            source: "project",
            isLive: !!activeSessions.find((session) => session.projectPath === project.path && session.isLive),
            preferredSessionId: activeSessions.find((session) => session.projectPath === project.path && session.isLive)?.sessionId,
            ideName: activeSessions.find((session) => session.projectPath === project.path && session.isLive)?.ideName,
          });
        }}
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
        onOpenProject={(projectPath) => {
          const project = projectDetailProject;
          if (project) {
            setCurrentWorkspace({
              projectName: project.name,
              projectPath,
              source: "project",
              isLive: activeSessions.some((session) => session.projectPath === projectPath && session.isLive),
              preferredSessionId: activeSessions.find((session) => session.projectPath === projectPath && session.isLive)?.sessionId,
              ideName: activeSessions.find((session) => session.projectPath === projectPath && session.isLive)?.ideName,
            });
          }
          setProjectDetailOpen(false);
          setProjectDetailProject(null);
          setProjectsOpen(true);
        }}
      />

      {/* Recent projects quick-launch strip */}
      <RecentProjects
        onOpenChat={(path) => {
          const matchingSession = activeSessions.find((session) => session.projectPath === path && session.isLive);
          setCurrentWorkspace({
            projectName: matchingSession?.projectName || projectDetailProject?.name || "Workspace",
            projectPath: path,
            source: matchingSession ? "session" : "project",
            isLive: !!matchingSession,
            preferredSessionId: matchingSession?.sessionId,
            ideName: matchingSession?.ideName,
          });
          setChatOpen(true);
        }}
        onSpawnAgent={(path) => {
          const matchingSession = activeSessions.find((session) => session.projectPath === path && session.isLive);
          setCurrentWorkspace({
            projectName: matchingSession?.projectName || "Workspace",
            projectPath: path,
            source: matchingSession ? "session" : "project",
            isLive: !!matchingSession,
            preferredSessionId: matchingSession?.sessionId,
            ideName: matchingSession?.ideName,
          });
          setSpawnContext({ projectPath: path });
          setSpawnOpen(true);
        }}
        onOpenProject={(project) => {
          setCurrentWorkspace({
            projectName: project.name,
            projectPath: project.path,
            source: "project",
            isLive: !!activeSessions.find((session) => session.projectPath === project.path && session.isLive),
            preferredSessionId: activeSessions.find((session) => session.projectPath === project.path && session.isLive)?.sessionId,
            ideName: activeSessions.find((session) => session.projectPath === project.path && session.isLive)?.ideName,
          });
          setProjectsOpen(true);
        }}
      />

      {/* Agent bar */}
      <AgentStatusBar
        stateRef={stateRef}
        subscribe={subscribe}
        activeSessions={activeSessions}
        currentWorkspace={currentWorkspace}
        onSpawnOpen={() => setSpawnOpen(true)}
        onQuickCommit={() => {
          const projectPath = currentWorkspace?.projectPath || activeSessions[0]?.projectPath;
          if (!projectPath) return;
          fetch(`/api/git/action?path=${encodeURIComponent(projectPath)}&action=commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).catch(() => {});
        }}
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
        initialProjectPath={spawnContext?.projectPath || currentWorkspace?.projectPath}
        currentWorkspace={currentWorkspace}
      />
    </>
  );
}
