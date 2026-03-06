import React, { useState, useEffect } from "react";

interface GitStatus {
  branch: string | null;
  files: { status: string; file: string }[];
  dirty: boolean;
  ahead: number;
  behind: number;
  fileCount: number;
  error?: string;
}

interface GitStatusBarProps {
  projectPath: string;
  projectName: string;
}

export const GitStatusBar: React.FC<GitStatusBarProps> = ({
  projectPath,
  projectName: _projectName,
}) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/git/status?path=${encodeURIComponent(projectPath)}`
      );
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
    setLoading(false);
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      await fetch(
        `/api/git/action?path=${encodeURIComponent(projectPath)}&action=${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
    } finally {
      setActionLoading(null);
      setTimeout(fetchStatus, 3000);
    }
  };

  if (loading) {
    return <div className="git-bar git-loading">Loading git status...</div>;
  }
  if (!status?.branch) {
    return <div className="git-bar git-none">Not a git repository</div>;
  }

  return (
    <div className="git-bar">
      <div className="git-info-row">
        <div className="git-branch">
          <span className="git-branch-icon">Y</span>
          <span>{status.branch}</span>
        </div>
        <div className="git-status-summary">
          {status.dirty ? (
            <span className="git-dirty">
              {status.fileCount} file{status.fileCount !== 1 ? "s" : ""} changed
            </span>
          ) : (
            <span className="git-clean">Clean</span>
          )}
          {status.ahead > 0 && (
            <span className="git-ahead">{status.ahead} ahead</span>
          )}
          {status.behind > 0 && (
            <span className="git-behind">{status.behind} behind</span>
          )}
        </div>
      </div>

      <div className="git-actions">
        <button
          className="git-action-btn git-commit"
          disabled={!status.dirty || !!actionLoading}
          onClick={() => handleAction("commit")}
        >
          {actionLoading === "commit" ? "..." : "Commit"}
        </button>
        <button
          className="git-action-btn git-push"
          disabled={!!actionLoading}
          onClick={() => handleAction("push")}
        >
          {actionLoading === "push" ? "..." : "Push"}
        </button>
        <button
          className="git-action-btn git-pr"
          disabled={!!actionLoading}
          onClick={() => handleAction("pr")}
        >
          {actionLoading === "pr" ? "..." : "Create PR"}
        </button>
        <button
          className="git-action-btn git-pull"
          disabled={!!actionLoading}
          onClick={() => handleAction("pull")}
        >
          {actionLoading === "pull" ? "..." : "Pull"}
        </button>
      </div>

      {status.dirty && (
        <div className="git-files">
          {status.files.slice(0, 8).map((f, i) => (
            <div key={i} className="git-file-row">
              <span
                className={`git-file-status git-file-${f.status.replace("?", "untracked")}`}
              >
                {f.status}
              </span>
              <span className="git-file-name">{f.file}</span>
            </div>
          ))}
          {status.files.length > 8 && (
            <div className="git-file-more">
              +{status.files.length - 8} more files
            </div>
          )}
        </div>
      )}
    </div>
  );
};
