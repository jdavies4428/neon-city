import React, { useMemo } from "react";

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: string;
  category: "git" | "session" | "info" | "project" | "prompt";
  requiresProject?: boolean;
  /** If true, command is a natural language prompt, not a slash command */
  isPrompt?: boolean;
}

// Real Claude Code slash commands
const COMMANDS: SlashCommand[] = [
  // --- Actual Claude Code skills/commands ---
  { command: "/commit",    label: "Commit",     description: "Stage and commit changes",           icon: "C",  category: "git",     requiresProject: true },
  { command: "/push",      label: "Push",       description: "Push commits to remote",             icon: "P",  category: "git",     requiresProject: true },
  { command: "/pr",        label: "PR",         description: "Create a pull request",              icon: "PR", category: "git",     requiresProject: true },
  { command: "/review-pr", label: "Review PR",  description: "Review an open pull request",        icon: "R",  category: "git",     requiresProject: true },
  { command: "/init",      label: "Init",       description: "Initialize Claude in a new project", icon: "I",  category: "project" },
  { command: "/help",      label: "Help",       description: "Show available commands",            icon: "?",  category: "info" },
  { command: "/clear",     label: "Clear",      description: "Clear conversation history",         icon: "X",  category: "session" },
  { command: "/compact",   label: "Compact",    description: "Summarize and compact context",      icon: "S",  category: "session" },
  { command: "/simplify",  label: "Simplify",   description: "Review and simplify changed code",   icon: "~",  category: "session" },
  { command: "/cost",      label: "Cost",       description: "Show token usage and costs",         icon: "$",  category: "info" },
  { command: "/status",    label: "Status",     description: "Show project and session status",    icon: "S",  category: "info" },
  // --- Quick prompts (sent as natural language, not slash commands) ---
  { command: "Review the recent code changes for issues and improvements", label: "Review", description: "Review code changes", icon: "RV", category: "prompt", requiresProject: true, isPrompt: true },
  { command: "Run the project tests and report results",                   label: "Test",   description: "Run project tests",   icon: "T",  category: "prompt", requiresProject: true, isPrompt: true },
  { command: "Find and fix bugs in this codebase",                         label: "Bugs",   description: "Find and fix bugs",   icon: "B",  category: "prompt", isPrompt: true },
  { command: "Show what's in memory and context for this session",         label: "Memory", description: "Show memory info",    icon: "M",  category: "prompt", isPrompt: true },
];

interface CommandChipsProps {
  onSelect: (command: string) => void;
  hasActiveProject: boolean;
}

export const CommandChips: React.FC<CommandChipsProps> = ({ onSelect, hasActiveProject }) => {
  const slashCommands = COMMANDS.filter(
    (cmd) => !cmd.isPrompt && (!cmd.requiresProject || hasActiveProject)
  );
  const promptCommands = COMMANDS.filter(
    (cmd) => cmd.isPrompt && (!cmd.requiresProject || hasActiveProject)
  );

  return (
    <div className="command-chips">
      <span className="command-chips-label">/</span>
      {slashCommands.map((cmd) => (
        <button
          key={cmd.command}
          className="command-chip"
          onClick={() => onSelect(cmd.command)}
          title={cmd.description}
        >
          {cmd.label}
        </button>
      ))}
      {promptCommands.length > 0 && <span className="command-chips-sep">|</span>}
      {promptCommands.map((cmd) => (
        <button
          key={cmd.label}
          className="command-chip prompt-chip"
          onClick={() => onSelect(cmd.command)}
          title={cmd.description}
        >
          {cmd.label}
        </button>
      ))}
    </div>
  );
};

export const CommandDropdown: React.FC<{
  filter: string;
  onSelect: (command: string) => void;
  hasActiveProject: boolean;
}> = ({ filter, onSelect, hasActiveProject }) => {
  const filtered = useMemo(() => {
    const q = filter.toLowerCase().replace("/", "");
    return COMMANDS.filter(
      (cmd) =>
        (!cmd.requiresProject || hasActiveProject) &&
        (cmd.command.includes(q) || cmd.label.toLowerCase().includes(q))
    );
  }, [filter, hasActiveProject]);

  if (filtered.length === 0) return null;

  return (
    <div className="command-dropdown">
      {filtered.map((cmd) => (
        <button
          key={cmd.command}
          className="command-dropdown-item"
          onClick={() => onSelect(cmd.command + " ")}
        >
          <span className="command-dropdown-icon">{cmd.icon}</span>
          <div>
            <div className="command-dropdown-name">{cmd.isPrompt ? cmd.label : cmd.command}</div>
            <div className="command-dropdown-desc">{cmd.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
};
