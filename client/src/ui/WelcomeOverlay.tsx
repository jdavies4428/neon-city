import React, { useState, useEffect } from "react";

interface WelcomeOverlayProps {
  hasAgents: boolean;
  onOpenChat: () => void;
  onOpenProjects: () => void;
  onOpenSpawn: () => void;
  onOpenHistory: () => void;
}

const STORAGE_KEY = "neon-city-welcomed";

export const WelcomeOverlay: React.FC<WelcomeOverlayProps> = ({
  hasAgents,
  onOpenChat,
  onOpenProjects,
  onOpenSpawn,
  onOpenHistory,
}) => {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    if (hasAgents) setDismissed(true);
  }, [hasAgents]);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  const handleAction = (action: () => void) => {
    action();
    dismiss();
  };

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <h1 className="welcome-title">WELCOME TO NEON CITY</h1>
        <p className="welcome-subtitle">Choose one clear starting point, then let the city fill in around your work.</p>

        <button className="welcome-primary" onClick={() => handleAction(onOpenProjects)}>
          <span className="welcome-primary-kicker">Recommended</span>
          <span className="welcome-primary-title">Choose a workspace</span>
          <span className="welcome-primary-copy">Set the project in focus first. Chat, history, and agent actions will all inherit that context.</span>
        </button>

        <div className="welcome-actions">
          <button className="welcome-btn" onClick={() => handleAction(onOpenChat)}>
            <span className="welcome-btn-icon" style={{ color: "var(--neon-cyan)" }}>{">"}</span>
            <div>
              <div className="welcome-btn-label">Open Chat</div>
              <div className="welcome-btn-desc">Talk to a live session or send workspace context</div>
            </div>
          </button>

          <button className="welcome-btn" onClick={() => handleAction(onOpenSpawn)}>
            <span className="welcome-btn-icon" style={{ color: "var(--neon-purple)" }}>+</span>
            <div>
              <div className="welcome-btn-label">Summon an Agent</div>
              <div className="welcome-btn-desc">Launch a specialist once the workspace is set</div>
            </div>
          </button>

          <button className="welcome-btn" onClick={() => handleAction(onOpenHistory)}>
            <span className="welcome-btn-icon" style={{ color: "var(--neon-yellow)" }}>H</span>
            <div>
              <div className="welcome-btn-label">Browse History</div>
              <div className="welcome-btn-desc">Review past sessions, search, and plans</div>
            </div>
          </button>
        </div>

        <button className="welcome-dismiss" onClick={dismiss}>dismiss</button>
      </div>
    </div>
  );
};
