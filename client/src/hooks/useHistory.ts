import { useState, useCallback } from "react";

export interface HistoryProject {
  id: number;
  path: string;
  name: string;
  session_count: number;
  last_indexed: number;
}

export interface HistorySession {
  id: string;
  title: string | null;
  message_count: number;
  first_message_at: number | null;
  last_message_at: number | null;
  project_name: string;
  project_path: string;
}

export interface HistoryMessage {
  id: number;
  role: string;
  content: string;
  timestamp: number | null;
  token_count: number;
  tool_name: string | null;
  file_path: string | null;
}

export interface SearchResult {
  id: number;
  session_id: string;
  role: string;
  snippet: string;
  timestamp: number | null;
  session_title: string | null;
  project_name: string;
}

export interface HistoryPlan {
  id: number;
  title: string;
  content: string;
  created_at: number;
  file_path: string;
  project_name?: string;
}

export interface HistoryEvent {
  id: string;
  timestamp: number;
  eventType: string;
  sessionId?: string;
  agentId?: string;
  agentKind?: string;
  agentType?: string;
  projectPath?: string;
  projectName?: string;
  toolName?: string;
  toolUseId?: string;
  status?: string;
  reason?: string;
  payload: Record<string, unknown>;
}

export interface HistoryStats {
  projects: number;
  sessions: number;
  messages: number;
  plans: number;
}

interface FetchEventsOptions {
  eventType?: string;
  projectPath?: string;
  approvalOnly?: boolean;
  limit?: number;
  beforeTimestamp?: number;
  beforeId?: string;
}

interface EventCursor {
  beforeTimestamp: number;
  beforeId: string;
}

export function useHistory() {
  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [plans, setPlans] = useState<HistoryPlan[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsCursor, setEventsCursor] = useState<EventCursor | null>(null);
  const [activeEventQuery, setActiveEventQuery] = useState<FetchEventsOptions>({});
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(false);

  const matchesEventQuery = useCallback((event: HistoryEvent, query: FetchEventsOptions) => {
    if (query.approvalOnly && event.eventType !== "PermissionRequest") {
      return false;
    }
    if (query.eventType && event.eventType !== query.eventType) {
      return false;
    }
    if (query.projectPath && event.projectPath !== query.projectPath) {
      return false;
    }
    return true;
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/history/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {
      setProjects([]);
    }
  }, []);

  const fetchSessions = useCallback(async (projectId?: number) => {
    setLoading(true);
    try {
      const url = projectId
        ? `/api/history/sessions?project=${projectId}`
        : "/api/history/sessions";
      const res = await fetch(url);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSessionMessages = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/history/sessions/${sessionId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/history/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/history/plans");
      const data = await res.json();
      setPlans(data.plans || []);
    } catch {
      setPlans([]);
    }
  }, []);

  const fetchEvents = useCallback(async (options: FetchEventsOptions = {}) => {
    setLoading(true);
    setActiveEventQuery({
      eventType: options.eventType,
      projectPath: options.projectPath,
      approvalOnly: options.approvalOnly,
      limit: options.limit,
    });
    try {
      const params = new URLSearchParams({
        limit: String(options.limit ?? 25),
      });
      if (options.eventType) params.set("type", options.eventType);
      if (options.projectPath) params.set("projectPath", options.projectPath);
      if (options.approvalOnly) params.set("approvalOnly", "true");
      if (options.beforeTimestamp != null) params.set("beforeTimestamp", String(options.beforeTimestamp));
      if (options.beforeId) params.set("beforeId", options.beforeId);
      const res = await fetch(`/api/events/recent?${params.toString()}`);
      const data = await res.json();
      setEvents(data.events || []);
      setEventsTotal(data.total || 0);
      setEventsHasMore(Boolean(data.hasMore));
      setEventsCursor(data.nextCursor || null);
    } catch {
      setEvents([]);
      setEventsTotal(0);
      setEventsHasMore(false);
      setEventsCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const appendEventsPage = useCallback(async (options: FetchEventsOptions = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(options.limit ?? 25),
      });
      if (options.eventType) params.set("type", options.eventType);
      if (options.projectPath) params.set("projectPath", options.projectPath);
      if (options.approvalOnly) params.set("approvalOnly", "true");
      if (options.beforeTimestamp != null) params.set("beforeTimestamp", String(options.beforeTimestamp));
      if (options.beforeId) params.set("beforeId", options.beforeId);
      const res = await fetch(`/api/events/recent?${params.toString()}`);
      const data = await res.json();
      setEvents((prev) => {
        const seen = new Set(prev.map((event) => event.id));
        const next = Array.isArray(data.events) ? data.events.filter((event: HistoryEvent) => !seen.has(event.id)) : [];
        return [...prev, ...next];
      });
      setEventsTotal(data.total || 0);
      setEventsHasMore(Boolean(data.hasMore));
      setEventsCursor(data.nextCursor || null);
    } catch {
      setEventsHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const prependEvent = useCallback((event: HistoryEvent) => {
    if (!matchesEventQuery(event, activeEventQuery)) {
      return;
    }

    let inserted = false;
    setEvents((prev) => {
      if (prev.some((existing) => existing.id === event.id)) {
        return prev;
      }
      inserted = true;
      return [event, ...prev].slice(0, 100);
    });
    if (inserted) {
      setEventsTotal((prev) => prev + 1);
    }
  }, [activeEventQuery, matchesEventQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/history/stats");
      const data = await res.json();
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  return {
    projects, sessions, messages, searchResults, plans, events, eventsTotal, eventsHasMore, stats, loading,
    eventsCursor, fetchProjects, fetchSessions, fetchSessionMessages, search, fetchPlans, fetchEvents, appendEventsPage, fetchStats, prependEvent,
  };
}
