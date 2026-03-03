import { useCallback, useEffect, useRef, useState } from "react";
import type { RawMessageListener } from "./useCityState";

interface VoiceMessage {
  agentId: string;
  agentName: string;
  text: string;
  sentences: string[];
  voice: string;
}

interface VoiceState {
  speaking: boolean;
  currentSpeaker: string | null;
  currentText: string | null;
  sentenceIndex: number;
  sentenceCount: number;
  enabled: boolean;
  ttsReady: boolean;
}

interface UseVoiceOptions {
  // Shared WS message bus from useCityState — prevents opening a duplicate
  // WebSocket connection just for voice events.
  subscribeToMessages: (listener: RawMessageListener) => () => void;
}

export function useVoice({ subscribeToMessages }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>({
    speaking: false,
    currentSpeaker: null,
    currentText: null,
    sentenceIndex: 0,
    sentenceCount: 0,
    enabled: false, // Off by default — user enables via mute button
    ttsReady: false,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<VoiceMessage[]>([]);
  const playingRef = useRef(false);
  // enabledRef is the single source of truth for mute state — only updated
  // explicitly by toggleVoice and the voice-toggle WS handler. Never overwritten
  // by render-time inline assignment to avoid race conditions.
  const enabledRef = useRef(state.enabled);
  const recentTextsRef = useRef<Map<string, number>>(new Map());

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const fetchTTS = useCallback(
    async (text: string, voice: string, agentId: string): Promise<ArrayBuffer | null> => {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, agentId }),
        });
        if (!res.ok) return null;
        return await res.arrayBuffer();
      } catch {
        return null;
      }
    },
    []
  );

  const playBuffer = useCallback(
    (buffer: ArrayBuffer): Promise<void> => {
      return new Promise(async (resolve) => {
        try {
          const ctx = getAudioCtx();
          if (ctx.state === "suspended") await ctx.resume();
          const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => resolve();
          source.start(0);
          setTimeout(resolve, audioBuffer.duration * 1000 + 2000);
        } catch {
          resolve();
        }
      });
    },
    [getAudioCtx]
  );

  // Use a ref for processQueue so the message-bus subscription effect never
  // depends on it. Reassigning .current on every render keeps the closure
  // fresh (reads the latest fetchTTS / playBuffer) without triggering any
  // effect re-runs.
  const processQueueRef = useRef<() => void>(() => {});

  processQueueRef.current = async () => {
    if (playingRef.current) return;
    playingRef.current = true;

    while (queueRef.current.length > 0) {
      if (!enabledRef.current) break; // muted mid-playback — stop immediately

      const msg = queueRef.current.shift()!;
      const { sentences, voice, agentId, agentName } = msg;

      setState((s) => ({
        ...s,
        speaking: true,
        currentSpeaker: agentName,
        sentenceCount: sentences.length,
      }));

      for (let i = 0; i < sentences.length; i++) {
        if (!enabledRef.current) break; // muted — don't fetch more TTS

        setState((s) => ({
          ...s,
          sentenceIndex: i + 1,
          currentText: sentences[i],
        }));

        const audioData = await fetchTTS(sentences[i], voice, agentId);
        if (audioData && enabledRef.current) {
          await playBuffer(audioData);
        }
      }
    }

    setState((s) => ({
      ...s,
      speaking: false,
      currentSpeaker: null,
      currentText: null,
      sentenceIndex: 0,
      sentenceCount: 0,
    }));

    playingRef.current = false;
  };

  // Subscribe to voice events through the shared WS message bus.
  // No separate WebSocket is opened here.
  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (msg.type === "voice-message" && enabledRef.current) {
        // Deduplicate: skip if we received very similar text recently
        const key = `${msg.data.agentId}:${msg.data.text?.slice(0, 80)}`;
        const now = Date.now();
        const lastSeen = recentTextsRef.current.get(key);
        if (lastSeen && now - lastSeen < 15_000) return; // skip duplicate
        recentTextsRef.current.set(key, now);
        // Clean old entries
        for (const [k, t] of recentTextsRef.current) {
          if (now - t > 30_000) recentTextsRef.current.delete(k);
        }

        queueRef.current.push(msg.data);
        processQueueRef.current();
      }

      if (msg.type === "voice-toggle") {
        enabledRef.current = msg.data.enabled;
        setState((s) => ({ ...s, enabled: msg.data.enabled }));
      }
    });
  }, [subscribeToMessages]);

  // Fetch initial voice status once on mount.
  // Must update enabledRef.current in sync with state so the ref (the single
  // source of truth) matches the persisted server setting on first load.
  useEffect(() => {
    fetch("/api/voice/status")
      .then((r) => r.json())
      .then((d) => {
        enabledRef.current = d.enabled;
        setState((s) => ({
          ...s,
          enabled: d.enabled,
          ttsReady: d.ttsReady,
        }));
      })
      .catch(() => {});
  }, []);

  const toggleVoice = useCallback(async () => {
    try {
      // Optimistically disable the ref BEFORE the network round-trip so that
      // any in-flight processQueue iteration sees the muted state immediately
      // and does not start new TTS fetches while we wait for the server.
      const optimisticEnabled = !enabledRef.current;
      if (!optimisticEnabled) {
        enabledRef.current = false;
        // Stop all queued and in-flight audio right away
        queueRef.current.length = 0;
        playingRef.current = false;
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        setState((s) => ({
          ...s,
          enabled: false,
          speaking: false,
          currentSpeaker: null,
          currentText: null,
          sentenceIndex: 0,
          sentenceCount: 0,
        }));
      }

      const res = await fetch("/api/voice/toggle", { method: "POST" });
      const data = await res.json();

      // Reconcile with server truth in case the optimistic guess was wrong
      enabledRef.current = data.enabled;
      setState((s) => ({ ...s, enabled: data.enabled }));

      // If the server confirmed mute (and we did not already clean up above)
      if (!data.enabled && optimisticEnabled) {
        queueRef.current.length = 0;
        playingRef.current = false;
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        setState((s) => ({
          ...s,
          speaking: false,
          currentSpeaker: null,
          currentText: null,
          sentenceIndex: 0,
          sentenceCount: 0,
        }));
      }
    } catch {}
  }, []);

  // initAudio is called from ChatPanel on first user interaction.
  // Memoised with stable deps — identity never changes across renders.
  const initAudio = useCallback(async () => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }, [getAudioCtx]);

  // Return stable references for the callbacks. The state fields will change
  // when voice activity happens, which is the desired re-render trigger.
  return {
    speaking: state.speaking,
    currentSpeaker: state.currentSpeaker,
    currentText: state.currentText,
    sentenceIndex: state.sentenceIndex,
    sentenceCount: state.sentenceCount,
    enabled: state.enabled,
    ttsReady: state.ttsReady,
    toggleVoice,
    initAudio,
  };
}
