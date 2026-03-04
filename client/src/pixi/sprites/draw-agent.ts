import { Graphics, Container, Text, TextStyle } from "pixi.js";
import { PALETTE } from "../palette";
import { ROLE_BADGE_COLORS, ROLE_ABBREVIATIONS } from "../../shared/agent-roles";
import { basename } from "../../shared/format";

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
  variant?: "agent" | "session";
  ideName?: string;
  agentType?: string;
  agentKind?: "session" | "subagent";
}

const SCALE = 2;

// ------------------------------------------------------------------
// Internal types stored on the sprite container
// ------------------------------------------------------------------

interface AgentInternals {
  _agentConfig: AgentConfig;
  _animFrame: number;
  _body: Graphics;
  // Walk cycle
  _walkFrame: number;   // 0-3
  _walkTimer: number;   // accumulated ms
  // Pose change detection
  _lastStatus: AgentStatus;
  _isMoving?: boolean;  // set by city-renderer during lerp
}

// ------------------------------------------------------------------
// Body drawing helpers
// ------------------------------------------------------------------

/**
 * Offsets applied per walk-frame to the limbs.
 *
 * Each entry describes relative pixel offsets from the neutral position:
 *   leftLegDY  — Y offset of left leg top (positive = down, i.e. shorter visible)
 *   rightLegDY — Y offset of right leg top
 *   leftArmDY  — Y offset of left arm/hand row
 *   rightArmDY — Y offset of right arm/hand row
 *   leftLegDX  — X offset of left leg column
 *   rightLegDX — X offset of right leg column
 */
interface WalkOffsets {
  leftLegDX: number;
  rightLegDX: number;
  leftArmDY: number;
  rightArmDY: number;
}

const WALK_FRAMES: WalkOffsets[] = [
  // Frame 0 — neutral
  { leftLegDX: 0, rightLegDX: 0, leftArmDY: 0, rightArmDY: 0 },
  // Frame 1 — left forward, right back
  { leftLegDX: -1, rightLegDX: 1, leftArmDY: 1, rightArmDY: -1 },
  // Frame 2 — neutral
  { leftLegDX: 0, rightLegDX: 0, leftArmDY: 0, rightArmDY: 0 },
  // Frame 3 — right forward, left back (mirror of frame 1)
  { leftLegDX: 1, rightLegDX: -1, leftArmDY: -1, rightArmDY: 1 },
];

/** Draw the character body graphics into `g`, clearing it first.
 *
 * @param g        Graphics object to draw into (will be cleared)
 * @param palette  Agent color palette
 * @param status   Current agent status (determines pose)
 * @param walkFrame  0-3, only used when status === "walking"
 * @param stuckFlap  true/false alternating flag for stuck arm flailing
 */
/** Draw neutral standing legs + shoes (reused by writing, reading, thinking, stuck) */
function drawNeutralLegs(
  g: Graphics,
  palette: (typeof PALETTE.agentPalettes)[number],
  headX: number,
  legY: number,
  px: number
): void {
  g.rect(headX + px, legY, px, 2 * px);
  g.fill(palette.pants);
  g.rect(headX + 3 * px, legY, px, 2 * px);
  g.fill(palette.pants);
  g.rect(headX + px, legY + 2 * px, px, px);
  g.fill(0x222233);
  g.rect(headX + 3 * px, legY + 2 * px, px, px);
  g.fill(0x222233);
}

