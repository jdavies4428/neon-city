import { Router } from "express";
import { basename } from "path";
import type { RouteContext } from "./context.js";

export function registerSessionRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const sessions = await ctx.sessionService.listSessionDirectories();
      res.json({ sessions: sessions.map((session) => ({
        ...session,
        projectName: basename(session.projectPath),
      })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/active", async (_req, res) => {
    try {
      const sessions = await ctx.sessionService.listActiveSessions();
      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
