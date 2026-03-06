import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryProject } from "../hooks/useHistory";
import type { ActiveSession, WorkspaceTarget } from "../shared/contracts";

interface Props {
  activeSessions: ActiveSession[];
  currentWorkspace: WorkspaceTarget | null;
  onChange: (workspace: WorkspaceTarget) => void;
}

export function WorkspaceSwitcher({ activeSessions, currentWorkspace, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/history/projects")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.projects)) {
          setProjects(data.projects);
        }
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const options = useMemo(() => {
    const byPath = new Map<string, WorkspaceTarget>();

    for (const session of activeSessions) {
      if (!session.projectPath) continue;
      byPath.set(session.projectPath, {
        projectName: session.projectName,
        projectPath: session.projectPath,
        preferredSessionId: session.sessionId,
        source: "session",
        isLive: session.isLive,
        ideName: session.ideName,
      });
    }

    for (const project of projects) {
      if (byPath.has(project.path)) continue;
      byPath.set(project.path, {
        projectName: project.name,
        projectPath: project.path,
        source: "project",
        isLive: false,
      });
    }

    return Array.from(byPath.values()).sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return a.projectName.localeCompare(b.projectName);
    });
  }, [activeSessions, projects]);

  return (
    <div className="workspace-switcher" ref={ref}>
      <button
        className="workspace-trigger"
        onClick={() => setOpen((value) => !value)}
        title="Switch workspace"
      >
        <span className={`workspace-dot ${currentWorkspace?.isLive ? "live" : "idle"}`} />
        <span className="workspace-trigger-copy">
          <span className="workspace-trigger-label">Workspace</span>
          <span className="workspace-trigger-name">
            {currentWorkspace?.projectName || "Select project"}
          </span>
          <span className="workspace-trigger-summary">
            {currentWorkspace?.preferredSessionId
              ? `${currentWorkspace.ideName || "Live"} session`
              : currentWorkspace
                ? "Indexed workspace"
                : "Choose current workspace"}
          </span>
        </span>
        <span className="workspace-trigger-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="workspace-menu">
          <div className="workspace-menu-header">
            <span className="workspace-menu-title">Quick Switch</span>
            <span className="workspace-menu-copy">Choose the workspace chat and agent actions should use.</span>
          </div>
          {options.length === 0 && (
            <div className="workspace-empty">No projects discovered yet</div>
          )}
          {options.map((option) => (
            <button
              key={option.projectPath}
              className={`workspace-item${currentWorkspace?.projectPath === option.projectPath ? " active" : ""}`}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span className={`workspace-dot ${option.isLive ? "live" : "idle"}`} />
              <span className="workspace-item-name">{option.projectName}</span>
              <span className="workspace-item-meta">
                {option.preferredSessionId ? `${option.ideName || "Live"} session` : "Indexed workspace"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
