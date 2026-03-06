import type Database from "better-sqlite3";
import { getDb } from "../indexer/db.js";
import type { EventIngestPayload, EventRecord, EventType } from "../types.js";
import type { RuntimeState } from "./runtime-state.js";
import type { SessionService } from "./session-service.js";

const ALLOWED_EVENT_TYPES = new Set<EventType>([
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "PermissionRequest",
  "PostToolUseFailure",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "PreCompact",
]);

export class EventService {
  private readonly db: Database.Database;
  private counter = 0;

  constructor(
    dataDir: string,
    private readonly runtime: RuntimeState,
    private readonly sessionService: SessionService
  ) {
    this.db = getDb(dataDir);
  }

  ingest(input: EventIngestPayload): EventRecord {
    if (!ALLOWED_EVENT_TYPES.has(input.eventType)) {
      throw new Error(`Unsupported event type: ${input.eventType}`);
    }

    const timestamp = input.timestamp ?? Date.now();
    const payload = input.payload ?? {};
    const projectPath = input.projectPath ?? this.deriveProjectPath(input);
    const projectName = input.projectName
      ?? (projectPath ? this.sessionService.friendlyProjectName(projectPath) : undefined);

    const event: EventRecord = {
      id: `evt-${timestamp}-${++this.counter}`,
      timestamp,
      eventType: input.eventType,
      sessionId: input.sessionId,
      agentId: input.agentId,
      agentKind: input.agentKind,
      agentType: input.agentType,
      projectPath,
      projectName,
      toolName: input.toolName,
      toolUseId: input.toolUseId,
      status: input.status,
      reason: input.reason,
      payload,
    };

    this.db.prepare(`
      INSERT INTO events (
        id, timestamp, event_type, session_id, agent_id, agent_kind, agent_type,
        project_path, project_name, tool_name, tool_use_id, status, reason, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.timestamp,
      event.eventType,
      event.sessionId ?? null,
      event.agentId ?? null,
      event.agentKind ?? null,
      event.agentType ?? null,
      event.projectPath ?? null,
      event.projectName ?? null,
      event.toolName ?? null,
      event.toolUseId ?? null,
      event.status ?? null,
      event.reason ?? null,
      JSON.stringify(event.payload)
    );

    this.runtime.broadcast("event", event);
    return event;
  }

  recent(options: {
    limit?: number;
    eventType?: string;
    projectPath?: string;
    approvalOnly?: boolean;
    beforeTimestamp?: number;
    beforeId?: string;
  } = {}) {
    const boundedLimit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (options.approvalOnly) {
      filters.push(`event_type = ?`);
      params.push("PermissionRequest");
    } else if (options.eventType) {
      filters.push(`event_type = ?`);
      params.push(options.eventType);
    }

    if (options.projectPath) {
      filters.push(`project_path = ?`);
      params.push(options.projectPath);
    }

    if (options.beforeTimestamp != null) {
      if (options.beforeId) {
        filters.push(`(timestamp < ? OR (timestamp = ? AND id < ?))`);
        params.push(options.beforeTimestamp, options.beforeTimestamp, options.beforeId);
      } else {
        filters.push(`timestamp < ?`);
        params.push(options.beforeTimestamp);
      }
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT * FROM events
      ${whereClause}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(...params, boundedLimit);

    const countFilters: string[] = [];
    const countParams: Array<string | number> = [];
    if (options.approvalOnly) {
      countFilters.push(`event_type = ?`);
      countParams.push("PermissionRequest");
    } else if (options.eventType) {
      countFilters.push(`event_type = ?`);
      countParams.push(options.eventType);
    }
    if (options.projectPath) {
      countFilters.push(`project_path = ?`);
      countParams.push(options.projectPath);
    }
    const countWhereClause = countFilters.length > 0 ? `WHERE ${countFilters.join(" AND ")}` : "";
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as total FROM events
      ${countWhereClause}
    `).get(...countParams) as { total: number };

    const mappedEvents = rows.map((row: any) => this.mapRow(row));
    const lastEvent = mappedEvents[mappedEvents.length - 1];

    return {
      events: mappedEvents,
      total: totalRow.total,
      limit: boundedLimit,
      hasMore: mappedEvents.length === boundedLimit,
      nextCursor: lastEvent
        ? {
            beforeTimestamp: lastEvent.timestamp,
            beforeId: lastEvent.id,
          }
        : null,
    };
  }

  private deriveProjectPath(input: EventIngestPayload) {
    if (input.sessionId) {
      const discovered = Array.from(this.sessionService.discoveredSessions.values()).find(
        (session) => session.sessionId === input.sessionId
      );
      if (discovered?.projectPath) {
        return discovered.projectPath;
      }
    }
    return undefined;
  }

  private mapRow(row: any): EventRecord {
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      sessionId: row.session_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      agentKind: row.agent_kind ?? undefined,
      agentType: row.agent_type ?? undefined,
      projectPath: row.project_path ?? undefined,
      projectName: row.project_name ?? undefined,
      toolName: row.tool_name ?? undefined,
      toolUseId: row.tool_use_id ?? undefined,
      status: row.status ?? undefined,
      reason: row.reason ?? undefined,
      payload: row.payload_json ? JSON.parse(row.payload_json) : {},
    };
  }
}
