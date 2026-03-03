import { useEffect, useState } from "react";
import type { AgentState } from "../hooks/useCityState";

interface Props {
  stateRef: React.RefObject<{ agents: Map<string, AgentState>; version: number }>;
  subscribe: (listener: (state: any) => void) => () => void;
  onSpawn?: () => void;
}

export function AgentStatusBar({ stateRef, subscribe, onSpawn }: Props) {
  const [agents, setAgents] = useState<AgentState[]>([]);

  useEffect(() => {
    return subscribe(() => {
      setAgents(Array.from(stateRef.current.agents.values()));
    });
  }, [stateRef, subscribe]);

  const spawnButton = onSpawn ? (
    <button
      className="agent-spawn-btn"
      onClick={(e) => {
        e.stopPropagation();
        onSpawn();
      }}
    >
      <span className="spawn-icon">+</span>
      <span>Summon Agent</span>
    </button>
  ) : null;

  if (agents.length === 0) {
    return (
      <div className="agent-bar">
        <div className="agent-card">
          <div className="dot idle" />
          <div>
            <div className="name">NO AGENTS</div>
            <div className="status">waiting for Claude Code...</div>
          </div>
        </div>
        {spawnButton}
      </div>
    );
  }

  return (
    <div className="agent-bar">
      {agents.map((agent) => (
        <div key={agent.agentId} className="agent-card">
          <div className={`dot ${agent.status}`} />
          <div>
            <div className="name">{agent.displayName}</div>
            <div className="status">{agent.status.toUpperCase()}</div>
            {agent.toolInput && (
              <div className="file">{formatFile(agent.toolInput)}</div>
            )}
          </div>
        </div>
      ))}
      {spawnButton}
    </div>
  );
}

function formatFile(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}
