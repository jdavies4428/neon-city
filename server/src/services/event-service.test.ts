import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EventService } from "./event-service.js";
import { RuntimeState } from "./runtime-state.js";
import { SessionService } from "./session-service.js";
import { closeDb } from "../indexer/db.js";

describe("EventService", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    closeDb();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("persists and retrieves recent normalized events", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "neon-city-events-"));
    const runtime = new RuntimeState();
    const sessionService = new SessionService({ getSessionTitle: () => null } as any, runtime);
    const service = new EventService(tempRoot, runtime, sessionService);

    const event = service.ingest({
      eventType: "PermissionRequest",
      sessionId: "session-1",
      agentId: "session-session-1",
      agentKind: "session",
      projectPath: "/Users/jeffdai/Claude UI",
      toolName: "Bash",
      status: "pending",
      reason: "rm -rf",
      payload: { danger: true },
    });

    expect(event.projectName).toBe("Claude UI");

    const recent = service.recent({ limit: 10 });
    expect(recent.events).toHaveLength(1);
    expect(recent.total).toBe(1);
    expect(recent.hasMore).toBe(false);
    expect(recent.events[0]?.eventType).toBe("PermissionRequest");
    expect(recent.events[0]?.payload).toEqual({ danger: true });
  });

  it("filters and paginates recent events", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "neon-city-events-"));
    const runtime = new RuntimeState();
    const sessionService = new SessionService({ getSessionTitle: () => null } as any, runtime);
    const service = new EventService(tempRoot, runtime, sessionService);

    service.ingest({
      eventType: "PermissionRequest",
      projectPath: "/Users/jeffdai/Claude UI",
      payload: {},
    });
    service.ingest({
      eventType: "SessionStart",
      projectPath: "/Users/jeffdai/Other Project",
      payload: {},
    });
    service.ingest({
      eventType: "PostToolUseFailure",
      projectPath: "/Users/jeffdai/Claude UI",
      payload: {},
    });

    const approvals = service.recent({
      limit: 10,
      approvalOnly: true,
      projectPath: "/Users/jeffdai/Claude UI",
    });
    expect(approvals.events).toHaveLength(1);
    expect(approvals.events[0]?.eventType).toBe("PermissionRequest");

    const firstPage = service.recent({ limit: 1 });
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.total).toBe(3);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const paged = service.recent({
      limit: 1,
      beforeTimestamp: firstPage.nextCursor?.beforeTimestamp,
      beforeId: firstPage.nextCursor?.beforeId,
    });
    expect(paged.events).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(paged.events[0]?.id).not.toBe(firstPage.events[0]?.id);
  });
});
