import type { Indexer } from "../indexer/indexer.js";
import type { SessionService } from "../services/session-service.js";
import type { EventService } from "../services/event-service.js";
import type { RuntimeState } from "../services/runtime-state.js";
import type { WeatherService } from "../services/weather-service.js";

export interface RouteContext {
  indexer: Indexer;
  runtime: RuntimeState;
  sessionService: SessionService;
  eventService: EventService;
  weatherService: WeatherService;
  cleanEnvForClaude: () => NodeJS.ProcessEnv;
  agentTypeFriendlyName: (agentType: string) => string;
}
