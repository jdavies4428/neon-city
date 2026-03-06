import { Router } from "express";
import type { EventIngestPayload } from "../types.js";
import type { RouteContext } from "./context.js";

export function registerEventRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/recent", (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const eventType = typeof req.query.type === "string" ? req.query.type : undefined;
      const projectPath = typeof req.query.projectPath === "string" ? req.query.projectPath : undefined;
      const approvalOnly = req.query.approvalOnly === "true";
      const beforeTimestamp = typeof req.query.beforeTimestamp === "string"
        ? Number(req.query.beforeTimestamp)
        : undefined;
      const beforeId = typeof req.query.beforeId === "string" ? req.query.beforeId : undefined;
      res.json(ctx.eventService.recent({
        limit,
        eventType,
        projectPath,
        approvalOnly,
        beforeTimestamp: Number.isFinite(beforeTimestamp) ? beforeTimestamp : undefined,
        beforeId,
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/ingest", (req, res) => {
    try {
      const body = req.body as EventIngestPayload;
      if (!body?.eventType) {
        return res.status(400).json({ error: "eventType required" });
      }
      const event = ctx.eventService.ingest(body);
      res.json({ ok: true, event });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
