import { Graphics, Container, Text, TextStyle } from "pixi.js";
import { PALETTE } from "../palette";

export type AgentStatus =
  | "idle"
  | "walking"
  | "reading"
  | "writing"
  | "thinking"
  | "stuck";

export interface AgentConfig {
  colorIndex: number;
  displayName: string;
  status: AgentStatus;
  currentCommand?: string;
  toolInput?: string;
}

const SCALE = 2;

/** Draw a pixel art agent character procedurally */
export function createAgent(config: AgentConfig): Container {
  const container = new Container();
  const palette =
    PALETTE.agentPalettes[config.colorIndex % PALETTE.agentPalettes.length];

  const body = new Graphics();
  const px = SCALE; // pixel size

  // Head (5x5 pixels)
  const headX = 2 * px;
  const headY = 0;
  body.rect(headX + px, headY, 3 * px, px); // top of head
  body.fill(palette.hair);
  body.rect(headX, headY + px, 5 * px, px); // hair row 2
  body.fill(palette.hair);
  body.rect(headX, headY + 2 * px, 5 * px, px); // hair/face top
  body.fill(palette.hair);

  // Face
  body.rect(headX + px, headY + 3 * px, 3 * px, px); // face row 1
  body.fill(0xddbb99);
  body.rect(headX + px, headY + 4 * px, 3 * px, px); // face row 2
  body.fill(0xddbb99);

  // Eyes
  body.rect(headX + px, headY + 3 * px, px, px); // left eye
  body.fill(0x222233);
  body.rect(headX + 3 * px, headY + 3 * px, px, px); // right eye
  body.fill(0x222233);

  // Torso (5x4 pixels)
  const torsoY = headY + 5 * px;
  body.rect(headX, torsoY, 5 * px, px);
  body.fill(palette.shirt);
  body.rect(headX - px, torsoY + px, 7 * px, px); // wider with arms
  body.fill(palette.shirt);
  body.rect(headX - px, torsoY + 2 * px, 7 * px, px);
  body.fill(palette.shirt);
  body.rect(headX, torsoY + 3 * px, 5 * px, px);
  body.fill(palette.shirt);

  // Arms (endpoints, visible when not walking)
  body.rect(headX - px, torsoY + 3 * px, px, px); // left hand
  body.fill(0xddbb99);
  body.rect(headX + 5 * px, torsoY + 3 * px, px, px); // right hand
  body.fill(0xddbb99);

  // Legs (2 separate)
  const legY = torsoY + 4 * px;
  body.rect(headX + px, legY, px, 2 * px); // left leg
  body.fill(palette.pants);
  body.rect(headX + 3 * px, legY, px, 2 * px); // right leg
  body.fill(palette.pants);

  // Shoes
  body.rect(headX + px, legY + 2 * px, px, px);
  body.fill(0x222233);
  body.rect(headX + 3 * px, legY + 2 * px, px, px);
  body.fill(0x222233);

  container.addChild(body);

  // Status indicator above head
  const indicatorY = -4 * px;

  if (config.status === "reading") {
    // Yellow dot
    const dot = new Graphics();
    dot.circle(4.5 * px, indicatorY, 2 * px);
    dot.fill(PALETTE.glowRead);
    container.addChild(dot);
  } else if (config.status === "writing") {
    // Green dot
    const dot = new Graphics();
    dot.circle(4.5 * px, indicatorY, 2 * px);
    dot.fill(PALETTE.glowWrite);
    container.addChild(dot);
  } else if (config.status === "thinking") {
    // Thought bubble dots
    const dots = new Graphics();
    dots.circle(4.5 * px, indicatorY, px);
    dots.fill(0xffffff);
    dots.circle(6 * px, indicatorY - 2 * px, px * 0.7);
    dots.fill(0xffffff);
    dots.circle(7 * px, indicatorY - 4 * px, px * 0.5);
    dots.fill(0xffffff);
    container.addChild(dots);
  } else if (config.status === "stuck") {
    // Red exclamation
    const excl = new Text({
      text: "!",
      style: new TextStyle({
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 8,
        fill: PALETTE.neonRed,
      }),
    });
    excl.anchor.set(0.5, 1);
    excl.x = 4.5 * px;
    excl.y = indicatorY;
    container.addChild(excl);
  }

  // Speech bubble with current tool + file
  if (config.toolInput) {
    const bubble = createSpeechBubble(config.toolInput, config.currentCommand);
    bubble.x = 4.5 * px;
    bubble.y = indicatorY - 6 * px;
    container.addChild(bubble);
  }

  // Store metadata for animation
  (container as any)._agentConfig = config;
  (container as any)._animFrame = 0;
  (container as any)._body = body;

  // Center the pivot
  container.pivot.set(4.5 * px, (5 + 4 + 3) * px);

  return container;
}

function createSpeechBubble(
  text: string,
  command?: string
): Container {
  const container = new Container();
  const displayText = command
    ? `${command}: ${truncate(text, 16)}`
    : truncate(text, 20);

  const style = new TextStyle({
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 6,
    fill: 0xffffff,
  });

  const label = new Text({ text: displayText, style });
  label.anchor.set(0.5, 1);

  // Background
  const pad = 4;
  const bg = new Graphics();
  const bgW = label.width + pad * 2;
  const bgH = label.height + pad * 2;
  bg.roundRect(-bgW / 2, -bgH, bgW, bgH, 3);
  bg.fill({ color: 0x000000, alpha: 0.75 });
  bg.stroke({ color: 0x333366, width: 1 });

  label.y = -pad;

  container.addChild(bg);
  container.addChild(label);

  return container;
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  // Show just the filename
  const parts = s.split("/");
  const name = parts[parts.length - 1];
  return name.length > max ? name.slice(0, max - 2) + ".." : name;
}

/** Animate agent — call each frame */
export function updateAgent(container: Container, time: number, dt: number) {
  const config = (container as any)._agentConfig as AgentConfig | undefined;
  if (!config) return;

  const frame = ((container as any)._animFrame || 0) + dt;
  (container as any)._animFrame = frame;

  const px = SCALE;

  // Walk bob
  if (config.status === "walking") {
    container.y += Math.sin(frame * 0.15) * 0.3;
  }

  // Stuck bounce
  if (config.status === "stuck") {
    container.y += Math.abs(Math.sin(frame * 0.1)) * -3;
  }

  // Idle sway
  if (config.status === "idle") {
    container.rotation = Math.sin(frame * 0.02) * 0.02;
  }

  // Thinking — gentle bob
  if (config.status === "thinking") {
    container.y += Math.sin(frame * 0.05) * 0.5;
  }
}
