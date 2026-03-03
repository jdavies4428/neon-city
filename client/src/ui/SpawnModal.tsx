import { useState, useRef, useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  initialProjectPath?: string;
}

interface ProjectOption {
  label: string;
  projectPath: string;
}

interface AgentTypePreset {
  id: string;
  icon: string;
  name: string;
  desc: string;
  template: string;
}

const AGENT_TYPES: AgentTypePreset[] = [
  {
    id: "general-purpose",
    icon: "GP",
    name: "General",
    desc: "General-purpose agent for research, code search, and multi-step tasks",
    template: "Help me with the following task:\n\n",
  },
  {
    id: "frontend-developer",
    icon: "FE",
    name: "Frontend",
    desc: "Build frontend apps across React, Vue, and Angular with full-stack integration",
    template: "Build/update the frontend: ",
  },
  {
    id: "backend-developer",
    icon: "BE",
    name: "Backend",
    desc: "Build server-side APIs, microservices, and backend systems",
    template: "Build/update the backend: ",
  },
  {
    id: "ui-designer",
    icon: "UI",
    name: "UI Designer",
    desc: "Design visual interfaces, create design systems, and build component libraries",
    template: "Design or improve the UI for: ",
  },
  {
    id: "mobile-developer",
    icon: "MB",
    name: "Mobile",
    desc: "Build cross-platform mobile apps with React Native or Flutter",
    template: "Build/update the mobile app: ",
  },
  {
    id: "mobile-app-developer",
    icon: "MA",
    name: "Mobile App",
    desc: "Develop iOS and Android apps with native or cross-platform focus",
    template: "Develop the mobile application: ",
  },
  {
    id: "debugger",
    icon: "DB",
    name: "Debugger",
    desc: "Diagnose and fix bugs, identify root causes, analyze error logs",
    template: "Debug and fix: ",
  },
  {
    id: "code-reviewer",
    icon: "CR",
    name: "Code Review",
    desc: "Comprehensive code reviews focusing on quality, security, and best practices",
    template: "Review the code for issues, bugs, and improvements: ",
  },
  {
    id: "security-engineer",
    icon: "SE",
    name: "Security Eng",
    desc: "Implement security solutions, build automated controls, threat modeling",
    template: "Implement security for: ",
  },
  {
    id: "security-auditor",
    icon: "SA",
    name: "Security Audit",
    desc: "Conduct security audits, compliance assessments, and risk evaluations",
    template: "Audit security and compliance for: ",
  },
  {
    id: "data-analyst",
    icon: "DA",
    name: "Data Analyst",
    desc: "Extract insights from data, create dashboards, perform statistical analysis",
    template: "Analyze the data: ",
  },
  {
    id: "database-administrator",
    icon: "DBA",
    name: "Database Admin",
    desc: "Optimize database performance, high-availability, disaster recovery",
    template: "Optimize or manage the database: ",
  },
  {
    id: "ai-engineer",
    icon: "AI",
    name: "AI Engineer",
    desc: "Architect and implement AI systems, model pipelines, and deployment",
    template: "Build/optimize the AI system: ",
  },
  {
    id: "project-manager",
    icon: "PM",
    name: "Project Mgr",
    desc: "Establish project plans, track progress, manage risks and stakeholders",
    template: "Plan and manage the project: ",
  },
  {
    id: "business-analyst",
    icon: "BA",
    name: "Biz Analyst",
    desc: "Analyze business processes, gather requirements, identify improvements",
    template: "Analyze the business process: ",
  },
  {
    id: "seo-specialist",
    icon: "SEO",
    name: "SEO",
    desc: "Technical SEO audits, keyword strategy, content and rankings optimization",
    template: "Optimize SEO for: ",
  },
  {
    id: "content-marketer",
    icon: "CM",
    name: "Content Mktg",
    desc: "Develop content strategies, create SEO-optimized marketing content",
    template: "Create content strategy for: ",
  },
  {
    id: "multi-agent-coordinator",
    icon: "MC",
    name: "Coordinator",
    desc: "Coordinate multiple concurrent agents, synchronize work across systems",
    template: "Coordinate agents to: ",
  },
  {
    id: "explore",
    icon: "EX",
    name: "Explorer",
    desc: "Fast codebase exploration — find files, search code, answer architecture questions",
    template: "Explore the codebase and find: ",
  },
  {
    id: "plan",
    icon: "PL",
    name: "Planner",
    desc: "Software architect — design implementation plans and identify critical files",
    template: "Plan the implementation for: ",
  },
];

