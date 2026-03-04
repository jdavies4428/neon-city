# Neon City — Feature Roadmap & Implementation Guide

> Feed this file to Claude Code to implement features incrementally.
> Each section is a self-contained feature spec with file-level implementation guidance.

---

## Architecture Context

- **Monorepo**: `client/` (React 19 + Pixi.js + Vite) and `server/` (Express 5 + SQLite + WebSocket)
- **State**: Single WebSocket at `/ws`, shared via `useCityState` hook. Server state is in-memory maps.
- **Chat**: `POST /api/chat/send` spawns `claude -p <message>` subprocess. Responses streamed via JSONL watcher.
- **Agents**: Spawned via `POST /api/spawn`, tracked in `agents` Map, visualized as Pixi sprites.
- **Styling**: Pure CSS in `client/src/styles/globals.css` with CSS variables. No preprocessor. Glass-morphism + neon theme.
- **Key files**:
  - `server/src/index.ts` — monolithic 2400-line server (all routes, WebSocket, session discovery)
  - `client/src/App.tsx` — root orchestrator, keyboard shortcuts, panel state
  - `client/src/ui/ChatPanel.tsx` — chat interface
  - `client/src/ui/SpawnModal.tsx` — agent spawning
  - `client/src/ui/NotificationCenter.tsx` — alerts + tool activity
  - `client/src/ui/AgentStatusBar.tsx` — bottom agent cards
  - `client/src/pixi/` — all rendering (city, sprites, effects, sky, weather)

---

## P0 — Image Upload in Chat

### What
Allow users to attach images (screenshots, mockups, photos) to chat messages. Display image thumbnails inline in the message feed. Pass images to Claude so it can see and reason about them.

### Why
Non-coders' #1 workflow is "here's a screenshot of the bug / here's the design mockup — make this." Without image support, they must describe visuals in words, which defeats the purpose of a GUI.

### Implementation

#### Server (`server/src/index.ts`)

1. **Add multer for multipart uploads**:
   ```
   npm install multer @types/multer -w server
   ```

2. **Create upload directory and middleware**:
   - Create `data/uploads/` directory for stored images
   - Add multer middleware configured for image files (png, jpg, gif, webp), max 10MB
   - Generate unique filenames with timestamp prefix

3. **Modify `POST /api/chat/send`**:
   - Change from `express.json()` to `multer` for this route
   - Accept `message` (text field) + `images` (file array)
   - Store uploaded files in `data/uploads/`
   - When spawning the `claude` subprocess, use `--image <path>` flag for each attached image (Claude Code CLI supports this)
   - If the target session uses `--resume`, the images are passed alongside `-p`

4. **Add `GET /api/uploads/:filename`** static route:
   - Serve uploaded images back to the client for inline display
   - Set appropriate cache headers

5. **Extend `ChatMessage` interface**:
   ```typescript
   interface ChatMessage {
     id: string;
     role: "user" | "assistant" | "system";
     content: string;
     images?: string[];  // array of "/api/uploads/filename.png" URLs
     // ... existing fields
   }
   ```

#### Client (`client/src/ui/ChatPanel.tsx`)

1. **Add image state and refs**:
   ```typescript
   const [attachedImages, setAttachedImages] = useState<File[]>([]);
   const fileInputRef = useRef<HTMLInputElement>(null);
   ```

2. **Add hidden file input + attachment button**:
   - Place a hidden `<input type="file" accept="image/*" multiple>` in the component
   - Add a paperclip/image icon button next to the send button in `.chat-input-wrap`
   - On click, trigger the hidden file input
   - On file selection, add to `attachedImages` state
   - Also support **paste from clipboard** — listen for `paste` events on the textarea, check `clipboardData.items` for image types, convert to File objects

3. **Show image preview strip**:
   - When `attachedImages.length > 0`, render a horizontal strip above the textarea
   - Each preview: 48x48 thumbnail with an "x" remove button
   - Style with the existing glass-morphism pattern

