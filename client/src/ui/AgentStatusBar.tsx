import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AgentState } from "../hooks/useCityState";
import type { ActiveSession, WorkspaceTarget } from "../shared/contracts";
import { ROLE_BADGE_CSS_COLORS as ROLE_BADGE_COLORS, AGENT_PALETTE_COLORS } from "../shared/agent-roles";
import { basename } from "../shared/format";

// Status display config
type StatusKey = "reading" | "writing" | "thinking" | "stuck" | "idle" | "walking";

const STATUS_CONFIG: Record<StatusKey, { label: string; color: string }> = {
  reading:  { label: "READING",  color: "#ffd050" },
  writing:  { label: "WRITING",  color: "#40ff80" },
  thinking: { label: "THINKING", color: "#40ddff" },
  stuck:    { label: "STUCK",    color: "#ff4040" },
  idle:     { label: "IDLE",     color: "#666677" },
  walking:  { label: "WALKING",  color: "#888888" },
};

function getStatusConfig(status: string): { label: string; color: string } {
  return STATUS_CONFIG[status as StatusKey] ?? { label: status.toUpperCase(), color: "#888888" };
}

function getBorderColor(colorIndex: number): string {
  return AGENT_PALETTE_COLORS[colorIndex % AGENT_PALETTE_COLORS.length] ?? "#4466aa";
}

function shortModelName(model?: string): string | null {
  if (!model) return null;
  if (model.includes("opus")) return "OPUS";
  if (model.includes("sonnet")) return "SONNET";
  if (model.includes("haiku")) return "HAIKU";
  return null;
}

function getToolIcon(command: string): string {
  switch (command) {
    case "Read": case "Glob": case "Grep": return "📖";
    case "Write": case "Edit": return "✎";
    case "Bash": return "▸";
    case "WebSearch": case "WebFetch": return "🔍";
    default: return "◆";
  }
}

function describeActivity(command: string, toolInput?: string): string {
  const file = toolInput ? basename(toolInput) : "";
  switch (command) {
    case "Read": return file ? `Reading ${file}` : "Reading files";
    case "Glob": return file ? `Searching for ${file}` : "Searching files";
    case "Grep": return file ? `Searching in ${file}` : "Searching code";
    case "Write": return file ? `Writing ${file}` : "Writing code";
    case "Edit": return file ? `Editing ${file}` : "Editing code";
    case "Bash": return file ? `Running: ${file}` : "Running command";
    case "WebSearch": return "Searching the web";
    case "WebFetch": return "Fetching web page";
    default: return command;
  }
}

interface ProjectContext {
  name: string;
  branch: string | null;
  dirty: boolean;
}

interface Props {
  stateRef: React.RefObject<{ agents: Map<string, AgentState>; version: number }>;
  subscribe: (listener: (state: unknown) => void) => () => void;
  activeSessions: ActiveSession[];
  currentWorkspace: WorkspaceTarget | null;
  onSpawnOpen?: () => void;
  onQuickCommit?: () => void;
}

interface AgentCardData extends AgentState {
  colorIndex: number;
  isNew?: boolean;
}

