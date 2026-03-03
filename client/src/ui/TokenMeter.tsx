import { useEffect, useState, useRef } from "react";

interface TokenData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  tokens24h: number;
  totalMessages: number;
}

export function TokenMeter() {
  const [data, setData] = useState<TokenData | null>(null);
  const prevTokensRef = useRef(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
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

          // Flash if tokens changed
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
  }, []);

  if (!data) return null;

  const { totalTokens, inputTokens, outputTokens, estimatedCost, tokens24h } = data;

  // Power level: 0-100 based on 24h token usage (1M tokens = 100%)
  const powerLevel = Math.min(100, Math.round((tokens24h / 1_000_000) * 100));

  // Segments for the power bar (10 segments)
  const segments = 10;
  const filledSegments = Math.ceil((powerLevel / 100) * segments);

  return (
    <div className={`token-meter ${flash ? "flash" : ""}`}>
      <div className="meter-header">
        <span className="meter-icon">⚡</span>
        <span className="meter-title">POWER GRID</span>
      </div>

      {/* Power bar visualization */}
      <div className="meter-bar">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={`meter-segment ${i < filledSegments ? "filled" : ""} ${
              i < filledSegments
                ? i < segments * 0.3
                  ? "low"
                  : i < segments * 0.7
                    ? "mid"
                    : "high"
                : ""
            }`}
          />
        ))}
      </div>

      <div className="meter-stats">
        <div className="meter-row">
          <span className="meter-label">Total</span>
          <span className="meter-val">{formatTokens(totalTokens)}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label input">IN</span>
          <span className="meter-val">{formatTokens(inputTokens)}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label output">OUT</span>
          <span className="meter-val">{formatTokens(outputTokens)}</span>
        </div>
        <div className="meter-row meter-cost-row">
          <span className="meter-label">Cost</span>
          <span className="meter-val cost">${estimatedCost.toFixed(2)}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label">24h</span>
          <span className="meter-val">{formatTokens(tokens24h)}</span>
        </div>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
