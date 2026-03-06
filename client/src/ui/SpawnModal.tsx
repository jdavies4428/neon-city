import { useState, useRef, useEffect } from "react";
import type { WorkspaceTarget } from "../shared/contracts";

interface Props {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  initialProjectPath?: string;
  currentWorkspace: WorkspaceTarget | null;
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

interface AgentTemplate {
  label: string;
  prompt: string;
}

const AGENT_TEMPLATES: Record<string, AgentTemplate[]> = {
  "general-purpose": [
    { label: "Explain this codebase", prompt: "Explore and explain the structure of this codebase. What does it do, what technologies does it use, and how is it organized?" },
    { label: "Fix an issue", prompt: "I'm having an issue with: [describe the problem]. Please investigate and fix it." },
    { label: "Add a feature", prompt: "I'd like to add a new feature: [describe what you want]. Please plan and implement it." },
  ],
  "frontend-developer": [
    { label: "Add a new page", prompt: "Create a new page/route for: [describe the page]. Match the existing design patterns." },
    { label: "Fix the styling", prompt: "The styling is broken on: [describe what looks wrong]. Please fix it to match the expected design." },
    { label: "Make it responsive", prompt: "Make the [component/page] responsive for mobile, tablet, and desktop viewports." },
    { label: "Add a component", prompt: "Create a new reusable component for: [describe the component]. Include proper props and styling." },
  ],
  "backend-developer": [
    { label: "Add an API endpoint", prompt: "Create a new API endpoint for: [describe what it should do]. Include validation and error handling." },
    { label: "Fix a server bug", prompt: "There's a bug in the backend: [describe the issue]. Please investigate and fix it." },
    { label: "Add database migration", prompt: "Create a database migration to: [describe schema changes needed]." },
  ],
  "debugger": [
    { label: "Fix this error", prompt: "I'm getting this error: [paste the error message]. Please find the root cause and fix it." },
    { label: "App crashes when...", prompt: "The app crashes when I try to: [describe the action]. Please debug and fix it." },
    { label: "Performance issue", prompt: "The app is running slowly when: [describe when]. Please profile and optimize." },
  ],
  "code-reviewer": [
    { label: "Review latest changes", prompt: "Review all recent code changes in this project. Check for bugs, security issues, and code quality." },
    { label: "Security review", prompt: "Perform a security-focused code review. Look for vulnerabilities, injection risks, and auth issues." },
    { label: "Best practices audit", prompt: "Audit this codebase for best practices. Check patterns, naming, error handling, and test coverage." },
  ],
  "ui-designer": [
    { label: "Improve the design", prompt: "Review the current UI design and suggest improvements for better UX, accessibility, and visual appeal." },
    { label: "Create a design system", prompt: "Create a consistent design system with colors, typography, spacing, and component styles." },
    { label: "Dark mode support", prompt: "Add dark mode / theme support to the existing UI components." },
  ],
  "data-analyst": [
    { label: "Analyze this data", prompt: "Analyze the data in [file/database] and provide insights, trends, and visualizations." },
    { label: "Create a dashboard", prompt: "Create a dashboard showing key metrics for: [describe what you want to track]." },
  ],
  "database-administrator": [
    { label: "Optimize queries", prompt: "Review and optimize the database queries in this project for better performance." },
    { label: "Design schema", prompt: "Design a database schema for: [describe the data model needed]." },
  ],
  "ai-engineer": [
    { label: "Add AI features", prompt: "Integrate AI/ML capabilities into this project for: [describe the AI feature]." },
    { label: "Optimize prompts", prompt: "Review and optimize the AI prompts in this codebase for better quality and cost efficiency." },
  ],
  "security-engineer": [
    { label: "Harden the app", prompt: "Review and harden the security of this application. Add missing security controls." },
    { label: "Add authentication", prompt: "Implement authentication and authorization for this application." },
  ],
  "project-manager": [
    { label: "Create a project plan", prompt: "Analyze this codebase and create a project plan for: [describe the goal]. Include milestones and tasks." },
    { label: "Assess technical debt", prompt: "Assess the technical debt in this project and prioritize what should be addressed first." },
  ],
};

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

export function SpawnModal({ open, onClose, initialPrompt, initialProjectPath, currentWorkspace }: Props) {
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
      setSelectedProjectPath(initialProjectPath || currentWorkspace?.projectPath || "");
      setResult(null);
      setSpawning(false);
      if (!initialPrompt) {
        setSelectedAgentType("general-purpose");
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, initialPrompt, initialProjectPath, currentWorkspace]);

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
          {currentWorkspace && (
            <div className="spawn-workspace-hint">
              Current workspace: <strong>{currentWorkspace.projectName}</strong>
            </div>
          )}
          <div className="spawn-select-wrap">
            <select
              name="spawn-project"
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

          {/* Task templates */}
          {selectedAgentType && AGENT_TEMPLATES[selectedAgentType] && (
            <div className="spawn-templates">
              <div className="spawn-templates-label">QUICK START</div>
              <div className="spawn-templates-grid">
                {AGENT_TEMPLATES[selectedAgentType].map((tmpl, i) => (
                  <button
                    key={i}
                    className="spawn-template-btn"
                    onClick={() => {
                      setPrompt(tmpl.prompt);
                      inputRef.current?.focus();
                    }}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Task textarea */}
          <label className="spawn-label">Task</label>
          <textarea
            ref={inputRef}
            name="spawn-task"
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
