import { spawn } from "child_process";
import { Router } from "express";
import type { AgentState } from "../types.js";
import type { RouteContext } from "./context.js";

export function registerSpawnRoutes(ctx: RouteContext) {
  const router = Router();

  router.post("/", (req, res) => {
    const { prompt, projectPath, agentType } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentState: AgentState = {
      agentId: spawnId,
      displayName: agentType ? ctx.agentTypeFriendlyName(agentType) : "Subagent",
      source: "claude",
      isThinking: true,
      currentCommand: undefined,
      toolInput: undefined,
      lastActivity: Date.now(),
      status: "thinking",
      waitingForApproval: false,
      agentKind: "subagent",
      agentType: agentType || undefined,
      spawnId,
    };

    ctx.runtime.agents.set(spawnId, agentState);
    ctx.runtime.broadcast("activity", { agent: agentState });

    try {
      const child = spawn("claude", ["-p", prompt], {
        cwd: projectPath || process.cwd(),
        env: ctx.cleanEnvForClaude(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const agent = ctx.runtime.agents.get(spawnId);
        if (agent) agent.lastActivity = Date.now();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      child.on("close", (code) => {
        ctx.runtime.spawnedProcesses.delete(spawnId);
        const agent = ctx.runtime.agents.get(spawnId);
        if (agent) {
          agent.status = "idle";
          agent.isThinking = false;
          agent.currentCommand = undefined;
          agent.toolInput = undefined;
          agent.lastActivity = Date.now();
          ctx.runtime.broadcastThrottled("activity", { agent });

          setTimeout(() => {
            ctx.runtime.agents.delete(spawnId);
            ctx.runtime.broadcast("agent-removed", { agentId: spawnId });
            for (const [sessionId, mappedSpawnId] of ctx.runtime.sessionToSpawnId) {
              if (mappedSpawnId === spawnId) ctx.runtime.sessionToSpawnId.delete(sessionId);
            }
          }, 10_000);
        }

        ctx.runtime.broadcast("spawn-complete", { spawnId, code, output: output.slice(0, 2000) });
      });

      child.unref();
      ctx.runtime.spawnedProcesses.set(spawnId, child);
      ctx.runtime.broadcast("spawn-started", {
        spawnId,
        prompt: prompt.slice(0, 100),
        projectPath: projectPath || process.cwd(),
        agentType,
      });

      res.json({ ok: true, spawnId });
    } catch (err: any) {
      ctx.runtime.agents.delete(spawnId);
      ctx.runtime.broadcast("agent-removed", { agentId: spawnId });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/active", (_req, res) => {
    res.json({
      active: Array.from(ctx.runtime.spawnedProcesses.entries()).map(([id, process]) => ({
        spawnId: id,
        pid: process.pid,
      })),
    });
  });

  return router;
}
