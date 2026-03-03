#!/usr/bin/env node

/**
 * Neon City — Hook Setup Script
 *
 * Configures Claude Code to send events to the Neon City server
 * by updating ~/.claude/settings.local.json with hook entries.
 *
 * Usage: node bin/setup.js [--uninstall]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.local.json");

const hooksDir = resolve(import.meta.dirname, "..", "hooks");

const HOOKS = {
  PreToolUse: [
    {
      matcher: ".*",
      hooks: [
        {
          type: "command",
          command: `bash "${join(hooksDir, "file-activity-hook.sh")}"`,
        },
        {
          type: "command",
          command: `bash "${join(hooksDir, "thinking-hook.sh")}"`,
        },
        {
          type: "command",
          command: `bash "${join(hooksDir, "notification-hook.sh")}"`,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: ".*",
      hooks: [
        {
          type: "command",
          command: `bash "${join(hooksDir, "file-activity-hook.sh")}"`,
        },
        {
          type: "command",
          command: `bash "${join(hooksDir, "thinking-hook.sh")}"`,
        },
      ],
    },
  ],
};

const uninstall = process.argv.includes("--uninstall");

function main() {
  // Ensure .claude directory exists
  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  // Read existing settings
  let settings = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    } catch (e) {
      console.error("Warning: Could not parse existing settings, starting fresh");
      settings = {};
    }
  }

  if (uninstall) {
    // Remove our hooks
    if (settings.hooks) {
      for (const hookType of ["PreToolUse", "PostToolUse"]) {
        if (settings.hooks[hookType]) {
          settings.hooks[hookType] = settings.hooks[hookType].filter(
            (entry) =>
              !entry.hooks?.some((h) => h.command?.includes("neon-city"))
          );
          if (settings.hooks[hookType].length === 0) {
            delete settings.hooks[hookType];
          }
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
    console.log("✓ Neon City hooks removed from Claude Code settings");
    return;
  }

  // Install hooks
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Merge our hooks without overwriting existing ones
  for (const [hookType, entries] of Object.entries(HOOKS)) {
    if (!settings.hooks[hookType]) {
      settings.hooks[hookType] = [];
    }

    // Remove any existing neon-city hooks first (idempotent)
    settings.hooks[hookType] = settings.hooks[hookType].filter(
      (entry) =>
        !entry.hooks?.some((h) => h.command?.includes("neon-city"))
    );

    // Add our hooks
    settings.hooks[hookType].push(...entries);
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");

  console.log("✓ Neon City hooks installed to Claude Code settings");
  console.log(`  Settings: ${SETTINGS_FILE}`);
  console.log(`  Hooks dir: ${hooksDir}`);
  console.log("");
  console.log("Start Neon City with: npm run dev");
  console.log("Then start Claude Code in any project to see agents appear!");
}

main();
