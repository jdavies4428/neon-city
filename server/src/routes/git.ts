import { execFileSync, spawn } from "child_process";
import { Router } from "express";
import { resolveAccessiblePath } from "../project-access.js";
import type { AgentState } from "../types.js";
import type { RouteContext } from "./context.js";

export function registerGitRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/status", async (req, res) => {
    const projectPath = req.query.path as string;
    if (!projectPath) return res.status(400).json({ error: "path required" });

    const access = await resolveAccessiblePath(projectPath, "dir");
    if (!access.ok || !access.resolvedPath) {
      return res.status(access.status ?? 400).json({ error: access.error });
    }

    try {
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: access.resolvedPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const statusOutput = execFileSync("git", ["status", "--porcelain"], {
        cwd: access.resolvedPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const files = statusOutput
        ? statusOutput.split("\n").map((line: string) => ({
            status: line.substring(0, 2).trim(),
            file: line.substring(3),
          }))
        : [];

      let ahead = 0;
      let behind = 0;
      try {
        const counts = execFileSync("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], {
          cwd: access.resolvedPath,
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        const [a, b] = counts.split("\t");
        ahead = parseInt(a, 10);
        behind = parseInt(b, 10);
      } catch {
        // no upstream
      }

      res.json({ branch, files, dirty: files.length > 0, ahead, behind, fileCount: files.length });
    } catch {
      res.json({ branch: null, files: [], dirty: false, ahead: 0, behind: 0, fileCount: 0, error: "Not a git repo" });
    }
  });

  router.post("/action", async (req, res) => {
    const projectPath = req.query.path as string;
    const action = req.query.action as string;
    const { message } = req.body;
    if (!projectPath || !action) {
      return res.status(400).json({ error: "path and action required" });
    }

    const access = await resolveAccessiblePath(projectPath, "dir");
    if (!access.ok || !access.resolvedPath) {
      return res.status(access.status ?? 400).json({ error: access.error });
    }

    const prompts: Record<string, string> = {
      commit: `In the project at ${access.resolvedPath}, review all changes with git diff and git status, then create a well-described commit. ${message || ""}`,
      push: `In the project at ${access.resolvedPath}, push the current branch to the remote. ${message || ""}`,
      pr: `In the project at ${access.resolvedPath}, create a pull request for the current branch. ${message || ""}`,
      pull: `In the project at ${access.resolvedPath}, pull the latest changes from the remote. ${message || ""}`,
    };

    if (!prompts[action]) {
      return res.status(400).json({ error: "Invalid action. Use: commit, push, pr, pull" });
    }

    const spawnId = `git-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentState: AgentState = {
      agentId: spawnId,
      displayName: `Git ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      source: "claude",
      isThinking: true,
      currentCommand: undefined,
      toolInput: undefined,
      lastActivity: Date.now(),
      status: "thinking",
      waitingForApproval: false,
      agentKind: "subagent",
      agentType: "general-purpose",
      spawnId,
    };
    ctx.runtime.agents.set(spawnId, agentState);
    ctx.runtime.broadcast("activity", { agent: agentState });

    try {
      const child = spawn("claude", ["-p", prompts[action]], {
        cwd: access.resolvedPath,
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
        prompt: prompts[action].slice(0, 100),
        projectPath: access.resolvedPath,
        agentType: "general-purpose",
      });

      res.json({ ok: true, spawnId });
    } catch (err: any) {
      ctx.runtime.agents.delete(spawnId);
      ctx.runtime.broadcast("agent-removed", { agentId: spawnId });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
