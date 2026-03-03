/**
 * Parse Claude Code JSONL session files into structured data.
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";

export interface ParsedMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  tokenCount?: number;
  toolName?: string;
  filePath?: string;
}

export interface ParsedSession {
  messages: ParsedMessage[];
  title: string | null;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
}

/**
 * Parse a JSONL session file from a given byte offset.
 * Returns parsed messages and the new offset.
 */
export async function parseSessionFile(
  filePath: string,
  startOffset = 0
): Promise<{ session: ParsedSession; newOffset: number }> {
  const messages: ParsedMessage[] = [];
  let title: string | null = null;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let bytesRead = startOffset;

  const stream = createReadStream(filePath, {
    start: startOffset,
    encoding: "utf-8",
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, "utf-8") + 1; // +1 for newline

    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      const msg = extractMessage(entry);
      if (msg) {
        messages.push(msg);

        if (msg.timestamp) {
          if (!firstTs || msg.timestamp < firstTs) firstTs = msg.timestamp;
          if (!lastTs || msg.timestamp > lastTs) lastTs = msg.timestamp;
        }

        // Use first user message as title
        if (!title && msg.role === "user" && msg.content.length > 0) {
          title = msg.content.slice(0, 120);
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return {
    session: { messages, title, firstMessageAt: firstTs, lastMessageAt: lastTs },
    newOffset: bytesRead,
  };
}

function extractMessage(entry: any): ParsedMessage | null {
  // Claude Code JSONL uses type: "user" | "assistant" | "system" | "message"
  // with entry.message containing the actual message object
  const entryType = entry.type;
  const validTypes = ["user", "assistant", "system", "message"];

  if (validTypes.includes(entryType) && entry.message) {
    const msg = entry.message;
    const role = (msg.role || entryType) as "user" | "assistant" | "system";

    let content = "";
    let toolName: string | undefined;
    let filePath: string | undefined;

    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter((b: any) => b.type === "text");
      content = textBlocks.map((b: any) => b.text).join("\n");

      // Look for tool_use blocks
      const toolBlocks = msg.content.filter((b: any) => b.type === "tool_use");
      if (toolBlocks.length > 0) {
        toolName = toolBlocks[0].name;
        const input = toolBlocks[0].input;
        if (input?.file_path) filePath = input.file_path;
        else if (input?.path) filePath = input.path;
        else if (input?.command) filePath = input.command.slice(0, 80);
      }
    }

    if (!content) return null;

    // Estimate token count (~4 chars per token)
    const tokenCount = Math.ceil(content.length / 4);

    return {
      role,
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : undefined,
      tokenCount,
      toolName,
      filePath,
    };
  }

  // Handle "human" / "assistant" top-level format (older sessions)
  if (entry.role && entry.content) {
    const content = typeof entry.content === "string"
      ? entry.content
      : Array.isArray(entry.content)
        ? entry.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
        : "";

    if (!content) return null;

    return {
      role: entry.role === "human" ? "user" : entry.role,
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : undefined,
      tokenCount: Math.ceil(content.length / 4),
    };
  }

  return null;
}