function drawBody(
  g: Graphics,
  palette: (typeof PALETTE.agentPalettes)[number],
  status: AgentStatus,
  walkFrame: number,
  stuckFlap: boolean
): void {
  g.clear();

  const px = SCALE;

  // Head origin
  const headX = 2 * px;
  const headY = 0;

  // ----- Head (5x5) -----
  g.rect(headX + px, headY, 3 * px, px);
  g.fill(palette.hair);
  g.rect(headX, headY + px, 5 * px, px);
  g.fill(palette.hair);
  g.rect(headX, headY + 2 * px, 5 * px, px);
  g.fill(palette.hair);

  // Face
  g.rect(headX + px, headY + 3 * px, 3 * px, px);
  g.fill(0xddbb99);
  g.rect(headX + px, headY + 4 * px, 3 * px, px);
  g.fill(0xddbb99);

  // Eyes
  g.rect(headX + px, headY + 3 * px, px, px);
  g.fill(0x222233);
  g.rect(headX + 3 * px, headY + 3 * px, px, px);
  g.fill(0x222233);

  // ----- Torso (5x4) -----
  // Idle pose: sit — lower torso by 1px and draw bent legs
  const torsoShiftY = status === "idle" ? px : 0;
  const torsoY = headY + 5 * px + torsoShiftY;

  g.rect(headX, torsoY, 5 * px, px);
  g.fill(palette.shirt);
  g.rect(headX - px, torsoY + px, 7 * px, px);
  g.fill(palette.shirt);
  g.rect(headX - px, torsoY + 2 * px, 7 * px, px);
  g.fill(palette.shirt);
  g.rect(headX, torsoY + 3 * px, 5 * px, px);
  g.fill(palette.shirt);

  // ----- Arms & hands (status-specific) -----
  const legY = torsoY + 4 * px;

  if (status === "walking") {
    const wf = WALK_FRAMES[walkFrame] ?? WALK_FRAMES[0];

    // Left arm/hand
    g.rect(headX - px, torsoY + 3 * px + wf.leftArmDY * px, px, px);
    g.fill(0xddbb99);
    // Right arm/hand
    g.rect(headX + 5 * px, torsoY + 3 * px + wf.rightArmDY * px, px, px);
    g.fill(0xddbb99);

    // ----- Legs (walk cycle) -----
    g.rect(headX + px + wf.leftLegDX * px, legY, px, 2 * px);
    g.fill(palette.pants);
    g.rect(headX + 3 * px + wf.rightLegDX * px, legY, px, 2 * px);
    g.fill(palette.pants);

    // Shoes follow legs
    g.rect(headX + px + wf.leftLegDX * px, legY + 2 * px, px, px);
    g.fill(0x222233);
    g.rect(headX + 3 * px + wf.rightLegDX * px, legY + 2 * px, px, px);
    g.fill(0x222233);

  } else if (status === "writing") {
    // Arms raised to mid-torso level
    g.rect(headX - px, torsoY + px, px, px); // left arm raised
    g.fill(0xddbb99);
    g.rect(headX + 5 * px, torsoY + px, px, px); // right arm raised
    g.fill(0xddbb99);

    // Tiny 2x1 laptop in front of torso
    g.rect(headX + px, torsoY + 3 * px, 2 * px, px);
    g.fill(0x334488);
    g.rect(headX + px, torsoY + 3 * px, 2 * px, px);
    g.fill(0x4488cc);

    drawNeutralLegs(g, palette, headX, legY, px);

  } else if (status === "reading") {
    // One arm extended holding a 2x3 "page"
    g.rect(headX - px, torsoY + 2 * px, px, px); // left arm tucked
    g.fill(0xddbb99);
    g.rect(headX + 5 * px, torsoY + px, px, 2 * px); // right arm extended out
    g.fill(0xddbb99);

    // Page rect to the right of the right hand
    g.rect(headX + 6 * px, torsoY, 2 * px, 3 * px);
    g.fill(0xeeeecc); // paper color
    // Page lines
    g.rect(headX + 6 * px + 1, torsoY + px, px, px);
    g.fill(0x888866);

    drawNeutralLegs(g, palette, headX, legY, px);

  } else if (status === "thinking") {
    // Arms crossed at center of body (both arms meet in the middle)
    // Left arm goes right, right arm goes left — overlap at center
    g.rect(headX, torsoY + 2 * px, 2 * px, px); // left arm crossing right
    g.fill(0xddbb99);
    g.rect(headX + 3 * px, torsoY + 2 * px, 2 * px, px); // right arm crossing left
    g.fill(0xddbb99);

    drawNeutralLegs(g, palette, headX, legY, px);

  } else if (status === "stuck") {
    // Arms flail — alternate up/down per flap tick
    const leftArmDY = stuckFlap ? -2 * px : 0;
    const rightArmDY = stuckFlap ? 0 : -2 * px;

    g.rect(headX - px, torsoY + px + leftArmDY, px, px);
    g.fill(0xddbb99);
    g.rect(headX + 5 * px, torsoY + px + rightArmDY, px, px);
    g.fill(0xddbb99);

    drawNeutralLegs(g, palette, headX, legY, px);

  } else {
    // idle — sitting pose: legs bent horizontal (L-shape)
    // Arms at sides
    g.rect(headX - px, torsoY + 3 * px, px, px);
    g.fill(0xddbb99);
    g.rect(headX + 5 * px, torsoY + 3 * px, px, px);
    g.fill(0xddbb99);

    // Bent legs — thighs go forward (horizontal), then feet drop
    // Left leg: horizontal thigh then vertical shin
    g.rect(headX, legY, 2 * px, px); // left thigh horizontal
    g.fill(palette.pants);
    g.rect(headX, legY + px, px, px); // left shin vertical
    g.fill(palette.pants);

    // Right leg: horizontal thigh then vertical shin
    g.rect(headX + 3 * px, legY, 2 * px, px); // right thigh horizontal
    g.fill(palette.pants);
    g.rect(headX + 4 * px, legY + px, px, px); // right shin vertical
    g.fill(palette.pants);

    // Shoes at ends of shins
    g.rect(headX, legY + 2 * px, px, px);
    g.fill(0x222233);
    g.rect(headX + 4 * px, legY + 2 * px, px, px);
    g.fill(0x222233);
  }
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/** Draw a pixel art agent character procedurally */
export function createAgent(config: AgentConfig): Container {
  const container = new Container();
  const palette =
    PALETTE.agentPalettes[config.colorIndex % PALETTE.agentPalettes.length];

  const body = new Graphics();
  drawBody(body, palette, config.status, 0, false);
  container.addChild(body);

  // Session variant: draw a small colored hat/badge above the head
  if (config.variant === "session") {
    const px = SCALE;
    const headX = 2 * px;
    const headY = 0;
    let hatColor = 0xffffff;
    if (config.ideName === "Cursor") hatColor = 0x7B61FF;
    else if (config.ideName === "VSCode") hatColor = 0x007ACC;
    else if (config.ideName === "Terminal") hatColor = 0x40ff80;
    body.rect(headX + 1, headY - 3, 3, 2);
    body.fill(hatColor);
  }

  // Subagent variant: 80% scale + role badge above head
  if (config.agentKind === "subagent") {
    container.scale.set(0.8);

    // Role badge — 2-letter abbreviation above head
    if (config.agentType) {
      const badgeColor = ROLE_BADGE_COLORS[config.agentType] ?? 0xffffff;
      const abbr = ROLE_ABBREVIATIONS[config.agentType] ?? config.agentType.slice(0, 2).toUpperCase();

      const badge = new Graphics();
      const badgeWidth = abbr.length > 2 ? 16 : 12;
      badge.roundRect(-badgeWidth / 2, -4, badgeWidth, 8, 2);
      badge.fill({ color: badgeColor, alpha: 0.9 });
      badge.x = 4.5 * SCALE;
      badge.y = -6 * SCALE;
      container.addChild(badge);

      const badgeText = new Text({
        text: abbr,
        style: new TextStyle({
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 5,
          fill: 0x000000,
        }),
      });
      badgeText.anchor.set(0.5, 0.5);
      badgeText.x = 4.5 * SCALE;
      badgeText.y = -6 * SCALE;
      container.addChild(badgeText);
    }
  }

  // Status indicator above head
  _addStatusIndicator(container, config.status);

  // Speech bubble with current tool + file
  const px = SCALE;
  const indicatorY = -4 * px;
  if (config.toolInput) {
    const bubble = createSpeechBubble(config.toolInput, config.currentCommand);
    bubble.x = 4.5 * px;
    bubble.y = indicatorY - 6 * px;
    container.addChild(bubble);
  }

  // Store metadata for animation
  const internals = container as unknown as AgentInternals;
  internals._agentConfig = config;
  internals._animFrame = 0;
  internals._body = body;
  internals._walkFrame = 0;
  internals._walkTimer = 0;
  internals._lastStatus = config.status;

  // Center the pivot
  container.pivot.set(4.5 * px, (5 + 4 + 3) * px);

  return container;
}

/** Add a status indicator above the agent's head (non-destructive — appends children) */
function _addStatusIndicator(container: Container, status: AgentStatus): void {
  const px = SCALE;
  const indicatorY = -4 * px;

  if (status === "reading") {
    const dot = new Graphics();
    dot.circle(4.5 * px, indicatorY, 2 * px);
    dot.fill(PALETTE.glowRead);
    dot.label = "__statusIndicator";
    container.addChild(dot);
  } else if (status === "writing") {
    const dot = new Graphics();
    dot.circle(4.5 * px, indicatorY, 2 * px);
    dot.fill(PALETTE.glowWrite);
    dot.label = "__statusIndicator";
    container.addChild(dot);
  } else if (status === "thinking") {
    const dots = new Graphics();
    dots.circle(4.5 * px, indicatorY, px);
    dots.fill(0xffffff);
    dots.circle(6 * px, indicatorY - 2 * px, px * 0.7);
    dots.fill(0xffffff);
    dots.circle(7 * px, indicatorY - 4 * px, px * 0.5);
    dots.fill(0xffffff);
    dots.label = "__statusIndicator";
    container.addChild(dots);
  } else if (status === "stuck") {
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
    excl.label = "__statusIndicator";
    container.addChild(excl);
  }
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
  const name = basename(s);
  return name.length > max ? name.slice(0, max - 2) + ".." : name;
}

// Walk cycle period in ms (400ms = ~12 frames at 30fps)
const WALK_CYCLE_MS = 400;
// Each of 4 frames lasts 100ms
const WALK_FRAME_MS = WALK_CYCLE_MS / 4;

// Stuck arm flail period
const STUCK_FLAP_MS = 300;

/** Animate agent — call each frame.
 *
 * @param container  The Container returned by createAgent()
 * @param time       Absolute time in ms (from ticker.lastTime)
 * @param dt         Delta time in ms since last frame
 */
export function updateAgent(container: Container, time: number, dt: number): void {
  const internals = container as unknown as AgentInternals;
  const config = internals._agentConfig;
  if (!config) return;

  const frame = (internals._animFrame || 0) + dt;
  internals._animFrame = frame;

  const status = config.status;
  const palette =
    PALETTE.agentPalettes[config.colorIndex % PALETTE.agentPalettes.length];
  const body = internals._body;

  // ---- Walk cycle (only for walking) ----
  if (status === "walking" || internals._isMoving) {
    internals._walkTimer = (internals._walkTimer || 0) + dt;
    const newWalkFrame = Math.floor(internals._walkTimer / WALK_FRAME_MS) % 4;

    if (newWalkFrame !== internals._walkFrame || internals._lastStatus !== status) {
      internals._walkFrame = newWalkFrame;
      drawBody(body, palette, status, newWalkFrame, false);
    }

    // Subtle vertical bob during walk
    container.y += Math.sin(frame * 0.15) * 0.3;

  } else if (status === "stuck") {
    // Arm flail animation — redraw body with alternating flap state
    internals._walkTimer = (internals._walkTimer || 0) + dt;
    const flapIndex = Math.floor(internals._walkTimer / STUCK_FLAP_MS) % 2;
    const stuckFlap = flapIndex === 1;

    // Redraw each flap change or on first status entry
    const prevFlap = (internals as any)._stuckFlap as boolean | undefined;
    if (stuckFlap !== prevFlap || internals._lastStatus !== status) {
      (internals as any)._stuckFlap = stuckFlap;
      drawBody(body, palette, status, 0, stuckFlap);
    }

    // Bounce upward
    container.y += Math.abs(Math.sin(frame * 0.1)) * -3;

  } else {
    // Non-animated statuses — redraw once on status change
    if (internals._lastStatus !== status) {
      drawBody(body, palette, status, 0, false);
      // Reset walk timer so next walk starts cleanly
      internals._walkTimer = 0;
      internals._walkFrame = 0;
    }

    // Idle sway
    if (status === "idle") {
      container.rotation = Math.sin(frame * 0.02) * 0.02;
    }

    // Thinking — gentle bob
    if (status === "thinking") {
      container.y += Math.sin(frame * 0.05) * 0.5;
    }
  }

  // Track last status for change detection
  internals._lastStatus = status;
}
