#!/usr/bin/env node

/**
 * Neon City — Hook Setup Script
 *
 * Configures Claude Code to send events to the Neon City server
 * by updating ~/.claude/settings.local.json with hook entries.
 *
 * HTTP hooks (type: "http") are used for tool events — they POST directly
 * to the server without a shell wrapper.
 *
 * Command hooks (type: "command") use curl for non-tool lifecycle events
 * (SessionStart, SessionEnd, SubagentStart, SubagentStop, Stop,
 * UserPromptSubmit, Notification) because those event types do not support
 * the "http" hook type.
 *
 * Usage: node bin/setup.js [--uninstall]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.local.json");

const BASE_URL = "http://localhost:5174/api/hooks";

/**
 * Sentinel used to identify hooks that belong to Neon City so they can be
 * removed idempotently.  We match on this string being present in either
 * the hook's `url` field (HTTP hooks) or `command` field (command hooks).
 */
const NEON_CITY_SENTINEL = "localhost:5174";

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------

/**
 * HTTP hooks — fire on tool events.  Claude Code POSTs the event payload
 * directly to the given URL without spawning a shell process.
 * No matcher is needed; they fire on all tool events.
 */
const HTTP_HOOKS = [
  { event: "PreToolUse", url: `${BASE_URL}/pre-tool-use`, timeout: 5 },
  { event: "PostToolUse", url: `${BASE_URL}/post-tool-use`, timeout: 5 },
  { event: "PostToolUseFailure", url: `${BASE_URL}/post-tool-use-failure`, timeout: 5 },
  { event: "PermissionRequest", url: `${BASE_URL}/permission-request`, timeout: 120 },
];

/**
 * Command hooks — required for lifecycle events that do not support the
 * "http" hook type.  Each hook reads stdin with `$(cat)` and POSTs it via
 * curl.  The `|| true` ensures Claude Code is not disrupted when the Neon
 * City server is not running.
 */
function curlCommand(path) {
  return (
    `curl -sf -X POST ${BASE_URL}/${path}` +
    ` -H 'Content-Type: application/json'` +
    ` -d "$(cat)" || true`
  );
}

const COMMAND_HOOKS = [
  { event: "SessionStart",      command: curlCommand("session-start") },
  { event: "SessionEnd",        command: curlCommand("session-end") },
  { event: "SubagentStart",     command: curlCommand("subagent-start") },
  { event: "SubagentStop",      command: curlCommand("subagent-stop") },
  { event: "Stop",              command: curlCommand("stop") },
  { event: "UserPromptSubmit",  command: curlCommand("user-prompt-submit") },
  { event: "Notification",      command: curlCommand("notification") },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a hook entry (the objects stored inside each event array)
 * belongs to Neon City.
 *
 * Settings schema for a hook-type key, e.g. "PreToolUse":
 *   Array of entries, where each entry is either:
 *     { type: "http", url: "...", timeout: N }          ← HTTP hook (flat)
 *     { type: "command", command: "..." }               ← command hook (flat)
 *     { matcher: "...", hooks: [ { type, command } ] }  ← legacy grouped form
 */
function isNeonCityEntry(entry) {
  // Flat HTTP hook
  if (entry.type === "http" && entry.url?.includes(NEON_CITY_SENTINEL)) {
    return true;
  }
  // Flat command hook
  if (entry.type === "command" && entry.command?.includes(NEON_CITY_SENTINEL)) {
    return true;
  }
  // Legacy grouped form (old shell-script hooks also matched neon-city path)
  if (
    entry.hooks?.some(
      (h) =>
        h.command?.includes("neon-city") ||
        h.command?.includes(NEON_CITY_SENTINEL) ||
        h.url?.includes(NEON_CITY_SENTINEL)
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Strip all Neon City entries from settings.hooks and prune empty keys.
 */
function removeNeonCityHooks(settings) {
  if (!settings.hooks) return;

  for (const eventType of Object.keys(settings.hooks)) {
    settings.hooks[eventType] = settings.hooks[eventType].filter(
      (entry) => !isNeonCityEntry(entry)
    );
    if (settings.hooks[eventType].length === 0) {
      delete settings.hooks[eventType];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const uninstall = process.argv.includes("--uninstall");

function main() {
  // Ensure ~/.claude directory exists
  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  // Read existing settings (gracefully handle parse errors)
  let settings = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    } catch {
      console.error(
        "Warning: Could not parse existing settings, starting fresh"
      );
      settings = {};
    }
  }

  if (uninstall) {
    removeNeonCityHooks(settings);
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
    console.log("Neon City hooks removed from Claude Code settings");
    return;
  }

  // Ensure top-level hooks object exists
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Remove any existing Neon City hooks first so installation is idempotent
  removeNeonCityHooks(settings);

  // Re-create the hooks object after removal (removeNeonCityHooks may delete it)
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Install HTTP hooks — wrapped in matcher group: { hooks: [{ type, url, timeout }] }
  for (const { event, url, timeout } of HTTP_HOOKS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }
    settings.hooks[event].push({
      hooks: [{ type: "http", url, timeout }],
    });
  }

  // Install command hooks — wrapped in matcher group: { hooks: [{ type, command }] }
  for (const { event, command } of COMMAND_HOOKS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }
    settings.hooks[event].push({
      hooks: [{ type: "command", command }],
    });
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");

  console.log("Neon City hooks installed to Claude Code settings");
  console.log(`  Settings: ${SETTINGS_FILE}`);
  console.log("");
  console.log("  HTTP hooks (direct POST, tool events):");
  for (const { event, url, timeout } of HTTP_HOOKS) {
    console.log(`    ${event} -> ${url} (timeout: ${timeout}s)`);
  }
  console.log("");
  console.log("  Command hooks (curl wrapper, lifecycle events):");
  for (const { event } of COMMAND_HOOKS) {
    console.log(`    ${event} -> ${BASE_URL}/${event.toLowerCase().replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`);
  }
  console.log("");
  console.log("Start Neon City with: npm run dev");
  console.log("Then start Claude Code in any project to see agents appear!");
}

main();
