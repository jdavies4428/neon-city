import type { RuntimeState } from "./runtime-state.js";
import type { WeatherInfo, WeatherState } from "../types.js";

export class WeatherService {
  private currentWeather: WeatherInfo = {
    state: "clear",
    reason: "Default — all clear",
    lastCheck: Date.now(),
  };
  private manualOverride = false;

  constructor(private readonly runtime: RuntimeState) {}

  getCurrentWeather() {
    return this.currentWeather;
  }

  setWeather(state: WeatherState, reason?: string) {
    this.manualOverride = true;
    this.currentWeather = {
      state,
      reason: reason || "Manual override",
      lastCheck: Date.now(),
    };
    this.runtime.broadcast("weather", this.currentWeather);
    return this.currentWeather;
  }

  computeWeather(): WeatherInfo {
    const now = Date.now();
    const agentList = Array.from(this.runtime.agents.values());

    if (agentList.length === 0) {
      return { state: "clear", reason: "No agents active", lastCheck: now };
    }

    const allIdle = agentList.every((agent) => agent.status === "idle" && !agent.waitingForApproval);
    if (allIdle) {
      return { state: "snow", reason: "All agents resting", lastCheck: now };
    }

    const stuckCount = agentList.filter((agent) => agent.status === "stuck" || agent.waitingForApproval).length;
    if (stuckCount > 0) {
      return {
        state: stuckCount >= 2 ? "storm" : "rain",
        reason: stuckCount >= 2 ? `${stuckCount} agents blocked` : "Agent needs approval",
        lastCheck: now,
      };
    }

    const writingCount = agentList.filter((agent) => agent.status === "writing").length;
    if (writingCount >= 3) {
      return {
        state: "aurora",
        reason: `${writingCount} agents writing — deploy in progress`,
        lastCheck: now,
      };
    }

    const thinkingCount = agentList.filter((agent) => agent.status === "thinking").length;
    if (thinkingCount >= 2) {
      return { state: "fog", reason: `${thinkingCount} agents thinking`, lastCheck: now };
    }

    return { state: "clear", reason: "Normal operations", lastCheck: now };
  }

  startAutoUpdates() {
    setInterval(() => {
      if (this.manualOverride) return;
      const previous = this.currentWeather.state;
      this.currentWeather = this.computeWeather();
      if (this.currentWeather.state !== previous) {
        this.runtime.broadcast("weather", this.currentWeather);
      }
    }, 3000);
  }
}
