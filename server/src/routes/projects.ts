import { mkdirSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { Router } from "express";
import { basename, extname, join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { resolveAccessiblePath } from "../project-access.js";
import type { RouteContext } from "./context.js";

export function registerProjectRoutes(ctx: RouteContext) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const claudeProjects = join(homedir(), ".claude", "projects");
      try {
        await stat(claudeProjects);
      } catch {
        return res.json({ projects: [] });
      }

      const projectDirs = await readdir(claudeProjects);
      const projects: Array<{ name: string; path: string; lastActivity: number }> = [];
      const seenPaths = new Set<string>();

      for (const dir of projectDirs) {
        const fullDir = join(claudeProjects, dir);
        try {
          const dirStat = await stat(fullDir);
          if (!dirStat.isDirectory()) continue;

          const decoded = await ctx.sessionService.resolveProjectPath(dir, fullDir);
          if (seenPaths.has(decoded)) continue;
          seenPaths.add(decoded);

          let lastActivity = dirStat.mtimeMs;
          try {
            const files = (await readdir(fullDir)).filter((file) => file.endsWith(".jsonl"));
            for (const file of files) {
              const fileStat = await stat(join(fullDir, file));
              if (fileStat.mtimeMs > lastActivity) lastActivity = fileStat.mtimeMs;
            }
          } catch {
            // ignore
          }

          projects.push({
            name: ctx.sessionService.friendlyProjectName(decoded),
            path: decoded,
            lastActivity,
          });
        } catch {
          continue;
        }
      }

      projects.sort((a, b) => b.lastActivity - a.lastActivity);
      res.json({ projects });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/create", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name required" });
    }

    const safeName = name.trim().replace(/[^a-zA-Z0-9\-_.]/g, "-").replace(/-+/g, "-");
    if (!safeName) return res.status(400).json({ error: "invalid name" });

    const projectDir = join(homedir(), "Projects", safeName);

    try {
      if (existsSync(projectDir)) {
        return res.json({ ok: true, path: projectDir, created: false });
      }
      mkdirSync(projectDir, { recursive: true });
      res.json({ ok: true, path: projectDir, created: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/tree", async (req, res) => {
    const targetPath = req.query.path as string;
    if (!targetPath) return res.status(400).json({ error: "path required" });

    const access = await resolveAccessiblePath(targetPath, "dir");
    if (!access.ok || !access.resolvedPath) {
      return res.status(access.status ?? 400).json({ error: access.error });
    }

    const ignored = new Set([
      ".git", "node_modules", ".next", "__pycache__", ".venv", "dist", "build",
      ".DS_Store", ".cache", ".turbo", ".svelte-kit", "coverage", ".nyc_output",
    ]);
    const maxEntries = 200;

    try {
      const dirents = await readdir(access.resolvedPath, { withFileTypes: true });
      const entries: Array<{ name: string; path: string; type: "file" | "dir"; size?: number }> = [];

      for (const entry of dirents) {
        if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
        if (entries.length >= maxEntries) break;

        const fullPath = join(access.resolvedPath, entry.name);
        const type = entry.isDirectory() ? "dir" as const : "file" as const;
        let size: number | undefined;
        if (type === "file") {
          try {
            size = (await stat(fullPath)).size;
          } catch {
            // skip size
          }
        }
        entries.push({ name: entry.name, path: fullPath, type, size });
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ entries });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "failed to read directory" });
    }
  });

  router.get("/file", async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path required" });

    const access = await resolveAccessiblePath(filePath, "file");
    if (!access.ok || !access.resolvedPath) {
      return res.status(access.status ?? 400).json({ error: access.error });
    }

    const resolved = access.resolvedPath;
    const ext = extname(resolved).toLowerCase();
    if (resolved.includes("/.git/") || resolved.includes("\\.git\\")) {
      return res.status(403).json({ error: "access denied" });
    }

    const allowed = new Set([
      ".md", ".prd", ".txt", ".json", ".yaml", ".yml", ".toml",
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
      ".css", ".html", ".svg", ".sh", ".sql", ".cfg", ".ini",
      ".gitignore", ".editorconfig", ".env.example",
    ]);

    const base = basename(resolved);
    const isAllowedNoExt = ["Makefile", "Dockerfile", "Procfile", "LICENSE", "Gemfile", "Rakefile"].includes(base);

    if (!allowed.has(ext) && !isAllowedNoExt) {
      return res.status(403).json({ error: `file type '${ext || "none"}' not allowed` });
    }
    if (base === ".env" || (base.startsWith(".env.") && !base.endsWith(".example"))) {
      return res.status(403).json({ error: "env files not allowed" });
    }

    try {
      const fileStat = await stat(resolved);
      if (fileStat.size > 500 * 1024) {
        return res.status(413).json({ error: "file too large", size: fileStat.size });
      }
      res.json({ content: await readFile(resolved, "utf-8"), extension: ext, size: fileStat.size });
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).json({ error: "file not found" });
      if (err.code === "EACCES") return res.status(403).json({ error: "permission denied" });
      res.status(500).json({ error: err.message || "failed to read file" });
    }
  });

  return router;
}
