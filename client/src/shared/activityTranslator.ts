interface TranslatedActivity {
  friendlyText: string;
  icon: string;
  color: string;
}

export function translateToolActivity(
  toolName: string,
  toolInput: string
): TranslatedActivity {
  const input = toolInput || "";

  switch (toolName) {
    case "Read": {
      const fileName = input.split("/").pop() || input;
      return { friendlyText: `Reading ${fileName}`, icon: "R", color: "var(--neon-yellow)" };
    }
    case "Write": {
      const fileName = input.split("/").pop() || input;
      return { friendlyText: `Creating ${fileName}`, icon: "W", color: "var(--neon-green)" };
    }
    case "Edit": {
      const fileName = input.split("/").pop() || input;
      return { friendlyText: `Editing ${fileName}`, icon: "E", color: "var(--neon-green)" };
    }
    case "Bash": {
      if (input.startsWith("npm install") || input.startsWith("yarn add") || input.startsWith("bun add"))
        return { friendlyText: "Installing dependencies", icon: ">", color: "var(--neon-orange)" };
      if (input.startsWith("npm test") || input.startsWith("yarn test") || input.startsWith("jest") || input.startsWith("pytest"))
        return { friendlyText: "Running tests", icon: ">", color: "var(--neon-cyan)" };
      if (input.startsWith("npm run build") || input.startsWith("yarn build"))
        return { friendlyText: "Building project", icon: ">", color: "var(--neon-orange)" };
      if (input.startsWith("npm run dev") || input.startsWith("npm start"))
        return { friendlyText: "Starting dev server", icon: ">", color: "var(--neon-green)" };
      if (input.startsWith("git status"))
        return { friendlyText: "Checking git status", icon: ">", color: "var(--neon-purple)" };
      if (input.startsWith("git diff"))
        return { friendlyText: "Reviewing changes", icon: ">", color: "var(--neon-purple)" };
      if (input.startsWith("git commit"))
        return { friendlyText: "Committing changes", icon: ">", color: "var(--neon-green)" };
      if (input.startsWith("git push"))
        return { friendlyText: "Pushing to remote", icon: ">", color: "var(--neon-blue)" };
      if (input.startsWith("git pull"))
        return { friendlyText: "Pulling latest changes", icon: ">", color: "var(--neon-cyan)" };
      if (input.startsWith("gh pr"))
        return { friendlyText: "Working with pull request", icon: ">", color: "var(--neon-purple)" };
      if (input.includes("curl") || input.includes("wget"))
        return { friendlyText: "Fetching from web", icon: ">", color: "var(--neon-blue)" };
      const shortCmd = input.length > 40 ? input.substring(0, 40) + "..." : input;
      return { friendlyText: `Running: ${shortCmd}`, icon: ">", color: "var(--neon-orange)" };
    }
    case "Grep":
      return { friendlyText: "Searching codebase", icon: "?", color: "var(--neon-blue)" };
    case "Glob":
      return { friendlyText: "Finding files", icon: "*", color: "var(--neon-blue)" };
    case "WebFetch":
      return { friendlyText: "Fetching web page", icon: "@", color: "var(--neon-cyan)" };
    case "WebSearch":
      return { friendlyText: "Searching the web", icon: "@", color: "var(--neon-cyan)" };
    case "Agent":
    case "Task":
      return { friendlyText: "Delegating to sub-agent", icon: "A", color: "var(--neon-purple)" };
    case "TodoWrite":
      return { friendlyText: "Updating task list", icon: "T", color: "var(--neon-yellow)" };
    default:
      return { friendlyText: `${toolName}: ${input.substring(0, 50)}`, icon: "?", color: "var(--text-secondary)" };
  }
}
