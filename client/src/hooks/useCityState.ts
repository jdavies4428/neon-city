import { useEffect, useRef, useCallback } from "react";

export interface AgentState {
  agentId: string;
  displayName: string;
  source: "claude" | "cursor";
  isThinking: boolean;
  currentCommand?: string;
  toolInput?: string;
  lastActivity: number;
  status: "idle" | "reading" | "writing" | "thinking" | "stuck" | "walking";
  agentKind?: "session" | "subagent";
  agentType?: string;
  colorIndex?: number;
  model?: string;           // "claude-opus-4-6", "claude-sonnet-4-6", etc.
  sessionSource?: "startup" | "resume" | "clear" | "compact";
}

export interface WeatherInfo {
  state: string;
  reason: string;
  lastCheck: number;
}

interface CityState {
  agents: Map<string, AgentState>;
  weather: WeatherInfo;
  version: number;
}

// Raw WS message listener — receives every parsed message from the single
// shared WebSocket connection so other components don't need their own.
export type RawMessageListener = (msg: { type: string; data: any }) => void;

export function useCityState() {
  const stateRef = useRef<CityState>({
    agents: new Map(),
    weather: { state: "clear", reason: "Starting up", lastCheck: Date.now() },
    version: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(state: CityState) => void>>(new Set());
  // Secondary listener set for raw WS messages (chat, notifications, voice)
  const rawListenersRef = useRef<Set<RawMessageListener>>(new Set());

  const notify = useCallback(() => {
    stateRef.current.version++;
    for (const listener of listenersRef.current) {
      listener(stateRef.current);
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        // Dispatch to all raw listeners first (chat, notifications, voice)
        for (const listener of rawListenersRef.current) {
          listener(msg);
        }

        // Then handle city-state specific messages
        if (msg.type === "init") {
          stateRef.current.agents.clear();
          for (const agent of msg.data.agents) {
            stateRef.current.agents.set(agent.agentId, agent);
          }
          if (msg.data.weather) {
            stateRef.current.weather = msg.data.weather;
          }
          notify();

          // Immediately re-dispatch bundled stats so SessionStats and
          // PowerGridModal populate on connect rather than waiting up to
          // 10 seconds for the server's periodic broadcast.
          if (msg.data.stats && Object.keys(msg.data.stats).length > 0) {
            for (const listener of rawListenersRef.current) {
              listener({ type: "stats", data: msg.data.stats });
            }
          }
        } else if (msg.type === "thinking") {
          // Merge server agents (don't clear — preserves synthetic session- agents)
          const serverIds = new Set<string>();
          for (const agent of msg.data.agents) {
            serverIds.add(agent.agentId);
            stateRef.current.agents.set(agent.agentId, agent);
          }
          // Prune agents the server no longer reports, but keep synthetics & citizens
          for (const id of stateRef.current.agents.keys()) {
            if (!serverIds.has(id) && !id.startsWith("session-") && !id.startsWith("citizen-")) {
              stateRef.current.agents.delete(id);
            }
          }
          notify();
        } else if (msg.type === "activity") {
          const agent = msg.data.agent;
          if (agent) {
            stateRef.current.agents.set(agent.agentId, agent);
            notify();
          }
        } else if (msg.type === "agent-removed") {
          stateRef.current.agents.delete(msg.data.agentId);
          notify();
        } else if (msg.type === "weather") {
          stateRef.current.weather = msg.data;
          notify();
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [notify]);

  const subscribe = useCallback(
    (listener: (state: CityState) => void) => {
      listenersRef.current.add(listener);
      listener(stateRef.current);
      return () => { listenersRef.current.delete(listener); };
    },
    []
  );

  // Subscribe to raw WS messages — used by NotificationCenter, ChatPanel,
  // and useVoice so they share the single connection instead of opening their own.
  const subscribeToMessages = useCallback(
    (listener: RawMessageListener) => {
      rawListenersRef.current.add(listener);
      return () => { rawListenersRef.current.delete(listener); };
    },
    []
  );

  return { stateRef, subscribe, subscribeToMessages, notify };
}
