import { useEffect, useState, useRef } from "react";
import { formatTokens } from "../shared/format";

interface TokenData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  tokens24h: number;
  totalMessages: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PowerGridModal({ open, onClose }: Props) {
  const [data, setData] = useState<TokenData | null>(null);
  const prevTokensRef = useRef(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!open) return;

    const fetchStats = () => {
      fetch("/api/stats")
        .then((r) => r.json())
        .then((s) => {
          setData({
            totalTokens: s.totalTokens || 0,
            inputTokens: s.inputTokens || 0,
            outputTokens: s.outputTokens || 0,
            estimatedCost: s.estimatedCost || 0,
            tokens24h: s.tokens24h || 0,
            totalMessages: s.totalMessages || 0,
          });

          if (s.totalTokens > prevTokensRef.current && prevTokensRef.current > 0) {
            setFlash(true);
            setTimeout(() => setFlash(false), 600);
          }
          prevTokensRef.current = s.totalTokens || 0;
        })
        .catch(() => {});
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const totalTokens = data?.totalTokens ?? 0;
  const inputTokens = data?.inputTokens ?? 0;
  const outputTokens = data?.outputTokens ?? 0;
  const estimatedCost = data?.estimatedCost ?? 0;
  const tokens24h = data?.tokens24h ?? 0;
  const totalMessages = data?.totalMessages ?? 0;

  const powerLevel = Math.min(100, Math.round((tokens24h / 1_000_000) * 100));
  const segments = 10;
  const filledSegments = Math.ceil((powerLevel / 100) * segments);

  return (
    <div className="power-grid-overlay" onClick={onClose}>
      <div
        className={`power-grid-modal${flash ? " flash" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="power-grid-header">
          <div className="power-grid-title-row">
            <span className="power-grid-icon">⚡</span>
            <span className="power-grid-title">POWER GRID</span>
          </div>
          <button className="power-grid-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* Power bar */}
        <div className="power-grid-bar-section">
          <div className="power-grid-bar-label">
            <span>24H LOAD</span>
            <span className="power-grid-bar-pct">{powerLevel}%</span>
          </div>
          <div className="power-grid-bar">
            {Array.from({ length: segments }, (_, i) => (
              <div
                key={i}
                className={`power-grid-segment${i < filledSegments ? " filled" : ""}${
                  i < filledSegments
                    ? i < segments * 0.3
                      ? " low"
                      : i < segments * 0.7
                        ? " mid"
                        : " high"
                    : ""
                }`}
              />
            ))}
          </div>
        </div>

        {/* Stats grid */}
        <div className="power-grid-stats">
          <div className="power-grid-stat-card">
            <span className="pgstat-label">TOTAL TOKENS</span>
            <span className="pgstat-val">{formatTokens(totalTokens)}</span>
          </div>
          <div className="power-grid-stat-card">
            <span className="pgstat-label">24H USAGE</span>
            <span className="pgstat-val">{formatTokens(tokens24h)}</span>
          </div>
          <div className="power-grid-stat-card input">
            <span className="pgstat-label input">INPUT</span>
            <span className="pgstat-val">{formatTokens(inputTokens)}</span>
          </div>
          <div className="power-grid-stat-card output">
            <span className="pgstat-label output">OUTPUT</span>
            <span className="pgstat-val">{formatTokens(outputTokens)}</span>
          </div>
          <div className="power-grid-stat-card cost">
            <span className="pgstat-label">EST. COST</span>
            <span className="pgstat-val cost">${estimatedCost.toFixed(2)}</span>
          </div>
          <div className="power-grid-stat-card">
            <span className="pgstat-label">MESSAGES</span>
            <span className="pgstat-val">{totalMessages.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
