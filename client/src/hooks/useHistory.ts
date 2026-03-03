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

export interface HistoryStats {
  projects: number;
  sessions: number;
  messages: number;
  plans: number;
}

export function useHistory() {
  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [plans, setPlans] = useState<HistoryPlan[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(false);

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
    projects, sessions, messages, searchResults, plans, stats, loading,
    fetchProjects, fetchSessions, fetchSessionMessages, search, fetchPlans, fetchStats,
  };
}