export function AgentStatusBar({ stateRef, subscribe, activeSessions, currentWorkspace, onSpawnOpen, onQuickCommit }: Props) {
  const [agents, setAgents] = useState<AgentCardData[]>([]);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);

  useEffect(() => {
    const projectPath = currentWorkspace?.projectPath || activeSessions[0]?.projectPath;
    if (!projectPath) {
      setProjectContext(null);
      return;
    }

    const fetchContext = async () => {
      try {
        const gitRes = await fetch(
          `/api/git/status?path=${encodeURIComponent(projectPath)}`
        );
        const gitData = await gitRes.json();
        setProjectContext({
          name: currentWorkspace?.projectName || activeSessions[0]?.projectName || "Unknown",
          branch: gitData.branch,
          dirty: gitData.dirty,
        });
      } catch { /* ignore */ }
    };

    fetchContext();
    const interval = setInterval(fetchContext, 15_000);
    return () => clearInterval(interval);
  }, [activeSessions, currentWorkspace]);

  useEffect(() => {
    const syncAgents = () => {
      const subagents: AgentCardData[] = [];
      const currentIds = new Set<string>();
      let fallbackIndex = 0;
      for (const agent of stateRef.current.agents.values()) {
        if (agent.agentKind === "session") continue;
        // Hide citizen placeholder agents unless they've been invoked (active tool use)
        if (agent.agentId.startsWith("citizen-") && !agent.currentCommand) continue;
        const isNew = !previousIdsRef.current.has(agent.agentId);
        // Use colorIndex from agent state (set by App.tsx renderer sync) for consistency with sprite colors
        const colorIndex = agent.colorIndex ?? fallbackIndex;
        subagents.push({ ...agent, colorIndex, isNew });
        currentIds.add(agent.agentId);
        fallbackIndex++;
      }

      const sessionCards: AgentCardData[] = activeSessions.map((session, index) => {
        const normalizedId = session.sessionId.startsWith("session-")
          ? session.sessionId.slice(8)
          : session.sessionId;
        const liveAgent = stateRef.current.agents.get(normalizedId);
        const status = liveAgent?.status ?? (session.isLive ? session.status || "walking" : "idle");
        const currentCommand = liveAgent?.currentCommand;
        const toolInput = liveAgent?.toolInput;
        const agentId = `session-card-${session.sessionId}`;
        currentIds.add(agentId);
        return {
          agentId,
          displayName: session.projectName,
          source: "claude",
          isThinking: liveAgent?.isThinking ?? false,
          currentCommand,
          toolInput,
          lastActivity: session.lastActivity,
          status: status as AgentState["status"],
          agentKind: "session",
          colorIndex: index,
          isNew: !previousIdsRef.current.has(agentId),
        };
      });

      previousIdsRef.current = currentIds;
      setAgents([...sessionCards, ...subagents]);
    };

    syncAgents();
    return subscribe(syncAgents);
  }, [activeSessions, stateRef, subscribe]);

  return (
    <div className="agent-bar">
      {/* LEFT: Project Context */}
      <div className="status-bar-context">
        {projectContext ? (
          <>
            <span className="status-project-name">{projectContext.name}</span>
            {projectContext.branch && (
              <span className="status-branch">
                <span className="status-branch-icon">Y</span>
                {projectContext.branch}
              </span>
            )}
            <span className={`status-git-dot ${projectContext.dirty ? "dirty" : "clean"}`} />
          </>
        ) : (
          <span className="status-no-project">No active project</span>
        )}
      </div>

      {/* CENTER: Agent Cards */}
      <div className="status-bar-agents">
        {agents.length === 0 ? (
          <div className="status-bar-idle">
            <div className="dot idle" />
            <span>Waiting for agents...</span>
          </div>
        ) : (
          agents.map((agent) => {
            const borderColor = getBorderColor(agent.colorIndex);
            const statusCfg = getStatusConfig(agent.status);
            const modelLabel = shortModelName(agent.model);

            return (
              <div
                key={agent.agentId}
                className={`agent-card-enhanced${agent.isNew ? " agent-card-new" : ""}${agent.agentKind === "session" ? " session-glow" : ""}`}
                style={{
                  "--agent-border-color": borderColor,
                  "--agent-status-color": statusCfg.color,
                } as CSSProperties}
              >
                {/* Left border glow */}
                <div className="agent-card-glow" />

                {/* Top row: status dot + name + kind badge */}
                <div className="agent-card-header">
                  <div
                    className={`dot ${agent.status}`}
                    style={{ background: statusCfg.color, boxShadow: `0 0 4px ${statusCfg.color}` }}
                  />
                  <span className="agent-card-name">
                    {agent.displayName}
                  </span>
                  {agent.agentKind && (
                    <span className={`agent-kind-badge ${agent.agentKind === "session" ? "session" : "subagent"}`}>
                      {agent.agentKind === "session" ? "IDE" : "SUB"}
                    </span>
                  )}
                  {modelLabel && (
                    <span className={`agent-model-badge ${modelLabel.toLowerCase()}`}>
                      {modelLabel}
                    </span>
                  )}
                </div>

                {/* Activity line: tool + file */}
                {agent.currentCommand ? (
                  <div className="agent-activity agent-activity-live">
                    {getToolIcon(agent.currentCommand)} {describeActivity(agent.currentCommand, agent.toolInput)}
                  </div>
                ) : (
                  <div className="agent-activity agent-activity-idle">
                    {statusCfg.label}
                  </div>
                )}

                {/* Role badge for subagents with a known agentType */}
                {agent.agentKind === "subagent" && agent.agentType && ROLE_BADGE_COLORS[agent.agentType] && (
                  <div className="agent-role-badge" style={{ color: ROLE_BADGE_COLORS[agent.agentType] }}>
                    {agent.agentType}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* RIGHT: Quick Actions */}
      <div className="status-bar-actions">
        {projectContext?.dirty && onQuickCommit && (
          <button className="status-quick-btn" onClick={onQuickCommit}>
            Commit
          </button>
        )}
        {onSpawnOpen && (
          <button className="status-quick-btn" onClick={onSpawnOpen}>
            + Agent
          </button>
        )}
      </div>
    </div>
  );
}
