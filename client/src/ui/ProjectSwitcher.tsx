import { useEffect, useState, useCallback } from "react";
import type { HistoryProject } from "../hooks/useHistory";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectProject: (project: HistoryProject) => void;
  currentWeather: string;
}

export function ProjectSwitcher({ open, onClose, onSelectProject, currentWeather }: Props) {
  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/history/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchProjects();
      setShowNewProject(false);
      setNewProjectName("");
      setCreating(false);
    }
  }, [open, fetchProjects]);

  const formatTime = (ts: number) => {
    if (!ts) return "never";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleOpenProject = async (projectPath: string) => {
    try {
      await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `cd ${projectPath} && echo "Switched to ${projectPath}"`,
        }),
      });
    } catch {
      // Best effort
    }
  };

  const handleNewProject = async () => {
    const name = newProjectName.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewProjectName("");
        setShowNewProject(false);
        // Refresh project list to show the new one
        fetchProjects();
      }
    } catch {
      // Best effort
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="project-switcher-overlay" onClick={onClose}>
      <div className="project-switcher" onClick={(e) => e.stopPropagation()}>
        <div className="project-switcher-header">
          <span className="panel-title">PROJECTS</span>
          <div className="project-header-actions">
            <button
              className="glass-btn new-project-btn"
              onClick={() => setShowNewProject((p) => !p)}
            >
              + New Project
            </button>
            <button className="panel-close" onClick={onClose}>×</button>
          </div>
        </div>

        {/* New project input */}
        {showNewProject && (
          <div className="new-project-row">
            <input
              className="new-project-input"
              type="text"
              placeholder="Enter project name (e.g. my-app)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNewProject()}
              autoFocus
            />
            <button
              className="new-project-go"
              onClick={handleNewProject}
              disabled={!newProjectName.trim() || creating}
            >
              {creating ? "..." : "Create"}
            </button>
          </div>
        )}
        {showNewProject && (
          <div className="new-project-hint">
            Creates ~/Projects/{newProjectName.trim().replace(/[^a-zA-Z0-9\-_.]/g, "-").replace(/-+/g, "-") || "name"}
          </div>
        )}

        <div className="project-grid">
          {loading && projects.length === 0 && (
            <div className="drawer-empty">Loading projects...</div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              className="project-card"
              onClick={() => {
                onSelectProject(p);
                handleOpenProject(p.path || p.name);
                onClose();
              }}
            >
              {/* Mini city preview */}
              <div className="project-preview">
                <div className="mini-skyline">
                  {Array.from({ length: Math.min(p.session_count, 7) }, (_, i) => (
                    <div
                      key={i}
                      className="mini-building"
                      style={{
                        height: `${20 + Math.random() * 30}px`,
                        background: `hsl(${220 + i * 20}, 60%, ${15 + i * 3}%)`,
                      }}
                    />
                  ))}
                </div>
                <div className="mini-road" />
              </div>

              <div className="project-info">
                <span className="project-name">{p.name}</span>
                <span className="project-meta">
                  {p.session_count} session{p.session_count !== 1 ? "s" : ""}
                </span>
                <span className="project-time">{formatTime(p.last_indexed)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