4. **Modify `send()` function**:
   - Build `FormData` instead of JSON when images are attached
   - Append `message` as text field, each image as `images` file field
   - Fall back to JSON when no images (keep existing path working)
   - Clear `attachedImages` after send

5. **Render images in messages**:
   - In the message rendering loop, check `msg.images`
   - Render each as a clickable thumbnail (120px wide) that opens full-size in a lightbox or new tab
   - Style with `border-radius: 8px; border: 1px solid var(--border);`

6. **Drag and drop support**:
   - Add `onDragOver` / `onDrop` handlers to the chat panel
   - Show a visual drop zone overlay when dragging files over the panel
   - On drop, add image files to `attachedImages`

#### CSS (`client/src/styles/globals.css`)

Add styles for:
- `.chat-attach-btn` — icon button, same height as send button
- `.chat-image-strip` — horizontal flex container above textarea, gap 8px, overflow-x auto
- `.chat-image-preview` — 48x48 rounded thumbnail with remove button
- `.chat-drop-zone` — full-panel overlay with dashed border, shown during drag
- `.msg-images` — grid of inline thumbnails in rendered messages

---

## P0 — Ship It: Git Commit / PR / Push Button

### What
A "Ship It" button that lets non-coders commit, push, and create PRs without touching a terminal. Three modes: Quick Commit, Create PR, and Auto-Ship (commits after each agent completion).

### Why
Git is the #1 barrier for non-coders using Claude Code. They can spawn agents that write code, but can't get that code into version control or create pull requests. This closes the loop.

### Implementation

#### Server (`server/src/index.ts`)

1. **Add `GET /api/git/status`**:
   - Accepts `projectPath` query param
   - Runs `git -C <projectPath> status --porcelain` and `git -C <projectPath> log --oneline -5`
   - Returns: `{ branch, dirty, stagedCount, unstagedCount, untrackedCount, recentCommits[], hasRemote }`
   - Also run `git -C <projectPath> diff --stat` for a human-readable summary

2. **Add `POST /api/git/ship`**:
   - Accepts `{ projectPath, mode: "commit" | "pr" | "push", commitMessage?: string }`
   - For `mode: "commit"`:
     - If no `commitMessage`, spawn `claude -p "Summarize all uncommitted changes in this project into a concise commit message. Output ONLY the commit message, nothing else." --cwd <projectPath>` to auto-generate one
     - Then run `git -C <projectPath> add -A && git -C <projectPath> commit -m "<message>"`
   - For `mode: "push"`:
     - Run `git -C <projectPath> push`
   - For `mode: "pr"`:
     - Spawn a Claude agent: `claude -p "Review all changes on the current branch vs main. Create a PR with gh pr create using a descriptive title and body. Push first if needed." --cwd <projectPath>`
     - Track the spawn like existing agent spawning (reuse spawn infrastructure)
   - Return `{ ok, output, error? }`
   - Broadcast a notification on completion

3. **Add `GET /api/git/diff`**:
   - Accepts `projectPath` query param
   - Runs `git -C <projectPath> diff` and `git -C <projectPath> diff --cached`
   - Returns the combined diff output for preview

#### Client — New Component: `client/src/ui/ShipItModal.tsx`

1. **Modal structure** (same pattern as SpawnModal):
   - Overlay + modal card with glass-morphism styling
   - Header: "SHIP IT" with a rocket/ship icon
   - Project selector dropdown (reuse pattern from SpawnModal)

2. **Git status display**:
   - On open, fetch `GET /api/git/status?projectPath=...`
   - Show: current branch, files changed count, staged/unstaged breakdown
   - Color-coded: green (clean), yellow (dirty), red (conflicts)

3. **Diff preview panel**:
   - Collapsible section showing `git diff` output
   - Styled with monospace font, green/red line coloring
   - Max height 200px with scroll

