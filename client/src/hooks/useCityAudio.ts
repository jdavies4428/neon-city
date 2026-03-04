import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CityAudioControls {
  /** Must be called on a user gesture (click) to init AudioContext */
  init: () => void;
  /** Whether audio is initialized */
  isInitialized: boolean;

  // Volume setters (0-1)
  setMasterVolume: (v: number) => void;
  setAmbientVolume: (v: number) => void;
  setWeatherVolume: (v: number) => void;
  setUiVolume: (v: number) => void;

  // Weather sounds
  setWeatherState: (state: string) => void;

  // UI feedback one-shots
  playNotificationChime: () => void;
  playPanelOpen: () => void;
  playPanelClose: () => void;
  playErrorAlert: () => void;

  // Agent activity sounds
  setAgentActivity: (hasWriting: boolean, hasReading: boolean) => void;

  // Volume values for UI display
  volumes: { master: number; ambient: number; weather: number; ui: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "neon-city-audio-volumes";

interface StoredVolumes {
  master: number;
  ambient: number;
  weather: number;
  ui: number;
}

function loadVolumes(): StoredVolumes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredVolumes>;
      return {
        master: parsed.master ?? 0.7,
        ambient: parsed.ambient ?? 0.5,
        weather: parsed.weather ?? 0.5,
        ui: parsed.ui ?? 0.5,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { master: 0.7, ambient: 0.5, weather: 0.5, ui: 0.5 };
}

function saveVolumes(v: StoredVolumes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Ignore write errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// White noise helper
// ─────────────────────────────────────────────────────────────────────────────

// Cached noise buffer — allocated once and reused across all white-noise nodes.
// Invalidated if the AudioContext sample rate ever differs (e.g. after a new
// AudioContext is created with a different device sample rate).
let cachedNoiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!cachedNoiseBuffer || cachedNoiseBuffer.sampleRate !== ctx.sampleRate) {
    const bufferSize = ctx.sampleRate * 2;
    cachedNoiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = cachedNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return cachedNoiseBuffer;
}

function createWhiteNoise(ctx: AudioContext): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  return source;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal audio engine (lives outside of React state — no re-renders)
// ─────────────────────────────────────────────────────────────────────────────

interface AudioEngine {
  ctx: AudioContext;

  // Gain nodes
  masterGain: GainNode;
  ambientGain: GainNode;
  weatherGain: GainNode;
  uiGain: GainNode;

  // Ambient layer nodes (running continuously)
  cityHumOsc: OscillatorNode | null;
  trafficNoise: AudioBufferSourceNode | null;
  trafficFilter: BiquadFilterNode | null;

  // Weather layer nodes
  weatherNoiseSource: AudioBufferSourceNode | null;
  weatherFilter: BiquadFilterNode | null;
  weatherGainNode: GainNode | null;
  thunderTimer: ReturnType<typeof setTimeout> | null;
  fogSweepInterval: ReturnType<typeof setInterval> | null;
  auroraOscs: OscillatorNode[];
  auroraTremoloOsc: OscillatorNode | null;
  auroraTremoloGain: GainNode | null;

  // Agent activity nodes
  writingInterval: ReturnType<typeof setInterval> | null;
  readingInterval: ReturnType<typeof setInterval> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCityAudio(): CityAudioControls {
  const [isInitialized, setIsInitialized] = useState(false);
  const [volumes, setVolumes] = useState<StoredVolumes>(loadVolumes);

  // Stable ref to the engine — never triggers re-renders
  const engineRef = useRef<AudioEngine | null>(null);
  // Track current weather so we can avoid redundant restarts
  const currentWeatherRef = useRef<string>("clear");
  // Track agent activity
  const agentActivityRef = useRef({ hasWriting: false, hasReading: false });

  // ── Ambient layer ──────────────────────────────────────────────────────────

  const startAmbient = useCallback((engine: AudioEngine) => {
    const { ctx, ambientGain } = engine;

    // City hum: 40Hz sawtooth at very low gain
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 40;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.01;
    hum.connect(humGain);
    humGain.connect(ambientGain);
    hum.start();
    engine.cityHumOsc = hum;

    // Traffic noise: white noise through bandpass
    const noise = createWhiteNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 0.5;
    const trafficGain = ctx.createGain();
    trafficGain.gain.value = 0.015;
    noise.connect(filter);
    filter.connect(trafficGain);
    trafficGain.connect(ambientGain);
    noise.start();
    engine.trafficNoise = noise;
    engine.trafficFilter = filter;
  }, []);

  // ── Weather layer ──────────────────────────────────────────────────────────

  const stopWeather = useCallback((engine: AudioEngine) => {
    if (engine.thunderTimer !== null) {
      clearTimeout(engine.thunderTimer);
      engine.thunderTimer = null;
    }
    if (engine.fogSweepInterval !== null) {
      clearInterval(engine.fogSweepInterval);
      engine.fogSweepInterval = null;
    }
    if (engine.weatherNoiseSource) {
      try { engine.weatherNoiseSource.stop(); } catch { /* already stopped */ }
      engine.weatherNoiseSource = null;
    }
    engine.weatherFilter = null;
    engine.weatherGainNode = null;
    for (const osc of engine.auroraOscs) {
      try { osc.stop(); } catch { /* ignore */ }
    }
    engine.auroraOscs = [];
    if (engine.auroraTremoloOsc) {
      try { engine.auroraTremoloOsc.stop(); } catch { /* ignore */ }
      engine.auroraTremoloOsc = null;
    }
    engine.auroraTremoloGain = null;
  }, []);

  const scheduleThunder = useCallback((engine: AudioEngine) => {
    const delay = 5000 + Math.random() * 10_000; // 5–15 s
    engine.thunderTimer = setTimeout(() => {
      if (!engineRef.current || currentWeatherRef.current !== "storm") return;
      const { ctx, weatherGain } = engine;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 30;
      const envGain = ctx.createGain();
      envGain.gain.setValueAtTime(0, ctx.currentTime);
      envGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.3);
      envGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3 + 0.5);
      osc.connect(envGain);
      envGain.connect(weatherGain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3 + 0.5 + 0.05);
      // Schedule next thunder
      scheduleThunder(engine);
    }, delay);
  }, []);

  const startWeather = useCallback(
    (engine: AudioEngine, state: string) => {
      stopWeather(engine);
      const { ctx, weatherGain } = engine;

      if (state === "rain" || state === "storm") {
        const noise = createWhiteNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 1000;
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.03;
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(weatherGain);
        noise.start();
        engine.weatherNoiseSource = noise;
        engine.weatherFilter = filter;
        engine.weatherGainNode = gainNode;

        if (state === "storm") {
          scheduleThunder(engine);
        }
      } else if (state === "snow") {
        const noise = createWhiteNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 200;
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.008;
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(weatherGain);
        noise.start();
        engine.weatherNoiseSource = noise;
        engine.weatherFilter = filter;
        engine.weatherGainNode = gainNode;
      } else if (state === "fog") {
        const noise = createWhiteNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 200;
        filter.Q.value = 1;
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.01;
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(weatherGain);
        noise.start();
        engine.weatherNoiseSource = noise;
        engine.weatherFilter = filter;
        engine.weatherGainNode = gainNode;

        // Sweep bandpass 200–800Hz over 4s, cycling
        let sweepUp = true;
        engine.fogSweepInterval = setInterval(() => {
          if (!engine.weatherFilter) return;
          const target = sweepUp ? 800 : 200;
          engine.weatherFilter.frequency.linearRampToValueAtTime(
            target,
            ctx.currentTime + 4
          );
          sweepUp = !sweepUp;
        }, 4000);
      } else if (state === "aurora") {
        // A-minor chord: 220Hz + 277Hz + 330Hz with slow tremolo
        const tremoloOsc = ctx.createOscillator();
        tremoloOsc.type = "sine";
        tremoloOsc.frequency.value = 0.25; // 0.25 Hz tremolo rate
        const tremoloGain = ctx.createGain();
        tremoloGain.gain.value = 0.003; // tremolo depth — subtle
        tremoloOsc.connect(tremoloGain);
        tremoloOsc.start();
        engine.auroraTremoloOsc = tremoloOsc;
        engine.auroraTremoloGain = tremoloGain;

        const freqs = [220, 277, 330];
        for (const freq of freqs) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = freq;
          const noteGain = ctx.createGain();
          noteGain.gain.value = 0.005;
          // Tremolo modulates this note's gain
          tremoloGain.connect(noteGain.gain);
          osc.connect(noteGain);
          noteGain.connect(weatherGain);
          osc.start();
          engine.auroraOscs.push(osc);
        }
      }
      // "clear", "sunny", or default: no weather sounds — stopWeather already called
    },
    [stopWeather, scheduleThunder]
  );

  // ── Init ──────────────────────────────────────────────────────────────────

  const init = useCallback(() => {
    if (engineRef.current) return; // already initialised

    const savedVolumes = loadVolumes();
    const ctx = new AudioContext();

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = savedVolumes.master;
    masterGain.connect(ctx.destination);

    // Sub-channel gains
    const ambientGain = ctx.createGain();
    ambientGain.gain.value = savedVolumes.ambient;
    ambientGain.connect(masterGain);

    const weatherGain = ctx.createGain();
    weatherGain.gain.value = savedVolumes.weather;
    weatherGain.connect(masterGain);

    const uiGain = ctx.createGain();
    uiGain.gain.value = savedVolumes.ui;
    uiGain.connect(masterGain);

    const engine: AudioEngine = {
      ctx,
      masterGain,
      ambientGain,
      weatherGain,
      uiGain,
      cityHumOsc: null,
      trafficNoise: null,
      trafficFilter: null,
      weatherNoiseSource: null,
      weatherFilter: null,
      weatherGainNode: null,
      thunderTimer: null,
      fogSweepInterval: null,
      auroraOscs: [],
      auroraTremoloOsc: null,
      auroraTremoloGain: null,
      writingInterval: null,
      readingInterval: null,
    };

    engineRef.current = engine;

    // Resume context if it started suspended
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    // Start ambient layer immediately
    startAmbient(engine);

    // Re-apply current weather if one was set before init
    const currentWeather = currentWeatherRef.current;
    if (currentWeather && currentWeather !== "clear" && currentWeather !== "sunny") {
      startWeather(engine, currentWeather);
    }

    // Re-apply agent activity if it was set before init
    const { hasWriting, hasReading } = agentActivityRef.current;
    if (hasWriting || hasReading) {
      applyAgentActivity(engine, hasWriting, hasReading);
    }

    setVolumes(savedVolumes);
    setIsInitialized(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAmbient, startWeather]);

  // ── Agent activity (internal helper, not a hook) ──────────────────────────

  function applyAgentActivity(
    engine: AudioEngine,
    hasWriting: boolean,
    hasReading: boolean
  ) {
    const { ctx } = engine;

    // Writing: rapid clicks 2kHz square wave 10ms on / 40ms off
    if (hasWriting && !engine.writingInterval) {
      engine.writingInterval = setInterval(() => {
        if (!engineRef.current) return;
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = 2000;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.015, ctx.currentTime);
        clickGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.01);
        osc.connect(clickGain);
        clickGain.connect(engine.uiGain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.012);
      }, 50); // 10ms on, ~40ms off at 50ms interval
    } else if (!hasWriting && engine.writingInterval !== null) {
      clearInterval(engine.writingInterval);
      engine.writingInterval = null;
    }

    // Reading: bandpass noise sweep 500→2000Hz over 200ms, every 2s
    if (hasReading && !engine.readingInterval) {
      engine.readingInterval = setInterval(() => {
        if (!engineRef.current) return;
        const noise = createWhiteNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(500, ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(2000, ctx.currentTime + 0.2);
        const readGain = ctx.createGain();
        readGain.gain.setValueAtTime(0.02, ctx.currentTime);
        readGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        noise.connect(filter);
        filter.connect(readGain);
        readGain.connect(engine.uiGain);
        noise.start(ctx.currentTime);
        noise.stop(ctx.currentTime + 0.22);
      }, 2000);
    } else if (!hasReading && engine.readingInterval !== null) {
      clearInterval(engine.readingInterval);
      engine.readingInterval = null;
    }
  }

  // ── Volume setters ─────────────────────────────────────────────────────────

  const setMasterVolume = useCallback((v: number) => {
    setVolumes((prev) => {
      const next = { ...prev, master: v };
      saveVolumes(next);
      if (engineRef.current) {
        engineRef.current.masterGain.gain.value = v;
      }
      return next;
    });
  }, []);

  const setAmbientVolume = useCallback((v: number) => {
    setVolumes((prev) => {
      const next = { ...prev, ambient: v };
      saveVolumes(next);
      if (engineRef.current) {
        engineRef.current.ambientGain.gain.value = v;
      }
      return next;
    });
  }, []);

  const setWeatherVolume = useCallback((v: number) => {
    setVolumes((prev) => {
      const next = { ...prev, weather: v };
      saveVolumes(next);
      if (engineRef.current) {
        engineRef.current.weatherGain.gain.value = v;
      }
      return next;
    });
  }, []);

  const setUiVolume = useCallback((v: number) => {
    setVolumes((prev) => {
      const next = { ...prev, ui: v };
      saveVolumes(next);
      if (engineRef.current) {
        engineRef.current.uiGain.gain.value = v;
      }
      return next;
    });
  }, []);

  // ── Weather state ──────────────────────────────────────────────────────────

  const setWeatherState = useCallback(
    (state: string) => {
      if (state === currentWeatherRef.current) return;
      currentWeatherRef.current = state;
      const engine = engineRef.current;
      if (!engine) return; // will be applied on init
      startWeather(engine, state);
    },
    [startWeather]
  );

  // ── UI one-shots ───────────────────────────────────────────────────────────

  const playNotificationChime = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { ctx, uiGain } = engine;
    // C5=523Hz, E5=659Hz, G5=784Hz, 80ms each
    const freqs = [523, 659, 784];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.08;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.08);
      osc.connect(g);
      g.connect(uiGain);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  }, []);

  const playPanelOpen = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { ctx, uiGain } = engine;
    const noise = createWhiteNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(500, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(4000, ctx.currentTime + 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
    noise.connect(filter);
    filter.connect(g);
    g.connect(uiGain);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.025);
  }, []);

  const playPanelClose = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { ctx, uiGain } = engine;
    const noise = createWhiteNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(4000, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
    noise.connect(filter);
    filter.connect(g);
    g.connect(uiGain);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.025);
  }, []);

  const playErrorAlert = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { ctx, uiGain } = engine;
    // Two 200Hz square wave tones, 100ms each with 50ms gap
    [0, 0.15].forEach((offset) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 200;
      const g = ctx.createGain();
      const t = ctx.currentTime + offset;
      g.gain.setValueAtTime(0.05, t);
      g.gain.linearRampToValueAtTime(0, t + 0.1);
      osc.connect(g);
      g.connect(uiGain);
      osc.start(t);
      osc.stop(t + 0.11);
    });
  }, []);

  // ── Agent activity ─────────────────────────────────────────────────────────

  const setAgentActivity = useCallback(
    (hasWriting: boolean, hasReading: boolean) => {
      const prev = agentActivityRef.current;
      if (prev.hasWriting === hasWriting && prev.hasReading === hasReading) return;
      agentActivityRef.current = { hasWriting, hasReading };
      const engine = engineRef.current;
      if (!engine) return;
      applyAgentActivity(engine, hasWriting, hasReading);
    },
    // applyAgentActivity is a plain function defined in this scope — stable
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.thunderTimer !== null) clearTimeout(engine.thunderTimer);
      if (engine.fogSweepInterval !== null) clearInterval(engine.fogSweepInterval);
      if (engine.writingInterval !== null) clearInterval(engine.writingInterval);
      if (engine.readingInterval !== null) clearInterval(engine.readingInterval);
      engine.ctx.close().catch(() => {});
      engineRef.current = null;
    };
  }, []);

  return {
    init,
    isInitialized,
    setMasterVolume,
    setAmbientVolume,
    setWeatherVolume,
    setUiVolume,
    setWeatherState,
    playNotificationChime,
    playPanelOpen,
    playPanelClose,
    playErrorAlert,
    setAgentActivity,
    volumes,
  };
}
