import { Router } from "express";
import type { WeatherState } from "../types.js";
import type { RouteContext } from "./context.js";

export function registerWeatherRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.weatherService.getCurrentWeather());
  });

  router.post("/set", (req, res) => {
    const { state, reason } = req.body as { state?: WeatherState; reason?: string };
    const valid: WeatherState[] = ["clear", "sunny", "fog", "rain", "storm", "snow", "aurora"];
    if (!state || !valid.includes(state)) {
      return res.status(400).json({ error: "Invalid weather state" });
    }
    res.json(ctx.weatherService.setWeather(state, reason));
  });

  return router;
}
