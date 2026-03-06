import React, { useState, useEffect } from "react";

interface RecentProject {
  id: number;
  name: string;
  path: string;
  session_count: number;
  isLive?: boolean;
}

interface RecentProjectsProps {
  onOpenChat: (projectPath: string) => void;
  onSpawnAgent: (projectPath: string) => void;
  onOpenProject: (project: RecentProject) => void;
}

export const RecentProjects: React.FC<RecentProjectsProps> = ({
  onOpenChat,
  onSpawnAgent,
  onOpenProject,
}) => {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchProjects() {
      try {
        const [projRes, sessRes] = await Promise.all([
          fetch("/api/history/projects"),
          fetch("/api/sessions/active"),
        ]);
        const projData = await projRes.json();
        const sessData = await sessRes.json();
        if (cancelled) return;

        const indexedList = projData.projects || projData;
        const activeSessions = sessData.sessions || [];

        // Build map keyed by project name
        const projectMap = new Map<string, RecentProject>();
        for (const p of indexedList) {
          projectMap.set(p.name, { ...p, isLive: false });
        }

        // Merge active session projects
        for (const s of activeSessions) {
          if (!s.isLive || !s.projectName) continue;
          const existing = projectMap.get(s.projectName);
          if (existing) {
            existing.isLive = true;
          } else {
            projectMap.set(s.projectName, {
              id: -1,
              name: s.projectName,
              path: s.projectPath || "",
              session_count: 1,
              isLive: true,
            });
          }
        }

        // Sort: live first, then by session count
        const sorted = Array.from(projectMap.values())
          .sort((a, b) => {
            if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
            return b.session_count - a.session_count;
          })
          .slice(0, 7);

        setProjects(sorted);
      } catch { /* ignore */ }
    }

    fetchProjects();
    const interval = setInterval(fetchProjects, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (projects.length === 0) return null;

  return (
    <div className={`recent-projects ${collapsed ? "collapsed" : ""}`}>
      <button
        className="recent-projects-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        Recent Projects
        <span className="recent-toggle-arrow">{collapsed ? "\u25B2" : "\u25BC"}</span>
      </button>

      {!collapsed && (
        <div className="recent-projects-strip">
          {projects.map((p) => (
            <div
              key={p.id}
              className="recent-project-card"
              onClick={() => onOpenProject(p)}
            >
              <div className="recent-project-name">
                {p.isLive && <span className="live-dot" />}
                {p.name}
              </div>
              <div className="recent-project-meta">
                {p.session_count} session{p.session_count !== 1 ? "s" : ""}
              </div>
              <div className="recent-project-actions">
                <button
                  className="recent-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChat(p.path);
                  }}
                  title="Open chat for this project"
                >
                  Chat
                </button>
                <button
                  className="recent-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSpawnAgent(p.path);
                  }}
                  title="Spawn agent for this project"
                >
                  Agent
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
