import { useState, useRef, useEffect } from "react";

interface Props {
  weather: string;
  reason: string;
  onSetWeather?: (state: string) => void;
}

const WEATHER_DESCRIPTIONS: Record<string, string> = {
  clear: "All quiet — no active agents",
  sunny: "Bright and clear — manual override",
  snow: "Light activity — agents warming up",
  fog: "Deep idle — city resting",
  aurora: "High productivity — agents in flow",
  rain: "Blocked — an agent needs approval",
  storm: "Multiple agents stuck — check alerts",
};

const WEATHER_OPTIONS: Array<{ id: string; icon: string; label: string; className: string }> = [
  { id: "clear", icon: "🌙", label: "Clear Night", className: "weather-clear" },
  { id: "sunny", icon: "☀", label: "Sunny Day", className: "weather-sunny" },
];

export function WeatherIndicator({ weather, reason, onSetWeather }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = WEATHER_OPTIONS.find((o) => o.id === weather) || WEATHER_OPTIONS[0];

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleSelect = (id: string) => {
    setMenuOpen(false);
    onSetWeather?.(id);
    // Also POST to server for immediate effect
    fetch("/api/weather/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: id, reason: "Manual override" }),
    }).catch(() => {});
  };

  return (
    <div className="weather-picker-wrap" ref={menuRef}>
      <button
        className={`weather-indicator ${current.className}`}
        title={reason}
        onClick={() => setMenuOpen((p) => !p)}
      >
        <span className="weather-icon">{current.icon}</span>
        <span className="weather-label">{current.label}</span>
        <span style={{ fontSize: "9px", color: "var(--text-dim)", opacity: 0.7 }}>
          {WEATHER_DESCRIPTIONS[current.id] ?? ""}
        </span>
        <span className="weather-chevron">{menuOpen ? "▴" : "▾"}</span>
      </button>

      {menuOpen && (
        <div className="weather-menu">
          {WEATHER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`weather-menu-item ${opt.className} ${opt.id === weather ? "active" : ""}`}
              onClick={() => handleSelect(opt.id)}
            >
              <span className="weather-menu-icon">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