4. **Action buttons**:
   - **"Quick Commit"** — auto-generates message via Claude, shows it for edit, then commits
   - **"Commit & Push"** — same as above, then pushes
   - **"Create PR"** — spawns a Claude agent to create the PR, shows agent progress
   - Each button shows a loading spinner during execution
   - Success/error toast after completion

5. **Auto-commit toggle** (stretch):
   - Checkbox: "Auto-commit after each agent completes"
   - When enabled, server listens for `spawn-complete` events and triggers commit
   - Store preference in localStorage

#### Client (`client/src/App.tsx`)

1. Add state: `const [shipItOpen, setShipItOpen] = useState(false);`
2. Add ShipItModal to the render tree alongside SpawnModal
3. Add header button: rocket icon + "Ship It" label between "Projects" and "+ Agents"
4. Add keyboard shortcut: `Cmd+Shift+S` to toggle

#### CSS (`client/src/styles/globals.css`)

- Reuse `.spawn-overlay`, `.spawn-modal` patterns
- `.ship-status` — status card with branch name, file counts
- `.ship-diff` — monospace pre block with green/red line highlighting
- `.ship-actions` — button row with commit/push/PR buttons
- `.ship-btn.commit` — green-tinted neon button
- `.ship-btn.pr` — blue-tinted neon button

---

## P1 — Quick Actions / Command Palette

### What
A searchable command palette (Cmd+P) with preset workflows for non-coders. Each action is a pre-baked prompt that spawns the right agent type for a selected project.

### Why
Non-coders face blank-page anxiety with free-text chat. Preset actions give them a "menu of superpowers" — they pick what they want, not how to ask for it.

### Implementation

#### Client — New Component: `client/src/ui/CommandPalette.tsx`

1. **Data: preset actions array**:
   ```typescript
   const QUICK_ACTIONS = [
     { id: "review", icon: "🔍", label: "Review code for bugs", agent: "code-reviewer",
       prompt: "Review this entire project for bugs, security issues, and code quality problems. Provide a detailed report." },
     { id: "tests", icon: "🧪", label: "Write tests", agent: "backend-developer",
       prompt: "Analyze the existing code and write comprehensive tests. Use the project's existing test framework." },
     { id: "explain", icon: "📖", label: "Explain this project", agent: "explore",
       prompt: "Explore this codebase thoroughly and write a clear explanation of what it does, its architecture, and key files." },
     { id: "fix-types", icon: "🔧", label: "Fix TypeScript errors", agent: "frontend-developer",
       prompt: "Run the TypeScript compiler, find all type errors, and fix them." },
     { id: "readme", icon: "📝", label: "Update the README", agent: "content-marketer",
       prompt: "Read the codebase and create or update the README.md with accurate description, setup instructions, and usage." },
     { id: "refactor", icon: "♻️", label: "Refactor for clarity", agent: "code-reviewer",
       prompt: "Identify the most confusing or complex parts of this codebase and refactor them for clarity without changing behavior." },
     { id: "deps", icon: "📦", label: "Update dependencies", agent: "backend-developer",
       prompt: "Check for outdated dependencies, update them, and fix any breaking changes." },
     { id: "perf", icon: "⚡", label: "Optimize performance", agent: "backend-developer",
       prompt: "Profile and analyze the codebase for performance bottlenecks. Implement optimizations." },
     { id: "security", icon: "🛡️", label: "Security audit", agent: "security-auditor",
       prompt: "Conduct a thorough security audit of this codebase. Check for OWASP top 10, dependency vulnerabilities, and secrets." },
     { id: "ship", icon: "🚀", label: "Commit & create PR", agent: "general-purpose",
       prompt: "Review all uncommitted changes, create a descriptive commit, push, and create a pull request with gh pr create." },
   ];
   ```

2. **UI structure**:
   - Full-screen overlay with centered modal (like macOS Spotlight)
   - Search input at top, auto-focused
   - Filtered list of actions below (fuzzy match on label)
   - Each row: icon + label + agent type badge
   - Arrow key navigation + Enter to select
   - Clicking an action opens SpawnModal pre-filled with the action's agent type and prompt
   - Project selector inline (small dropdown) so user picks which project to target