export function SpawnModal({ open, onClose, initialPrompt, initialProjectPath }: Props) {
  const [prompt, setPrompt] = useState("");
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedAgentType, setSelectedAgentType] = useState("general-purpose");
  const [spawning, setSpawning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch ALL known projects from ~/.claude/projects/
  useEffect(() => {
    if (!open) return;

    async function fetchProjects() {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const data = await res.json();
        const list: Array<{ name: string; path: string }> = data.projects ?? [];

        setProjects(list.map((p) => ({ label: p.name, projectPath: p.path })));
      } catch {
        // silently ignore — server may not be up yet
      }
    }

    fetchProjects();
  }, [open]);

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt || "");
      setSelectedProjectPath(initialProjectPath || "");
      setResult(null);
      setSpawning(false);
      if (!initialPrompt) {
        setSelectedAgentType("general-purpose");
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, initialPrompt, initialProjectPath]);

  function handleSelectAgentType(typeId: string) {
    setSelectedAgentType(typeId);
    const preset = AGENT_TYPES.find((t) => t.id === typeId);
    if (preset) {
      setPrompt(preset.template);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(
            inputRef.current.value.length,
            inputRef.current.value.length
          );
        }
      }, 50);
    }
  }

  const handleSpawn = async () => {
    if (!prompt.trim() || spawning) return;

    setSpawning(true);
    setResult(null);

    try {
      const res = await fetch("/api/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          projectPath: selectedProjectPath || undefined,
          agentType: selectedAgentType,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setResult("Agent summoned successfully");
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setResult(`Error: ${data.error}`);
        setSpawning(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setResult(`Failed: ${message}`);
      setSpawning(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="spawn-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="spawn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="spawn-header">
          <div>
            <span className="spawn-title">SUMMON AGENT</span>
            <span className="spawn-subtitle">Runs in background — no terminal needed</span>
          </div>
          <button className="panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="spawn-body">
          {/* Project selector */}
          <label className="spawn-label">Open Project</label>
          <div className="spawn-select-wrap">
            <select
              className="spawn-select"
              value={selectedProjectPath}
              onChange={(e) => setSelectedProjectPath(e.target.value)}
            >
              <option value="">Auto (server default)</option>
              {projects.map((p) => (
                <option key={p.projectPath} value={p.projectPath}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="spawn-select-arrow">v</span>
          </div>

          {/* Agent type grid */}
          <label className="spawn-label">Agent Type</label>
          <div className="spawn-agent-grid">
            {AGENT_TYPES.map((type) => (
              <button
                key={type.id}
                className={`spawn-agent-card ${selectedAgentType === type.id ? "selected" : ""}`}
                onClick={() => handleSelectAgentType(type.id)}
                title={type.desc}
              >
                <span className="spawn-agent-icon">{type.icon}</span>
                <span className="spawn-agent-name">{type.name}</span>
              </button>
            ))}
          </div>

          {/* Task textarea */}
          <label className="spawn-label">Task</label>
          <textarea
            ref={inputRef}
            className="spawn-input"
            placeholder="What should the agent work on?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSpawn();
              }
            }}
            rows={4}
          />

          {result && (
            <div
              className={`spawn-result ${
                result.startsWith("Error") || result.startsWith("Failed")
                  ? "error"
                  : "success"
              }`}
            >
              {result}
            </div>
          )}
        </div>

        <div className="spawn-footer">
          <span className="spawn-hint">Cmd+Enter to send</span>
          <button
            className="spawn-btn"
            onClick={handleSpawn}
            disabled={!prompt.trim() || spawning}
          >
            {spawning ? "Summoning..." : "Summon"}
          </button>
        </div>
      </div>
    </div>
  );
}
