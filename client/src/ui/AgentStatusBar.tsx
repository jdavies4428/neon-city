import { useEffect, useRef, useState } from "react";
import type { AgentState } from "../hooks/useCityState";
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

interface Props {
  stateRef: React.RefObject<{ agents: Map<string, AgentState>; version: number }>;
  subscribe: (listener: (state: unknown) => void) => () => void;
}

interface AgentCardData extends AgentState {
  colorIndex: number;
  isNew?: boolean;
}

export function AgentStatusBar({ stateRef, subscribe }: Props) {
  const [agents, setAgents] = useState<AgentCardData[]>([]);
  const previousIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return subscribe(() => {
      const agentList: AgentCardData[] = [];
      const currentIds = new Set<string>();
      let fallbackIndex = 0;
      for (const agent of stateRef.current.agents.values()) {
        // Hide citizen placeholder agents unless they've been invoked (active tool use)
        if (agent.agentId.startsWith("citizen-") && !agent.currentCommand) continue;
        const isNew = !previousIdsRef.current.has(agent.agentId);
        // Use colorIndex from agent state (set by App.tsx renderer sync) for consistency with sprite colors
        const colorIndex = agent.colorIndex ?? fallbackIndex;
        agentList.push({ ...agent, colorIndex, isNew });
        currentIds.add(agent.agentId);
        fallbackIndex++;
      }
      previousIdsRef.current = currentIds;
      setAgents(agentList);
    });
  }, [stateRef, subscribe]);

  if (agents.length === 0) {
    return (
      <div className="agent-bar">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 10px",
            background: "#0a0a1a",
            border: "1px solid #1a1a33",
            borderRadius: "3px",
            minWidth: "140px",
          }}
        >
          <div className="dot idle" />
          <div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "10px",
                fontVariant: "small-caps",
                letterSpacing: "1px",
                color: "rgba(255,255,255,0.5)",
                fontWeight: 600,
              }}
            >
              NO AGENTS
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "9px",
                color: "#666677",
                letterSpacing: "0.5px",
                marginTop: "2px",
              }}
            >
              waiting for Claude Code...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-bar">
      {agents.map((agent) => {
        const borderColor = getBorderColor(agent.colorIndex);
        const statusCfg = getStatusConfig(agent.status);

        return (
          <div
            key={agent.agentId}
            className={`agent-card-enhanced${agent.isNew ? " agent-card-new" : ""}${agent.agentKind === "session" ? " session-glow" : ""}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              padding: "6px 10px",
              paddingLeft: "12px",
              background: "#0a0a1a",
              border: "1px solid #1a1a33",
              borderLeft: `2px solid ${borderColor}`,
              borderRadius: "3px",
              minWidth: "160px",
              maxWidth: "200px",
              cursor: "default",
              position: "relative",
              flexShrink: 0,
            }}
          >
            {/* Left border glow */}
            <div style={{
              position: "absolute", top: 0, left: 0, bottom: 0, width: "2px",
              background: borderColor,
              boxShadow: `0 0 6px ${borderColor}, 0 0 12px ${borderColor}40`,
              borderRadius: "3px 0 0 3px",
            }} />

            {/* Top row: status dot + name + kind badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <div
                className={`dot ${agent.status}`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: statusCfg.color,
                  boxShadow: `0 0 4px ${statusCfg.color}`,
                  flexShrink: 0,
                }}
              />
              <span style={{
                fontFamily: "monospace",
                fontSize: "10px",
                fontVariant: "small-caps",
                letterSpacing: "1px",
                color: "rgba(255,255,255,0.55)",
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}>
                {agent.displayName}
              </span>
              {agent.agentKind && (
                <span style={{
                  fontFamily: "monospace",
                  fontSize: "7px",
                  fontWeight: 700,
                  padding: "1px 3px",
                  borderRadius: "2px",
                  background: agent.agentKind === "session"
                    ? "rgba(64,221,255,0.2)"
                    : "rgba(64,255,128,0.2)",
                  color: agent.agentKind === "session" ? "#40ddff" : "#40ff80",
                  letterSpacing: "0.5px",
                  flexShrink: 0,
                }}>
                  {agent.agentKind === "session" ? "IDE" : "SUB"}
                </span>
              )}
            </div>

            {/* Activity line: tool + file */}
            {agent.currentCommand ? (
              <div style={{
                fontFamily: "monospace",
                fontSize: "9px",
                color: statusCfg.color,
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {getToolIcon(agent.currentCommand)} {describeActivity(agent.currentCommand, agent.toolInput)}
              </div>
            ) : (
              <div style={{
                fontFamily: "monospace",
                fontSize: "9px",
                color: "#444455",
                letterSpacing: "0.5px",
              }}>
                {statusCfg.label}
              </div>
            )}

            {/* Role badge for subagents with a known agentType */}
            {agent.agentKind === "subagent" && agent.agentType && ROLE_BADGE_COLORS[agent.agentType] && (
              <div style={{
                fontFamily: "monospace",
                fontSize: "8px",
                color: ROLE_BADGE_COLORS[agent.agentType],
                letterSpacing: "0.5px",
                opacity: 0.7,
              }}>
                {agent.agentType}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