3. **Keyboard shortcut**: `Cmd+P` (add to existing handler in `App.tsx`)
   - Also support `/` as a quick trigger when no input is focused

#### Client (`client/src/App.tsx`)

1. Add state: `const [paletteOpen, setPaletteOpen] = useState(false);`
2. Add `CommandPalette` to render tree
3. Wire `Cmd+P` in the keyboard handler
4. When a palette action is selected, set `spawnContext` with the action's prompt + agent type, and open SpawnModal
   - OR: directly call `POST /api/spawn` and skip the modal for one-click execution

#### CSS

- `.command-palette-overlay` — semi-transparent backdrop
- `.command-palette` — centered modal, 500px wide, max-height 400px
- `.palette-search` — large input, 16px font, neon-blue focus ring
- `.palette-item` — hover highlight, active state, icon + label + badge layout
- `.palette-item.selected` — keyboard-selected state with left neon border

---

## P1 — Markdown Rendering in Chat

### What
Render Claude's responses with proper markdown formatting: code blocks with syntax highlighting, bold, italic, lists, headers, links.

### Why
Claude's responses are currently rendered as plain text via `{msg.content}`. Code blocks, which are the most common output, are unreadable without formatting. This is the single biggest readability issue in the chat panel.

### Implementation

#### Dependencies
```
npm install react-markdown remark-gfm -w client
```

Optionally for syntax highlighting:
```
npm install rehype-highlight highlight.js -w client
```

#### Client (`client/src/ui/ChatPanel.tsx`)

1. **Import**:
   ```typescript
   import ReactMarkdown from "react-markdown";
   import remarkGfm from "remark-gfm";
   ```

2. **Replace plain text rendering**:
   Change:
   ```tsx
   <div className="msg-content">{msg.content}</div>
   ```
   To:
   ```tsx
   <div className="msg-content">
     {msg.role === "assistant" ? (
       <ReactMarkdown remarkPlugins={[remarkGfm]}>
         {msg.content}
       </ReactMarkdown>
     ) : (
       msg.content
     )}
   </div>
   ```

3. **Code block copy button**:
   - Add a custom `code` component to ReactMarkdown that wraps fenced code blocks
   - Include a small "Copy" button in the top-right corner of each code block
   - On click, copy to clipboard and show brief "Copied!" feedback

#### CSS (`client/src/styles/globals.css`)

```css
/* Markdown in chat messages */
.msg-content h1, .msg-content h2, .msg-content h3 {
  font-family: var(--font-mono);
  font-weight: 600;
  margin: 8px 0 4px;
}
.msg-content h1 { font-size: 14px; }
.msg-content h2 { font-size: 13px; }
.msg-content h3 { font-size: 12px; }

.msg-content p { margin: 4px 0; line-height: 1.5; }

.msg-content pre {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  font-size: 11px;
  margin: 8px 0;
  position: relative;
}

.msg-content code {
  font-family: var(--font-mono);
  font-size: 11px;
}

.msg-content :not(pre) > code {
  background: rgba(64, 128, 255, 0.15);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}

.msg-content ul, .msg-content ol {
  padding-left: 20px;
  margin: 4px 0;
}

.msg-content li { margin: 2px 0; }

.msg-content a {
  color: var(--neon-cyan);
  text-decoration: none;
}

.code-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
```

---

## P1 — Desktop Notifications

### What
Browser `Notification` API alerts when the Neon City tab is in background — for pending approvals, agent completions, and errors.

### Why
Non-coders spawn agents and switch to other tabs/apps. They need to know when approval is required (agent is blocked) or when work is done.

### Implementation

#### Client — New hook: `client/src/hooks/useDesktopNotifications.ts`

