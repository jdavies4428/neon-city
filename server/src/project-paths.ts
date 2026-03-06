import { createReadStream, existsSync } from "fs";
import { readdir } from "fs/promises";
import { createInterface } from "readline";

export function decodeClaudeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

async function readSessionCwd(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { cwd?: string };
        if (typeof entry.cwd === "string" && entry.cwd) {
          return entry.cwd;
        }
      } catch {
        // Ignore invalid JSONL lines.
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  return null;
}

export async function resolveClaudeProjectPath(dirName: string, dirPath: string): Promise<string> {
  const decodedPath = decodeClaudeProjectDir(dirName);
  if (existsSync(decodedPath)) {
    return decodedPath;
  }

  try {
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const cwd = await readSessionCwd(`${dirPath}/${entry}`);
      if (cwd) {
        return cwd;
      }
    }
  } catch {
    // Fall back to the legacy decoded path.
  }

  return decodedPath;
}
