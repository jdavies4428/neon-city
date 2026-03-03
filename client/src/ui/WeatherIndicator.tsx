import { useState, useRef, useEffect } from "react";

interface Props {
  weather: string;
  reason: string;
  onSetWeather?: (state: string) => void;
}

const WEATHER_OPTIONS: Array<{ id: string; icon: string; label: string; className: string }> = [
  { id: "clear", icon: "✦", label: "Clear Night", className: "weather-clear" },
  { id: "sunny", icon: "☀", label: "Sunny Day", className: "weather-sunny" },
  { id: "rain", icon: "⛆", label: "Rain", className: "weather-rain" },
  { id: "snow", icon: "❄", label: "Snow", className: "weather-snow" },
  { id: "storm", icon: "⚡", label: "Storm", className: "weather-storm" },
  { id: "fog", icon: "≋", label: "Fog", className: "weather-fog" },
  { id: "aurora", icon: "◈", label: "Aurora", className: "weather-aurora" },
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
      body: JSON.stringify({ state: id === "sunny" ? "clear" : id, reason: "Manual override" }),
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
