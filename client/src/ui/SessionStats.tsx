import { useEffect, useState } from "react";
import { formatTokens } from "../shared/format";

interface Stats {
  activeAgents: number;
  totalSessions: number;
  totalProjects: number;
  totalTokens: number;
  estimatedCost: number;
  tokens24h: number;
}

interface Props {
  liveAgentCount: number;
}

export function SessionStats({ liveAgentCount }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    // Initial fetch
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    // Refresh every 15 seconds
    const interval = setInterval(() => {
      fetch("/api/stats")
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    }, 15_000);

    return () => clearInterval(interval);
  }, []);

  const activeCount = liveAgentCount || stats?.activeAgents || 0;
  const totalSessions = stats?.totalSessions || 0;
  const totalTokens = stats?.totalTokens || 0;
  const cost = stats?.estimatedCost || 0;

  return (
    <div className="session-stats">
      <div className="stat-item" title="Active agents / Total sessions">
        <span className="stat-value">
          <span className={`stat-active ${activeCount > 0 ? "live" : ""}`}>
            {activeCount}
          </span>
          <span className="stat-sep">/</span>
          <span className="stat-total">{totalSessions}</span>
        </span>
        <span className="stat-label">sessions</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item" title={`~${formatTokens(totalTokens, 1)} tokens total, ~$${cost.toFixed(2)} estimated cost`}>
        <span className="stat-value stat-cost">
          ${cost < 1 ? cost.toFixed(2) : cost < 100 ? cost.toFixed(1) : Math.round(cost)}
        </span>
        <span className="stat-label">cost</span>
      </div>
    </div>
  );
}
