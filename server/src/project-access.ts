import { homedir } from "os";
import { resolve } from "path";
import { realpath, stat } from "fs/promises";

const DEFAULT_ALLOWED_ROOTS = Array.from(new Set([
  homedir(),
  process.cwd(),
]));

export interface AccessCheckResult {
  ok: boolean;
  resolvedPath?: string;
  error?: string;
  status?: number;
}

function normalizePath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export async function resolveAccessiblePath(
  inputPath: string,
  expectedType: "file" | "dir",
  allowedRoots = DEFAULT_ALLOWED_ROOTS
): Promise<AccessCheckResult> {
  if (!inputPath) {
    return { ok: false, error: "path required", status: 400 };
  }

  const absolutePath = resolve(inputPath);

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(absolutePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { ok: false, error: "path not found", status: 404 };
    }
    return { ok: false, error: "failed to resolve path", status: 400 };
  }

  const canonicalRoots = (
    await Promise.all(
      allowedRoots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return resolve(root);
        }
      })
    )
  ).filter(Boolean);

  if (!canonicalRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return { ok: false, error: "path outside allowed roots", status: 403 };
  }

  try {
    const st = await stat(resolvedPath);
    if (expectedType === "dir" && !st.isDirectory()) {
      return { ok: false, error: "not a directory", status: 400 };
    }
    if (expectedType === "file" && !st.isFile()) {
      return { ok: false, error: "not a file", status: 400 };
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { ok: false, error: "path not found", status: 404 };
    }
    return { ok: false, error: "failed to stat path", status: 400 };
  }

  return { ok: true, resolvedPath };
}
