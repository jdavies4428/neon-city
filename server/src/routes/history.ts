import { Router } from "express";
import type { RouteContext } from "./context.js";

export function registerHistoryRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/projects", (_req, res) => {
    try {
      res.json({ projects: ctx.indexer.getProjects() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/sessions", (req, res) => {
    try {
      const projectId = req.query.project ? Number(req.query.project) : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      res.json({ sessions: ctx.indexer.getSessions(projectId, limit, offset) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/sessions/:id", (req, res) => {
    try {
      res.json({
        messages: ctx.indexer.getSessionMessages(req.params.id),
        fileChanges: ctx.indexer.getFileChanges(req.params.id),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/search", (req, res) => {
    try {
      const query = String(req.query.q || "");
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      res.json({ results: ctx.indexer.search(query, limit), query });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/plans", (req, res) => {
    try {
      const projectId = req.query.project ? Number(req.query.project) : undefined;
      res.json({ plans: ctx.indexer.getPlans(projectId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/todos", (_req, res) => {
    try {
      res.json({ todos: ctx.indexer.getTodos() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/stats", (_req, res) => {
    try {
      res.json(ctx.indexer.getStats());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/reindex", async (_req, res) => {
    try {
      await ctx.indexer.indexAll();
      res.json({ ok: true, stats: ctx.indexer.getStats() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
