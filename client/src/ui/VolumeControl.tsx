import { useEffect, useRef, useState } from "react";
import type { CityAudioControls } from "../hooks/useCityAudio";

interface Props {
  controls: CityAudioControls;
}

interface SliderDef {
  label: string;
  key: keyof CityAudioControls["volumes"];
  setter: keyof Pick<
    CityAudioControls,
    "setMasterVolume" | "setAmbientVolume" | "setWeatherVolume" | "setUiVolume"
  >;
  color: string;
}

const SLIDERS: SliderDef[] = [
  { label: "Master", key: "master", setter: "setMasterVolume", color: "#40ddff" },
  { label: "Ambient", key: "ambient", setter: "setAmbientVolume", color: "#40ff80" },
  { label: "Weather", key: "weather", setter: "setWeatherVolume", color: "#4080ff" },
  { label: "UI", key: "ui", setter: "setUiVolume", color: "#ff40aa" },
];

export function VolumeControl({ controls }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const masterVol = controls.volumes.master;
  // Speaker icon changes based on master volume level
  const speakerIcon =
    masterVol === 0 ? "🔇" : masterVol < 0.35 ? "🔈" : masterVol < 0.7 ? "🔉" : "🔊";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="glass-btn"
        onClick={() => setOpen((p) => !p)}
        title={controls.isInitialized ? "Audio controls" : "Click to enable audio"}
        style={{
          padding: "7px 10px",
          fontSize: "14px",
          opacity: controls.isInitialized ? 1 : 0.55,
          borderColor: open ? "rgba(64,221,255,0.5)" : undefined,
        }}
      >
        <span style={{ lineHeight: 1 }}>{speakerIcon}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 220,
            background: "rgba(8, 8, 24, 0.97)",
            border: "1px solid rgba(80, 100, 200, 0.4)",
            borderRadius: 10,
            padding: "12px 14px",
            zIndex: 60,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(64,128,255,0.06)",
          }}
        >
          {/* Header */}
          <div
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 7,
              letterSpacing: "1.5px",
              color: "var(--neon-cyan)",
              textTransform: "uppercase",
              marginBottom: 12,
              opacity: 0.8,
            }}
          >
            Audio Mixer
          </div>

          {!controls.isInitialized && (
            <div
              style={{
                fontSize: 9,
                color: "var(--text-dim)",
                marginBottom: 10,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              Click anywhere on the city to enable audio.
            </div>
          )}

          {/* Sliders */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SLIDERS.map(({ label, key, setter, color }) => {
              const value = controls.volumes[key];
              const pct = Math.round(value * 100);
              return (
                <div key={key}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        letterSpacing: "0.5px",
                        textTransform: "uppercase",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                        color,
                        textShadow: `0 0 6px ${color}`,
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {pct}
                    </span>
                  </div>
                  <input
                    name={`volume-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      (controls[setter] as (v: number) => void)(v);
                    }}
                    style={{
                      width: "100%",
                      appearance: "none",
                      WebkitAppearance: "none",
                      height: 4,
                      borderRadius: 2,
                      background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, rgba(30,30,60,0.8) ${pct}%, rgba(30,30,60,0.8) 100%)`,
                      outline: "none",
                      cursor: "pointer",
                      border: "none",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Subtle footer hint */}
          <div
            style={{
              marginTop: 12,
              fontSize: 8,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              textAlign: "center",
              letterSpacing: "0.3px",
            }}
          >
            Volumes saved automatically
          </div>
        </div>
      )}

      {/* Slider thumb styles injected via a style tag to avoid needing CSS files */}
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #e8e8f0;
          cursor: pointer;
          box-shadow: 0 0 4px rgba(64,221,255,0.4);
          border: 1px solid rgba(80,100,200,0.5);
        }
        input[type=range]::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #e8e8f0;
          cursor: pointer;
          box-shadow: 0 0 4px rgba(64,221,255,0.4);
          border: 1px solid rgba(80,100,200,0.5);
        }
        input[type=range]:focus::-webkit-slider-thumb {
          box-shadow: 0 0 0 3px rgba(64,221,255,0.2);
        }
      `}</style>
    </div>
  );
}
