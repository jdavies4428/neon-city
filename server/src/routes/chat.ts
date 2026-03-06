import { spawn } from "child_process";
import { existsSync } from "fs";
import { Router } from "express";
import type { RouteContext } from "./context.js";

export function registerChatRoutes(ctx: RouteContext) {
  const router = Router();
  let neonChatSessionId: string | null = null;
  const defaultProjectLabel = ctx.sessionService.friendlyProjectName(process.cwd());

  router.post("/send", async (req, res) => {
    const { message, sessionId, projectPath } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const targetSessionId = sessionId || neonChatSessionId;
    const agent = targetSessionId ? ctx.runtime.agents.get(targetSessionId) : undefined;
    const project = targetSessionId ? await ctx.sessionService.findSessionProject(targetSessionId) : null;
    const workspacePath = typeof projectPath === "string" ? projectPath : undefined;

    let discoveredProjectPath: string | null = null;
    if (targetSessionId) {
      for (const [, discovered] of ctx.sessionService.discoveredSessions) {
        if (discovered.sessionId === targetSessionId && discovered.projectPath) {
          discoveredProjectPath = discovered.projectPath;
          break;
        }
      }
    }

    const workspaceLabel = workspacePath
      ? ctx.sessionService.friendlyProjectName(workspacePath)
      : defaultProjectLabel;
    const sessionLabel = targetSessionId
      ? `${agent ? agent.displayName : "Claude"}${project ? ` — ${project.projectName}` : ""}`
      : `Neon City — ${workspaceLabel}`;

    const userMsg = ctx.runtime.pushChatMessage({
      role: "user",
      content: message,
      sessionId: targetSessionId || "neon-chat",
      sessionLabel,
      timestamp: Date.now(),
    });

    const args: string[] = [];
    if (targetSessionId) {
      args.push("--resume", targetSessionId);
    }
    args.push("-p", message);

    const spawnCwd = discoveredProjectPath && existsSync(discoveredProjectPath)
      ? discoveredProjectPath
      : project?.projectPath && existsSync(project.projectPath)
        ? project.projectPath
        : workspacePath && existsSync(workspacePath)
          ? workspacePath
          : undefined;

    try {
      const child = spawn("claude", args, {
        cwd: spawnCwd,
        env: ctx.cleanEnvForClaude(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      let stderr = "";
      let stdout = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

      child.on("close", (code) => {
        if (code && code !== 0 && stderr) {
          console.error(`[chat] claude exited ${code}: ${stderr.slice(0, 200)}`);
        }

        const content = stdout.trim() || stderr.trim() || `(exited with code ${code})`;
        if (!targetSessionId || !ctx.runtime.chatWatchers.has(targetSessionId)) {
          ctx.runtime.pushChatMessage({
            role: "assistant",
            content,
            agentName: agent?.displayName || "Claude",
            sessionId: targetSessionId || "neon-chat",
            sessionLabel,
            timestamp: Date.now(),
          });
        }
      });

      setTimeout(() => {
        if (child.exitCode !== null && child.exitCode !== 0) {
          ctx.runtime.pushChatMessage({
            role: "assistant",
            content: `(Error: ${stderr.trim() || `claude exited with code ${child.exitCode}`})`,
            agentName: "Claude",
            sessionId: targetSessionId || "neon-chat",
            sessionLabel,
            timestamp: Date.now(),
          });
        }
      }, 2000);

      child.unref();
      if (!targetSessionId && !neonChatSessionId) {
        neonChatSessionId = "neon-chat";
      }
      res.json({ ok: true, id: userMsg.id, mode: targetSessionId ? "session" : "chat" });
    } catch (err: any) {
      console.error("[chat] spawn error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/history", (_req, res) => {
    res.json({ messages: ctx.runtime.chatHistory.slice(-100) });
  });

  return router;
}