```typescript
export function useDesktopNotifications(subscribeToMessages: SubscribeFn) {
  const [permission, setPermission] = useState(Notification.permission);

  const requestPermission = useCallback(async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  useEffect(() => {
    return subscribeToMessages((msg) => {
      if (document.hasFocus()) return; // only notify when tab is in background

      if (msg.type === "notification") {
        const n = msg.data;
        if (n.type === "approval-needed") {
          new Notification("Neon City — Approval Needed", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.ico",
            tag: n.id,
          });
        } else if (n.type === "task-complete") {
          new Notification("Neon City — Task Complete", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.ico",
            tag: n.id,
          });
        } else if (n.type === "error") {
          new Notification("Neon City — Error", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.ico",
            tag: n.id,
          });
        }
      }

      if (msg.type === "spawn-complete") {
        new Notification("Neon City — Agent Finished", {
          body: `Agent completed its task`,
          icon: "/favicon.ico",
        });
      }
    });
  }, [subscribeToMessages]);

  return { permission, requestPermission };
}
```

#### Client (`client/src/App.tsx`)

1. Import and use the hook
2. On first load, if permission is "default", show a small banner or button: "Enable desktop notifications"
3. Wire `requestPermission` to that button

---

## P2 — Daily Digest / Session Summary

### What
A "What Happened" button that generates an AI summary of all agent activity across projects in the last N hours. Shown as a modal or injected into the History drawer.

### Implementation

#### Server (`server/src/index.ts`)

1. **Add `GET /api/digest`**:
   - Accepts `hours` query param (default: 24)
   - Query the SQLite indexer for all messages in the time range
   - Group by project
   - For each project: count messages, list file changes, extract key assistant responses
   - Return structured data: `{ projects: [{ name, messageCount, fileChanges[], summary? }] }`

2. **Add `POST /api/digest/generate`**:
   - Collects the same data as above
   - Constructs a prompt: "Summarize the following Claude Code activity from the last N hours across these projects: [structured data]. Be concise — bullet points per project."
   - Spawns `claude -p <prompt>` and returns the response
   - Cache the result for 5 minutes (avoid re-generating on every click)

#### Client — New Component: `client/src/ui/DigestModal.tsx`

- Button in header or History drawer: "Daily Digest" or "What Happened?"
- On click, shows modal with loading spinner
- Calls `POST /api/digest/generate`
- Renders the AI summary with markdown formatting (reuse ReactMarkdown)
- Below the summary, show raw stats: projects touched, files changed, tokens used

---

## P2 — Achievement / XP System (Gamification)

### What
Track user milestones and show achievement toasts + a persistent level indicator. Makes using Claude Code feel rewarding and encourages exploration of features.

### Implementation

#### Server

1. **Add `data/achievements.json`** (or SQLite table) for persistent state:
   ```json
   {
     "xp": 0,
     "level": 1,
     "achievements": [],
     "stats": {
       "totalAgentsSpawned": 0,
       "totalCommits": 0,
       "totalPRs": 0,
       "totalTokensUsed": 0,
       "totalSessions": 0,
       "consecutiveDays": 0,
       "lastActiveDate": null
     }
   }
   ```

2. **Achievement definitions**:
   ```typescript
   const ACHIEVEMENTS = [
     { id: "first-spawn", name: "First Agent", desc: "Spawned your first agent", xp: 50, condition: stats => stats.totalAgentsSpawned >= 1 },
     { id: "10-spawns", name: "Agent Army", desc: "Spawned 10 agents", xp: 200, condition: stats => stats.totalAgentsSpawned >= 10 },
     { id: "first-commit", name: "First Commit", desc: "Made your first commit via Ship It", xp: 100, condition: stats => stats.totalCommits >= 1 },
     { id: "first-pr", name: "PR Pioneer", desc: "Created your first pull request", xp: 150, condition: stats => stats.totalPRs >= 1 },
     { id: "1m-tokens", name: "Power User", desc: "Used 1M tokens", xp: 500, condition: stats => stats.totalTokensUsed >= 1_000_000 },
     { id: "streak-3", name: "On Fire", desc: "3-day coding streak", xp: 300, condition: stats => stats.consecutiveDays >= 3 },
     { id: "streak-7", name: "Unstoppable", desc: "7-day coding streak", xp: 1000, condition: stats => stats.consecutiveDays >= 7 },
     { id: "all-agents", name: "Full Roster", desc: "Used every agent type", xp: 500, condition: stats => stats.uniqueAgentTypes >= 15 },
   ];
   ```

