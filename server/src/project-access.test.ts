import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolveAccessiblePath } from "./project-access.js";

describe("resolveAccessiblePath", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("allows files inside an approved root", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "neon-city-access-"));
    const filePath = join(tempRoot, "notes.md");
    await writeFile(filePath, "# hello");

    const result = await resolveAccessiblePath(filePath, "file", [tempRoot]);

    expect(result.ok).toBe(true);
    expect(result.resolvedPath).toBe(await realpath(filePath));
  });

  it("rejects paths outside approved roots", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "neon-city-access-"));
    const allowedRoot = join(tempRoot, "allowed");
    const blockedRoot = join(tempRoot, "blocked");
    await mkdir(allowedRoot);
    await mkdir(blockedRoot);
    const blockedFile = join(blockedRoot, "secret.md");
    await writeFile(blockedFile, "nope");

    const result = await resolveAccessiblePath(blockedFile, "file", [allowedRoot]);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});