3. **Level formula**: `level = floor(sqrt(xp / 100)) + 1`

4. **Trigger checks** after each spawn, commit, PR, or daily login. If new achievement unlocked, broadcast via WebSocket: `{ type: "achievement", data: { ... } }`

5. **API routes**:
   - `GET /api/achievements` — current stats, level, unlocked achievements
   - WebSocket event `achievement` — real-time unlock notification

#### Client

1. **Level badge in header**: Small pixel-art badge next to "NEON CITY" showing current level
2. **Achievement toast**: When WebSocket receives `achievement` event, show a celebratory toast notification with the achievement name, description, and XP gained. Use neon-gold styling with a brief animation.
3. **Achievements panel**: Accessible from Power Grid or a new button. Grid of all achievements — unlocked ones glow, locked ones are dimmed with "?" icon.

---

## P2 — Camera & City Viewport Improvements

### What
Zoom the camera so the city fills ~60% of the viewport by default. The current view has too much empty sky, burying the hero content.

### Implementation

#### Client (`client/src/pixi/camera.ts`)

1. **Adjust default zoom level**:
   - Find the initial camera setup / `focusOn` default call
   - Increase the default zoom from current value (likely ~1.0) to ~1.8-2.0
   - Center the camera Y position lower (closer to the ground/building level)

2. **Auto-fit on load**:
   - After buildings are placed, calculate the bounding box of all buildings
   - Set camera to frame that bounding box with 15% padding on each side
   - This ensures the city is always visible regardless of viewport size

#### Client (`client/src/pixi/city/city-renderer.ts`)

1. **Adjust world dimensions** if needed so buildings span more of the horizontal space
2. **Reduce sky height ratio** — the sky gradient can be shorter while still looking atmospheric

---

## P3 — Bottom Dock UI

### What
Replace the horizontal header button bar with a macOS-style floating dock at the bottom center of the screen, positioned above the agent status bar.

### Implementation

#### Client (`client/src/App.tsx`)

1. **Extract header buttons into a new `CityDock` component**:
   - Floating `position: fixed; bottom: 80px;` (above agent bar)
   - Centered horizontally with `left: 50%; transform: translateX(-50%);`
   - Icon-only buttons with tooltip labels on hover
   - Icons: police light (Alerts), speech bubble (Chat), clock (History), folder (Projects), plus-person (Agents), rocket (Ship It), lightning (Power Grid), command (Quick Actions)
   - On hover, icons scale up slightly with spring animation (dock magnification effect)

2. **Simplify header**:
   - Header becomes: brand title left, session stats + weather indicator right
   - Much cleaner, less cognitive load

#### CSS

```css
.city-dock {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  backdrop-filter: blur(12px);
  z-index: 15;
}

.dock-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 18px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  cursor: pointer;
  background: transparent;
  border: none;
  color: var(--text-primary);
}

.dock-btn:hover {
  transform: scale(1.3) translateY(-4px);
  background: var(--bg-hover);
}

.dock-btn .badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  font-size: 8px;
}
```

---

## P3 — Historical Charts in Power Grid

### What
Extend the Power Grid modal with line charts showing token usage, cost, and agent activity over time (24h, 7d, 30d).

### Implementation

#### Dependencies
```
npm install lightweight-charts -w client
```
Or use a minimal canvas-based chart (to stay pixel-art themed, consider drawing charts with Pixi.js or a simple SVG).

#### Server (`server/src/index.ts`)

1. **Add `GET /api/stats/history`**:
   - Query SQLite for hourly aggregated token counts over the last 7 days
   - Return: `{ hourly: [{ timestamp, tokens, cost, agentCount }] }`
   - Use the existing `messages` table timestamps for bucketing

#### Client (`client/src/ui/PowerGridModal.tsx`)

1. Add a "History" tab below the existing stats grid
2. Render a simple line chart with:
   - X axis: time (24h default, toggleable to 7d/30d)
   - Y axis: tokens used
   - Second line: estimated cost
3. Style the chart with neon colors on dark background to match the city theme
4. Consider a pixel-art style stepped line chart for thematic consistency

---

## Agent Status Bar Improvements

### What
Make active agents visually prominent and idle agents dimmed. Add pulse animation for agents that are currently working.

### Implementation

#### Client (`client/src/ui/AgentStatusBar.tsx`)

1. Add CSS class based on agent status:
   ```tsx
   className={`agent-card ${agent.status}`}
   ```

2. Active agents (reading/writing/thinking) get a glowing border animation matching their neon color

#### CSS

```css
.agent-card.writing,
.agent-card.reading {
  border-color: currentColor;
  box-shadow: 0 0 12px currentColor, inset 0 0 8px rgba(255,255,255,0.05);
  animation: agent-pulse 2s ease-in-out infinite;
}

.agent-card.thinking {
  border-color: #D97757;
  animation: agent-think 1.5s ease-in-out infinite;
}

.agent-card.idle {
  opacity: 0.5;
  border-color: var(--border);
}

@keyframes agent-pulse {
  0%, 100% { box-shadow: 0 0 8px currentColor; }
  50% { box-shadow: 0 0 20px currentColor, 0 0 40px rgba(255,255,255,0.1); }
}
```

---

## Weather Tooltip Enhancement

### What
Make the weather indicator explain what the current weather means in human terms.

### Implementation

#### Client (`client/src/ui/WeatherIndicator.tsx`)

Add descriptive tooltips to each weather state:

```typescript
const WEATHER_DESCRIPTIONS: Record<string, string> = {
  clear: "All quiet — no active agents",
  snow: "Agents idle — waiting for tasks",
  fog: "Deep thinking — 2+ agents analyzing",
  aurora: "High productivity — 3+ agents writing code",
  rain: "Blocked — an agent needs approval",
  storm: "Multiple agents stuck — check alerts",
};
```

Display this as a subtitle below the weather name in the indicator, and in the dropdown tooltip.

---

## Chat Message Actions

### What
Add contextual action buttons on chat messages: Copy, Retry, Spawn Follow-up Agent.

### Implementation

#### Client (`client/src/ui/ChatPanel.tsx`)

1. On hover over a message, show a small action bar:
   - **Copy** — copies message content to clipboard
   - **Retry** (user messages only) — re-sends the same message
   - **Spawn Agent** (assistant messages only) — opens SpawnModal pre-filled with "Continue from this response: [truncated content]"

2. Render as a floating bar positioned at the top-right of the message bubble

#### CSS

```css
.msg-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 4px;
}

.chat-msg:hover .msg-actions {
  display: flex;
}

.msg-action-btn {
  padding: 2px 6px;
  font-size: 9px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
}
```

---

## Implementation Order

Execute features in this order for maximum incremental value:

1. **Markdown rendering in chat** (smallest change, biggest readability win)
2. **Image upload in chat** (unlocks the core non-coder workflow)
3. **Ship It button** (closes the git gap)
4. **Quick Actions / Command Palette** (preset superpowers)
5. **Desktop notifications** (background awareness)
6. **Agent status bar improvements** (visual polish)
7. **Weather tooltip enhancement** (small but meaningful)
8. **Chat message actions** (power-user feature)
9. **Camera zoom improvements** (city viewport)
10. **Daily digest** (returning-user feature)
11. **Achievement system** (gamification)
12. **Bottom dock UI** (layout overhaul)
13. **Historical charts** (analytics depth)
