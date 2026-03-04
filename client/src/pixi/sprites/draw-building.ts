import { Graphics, Container, Text, TextStyle } from "pixi.js";
import { PALETTE, DISTRICT_THEMES, type DistrictType } from "../palette";

export interface BuildingConfig {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Number of window columns */
  windowCols: number;
  /** Number of window rows */
  windowRows: number;
  /** District type for theming */
  district: DistrictType;
  /** Label text (folder name) */
  label?: string;
  /** Which windows are lit (array of [col, row] indices) */
  litWindows?: Array<[number, number, "read" | "write" | "dim"]>;
}

/** Per-window animation state */
interface WindowAnimState {
  col: number;
  row: number;
  graphics: Graphics;
  lit: boolean;
  /** The color currently rendered into the Graphics object */
  renderedColor: number;
  /** Whether the window is in the process of transitioning to a new state */
  transitioning: boolean;
  /** 0.0 -> 1.0 alpha of the window Graphics */
  currentAlpha: number;
  /** Direction: -1 = fading out toward crossover, +1 = fading in after crossover */
  fadeDirection: number;
  /** The color to draw once the crossover (alpha=0) is reached */
  pendingColor: number;
  /** ms timestamp when the next random toggle should happen */
  nextToggleTime: number;
}

/** Fully animated building returned by createBuilding */
export interface AnimatedBuilding {
  container: Container;
  config: BuildingConfig;
  windowGraphics: Graphics[];
  windowStates: WindowAnimState[];
  roofDetails: Container;
  /** Internal: ref to the blinking antenna dot (may be null if no antenna) */
  _antennaDot: Graphics | null;
}

const WINDOW_SIZE = 6;
const WINDOW_GAP = 4;
const WINDOW_MARGIN = 8;

/** Pick an "on" color for a lit window */
function pickLitColor(): number {
  const r = Math.random();
  if (r < 0.70) return PALETTE.windowDim;   // 70%
  if (r < 0.90) return PALETTE.windowLit;   // 20%
  return PALETTE.windowWarm;                // 10%
}

/** Draw a window Graphics with a given color at position (wx, wy) relative to the building container */
function drawWindowGraphics(g: Graphics, wx: number, wy: number, color: number): void {
  g.clear();
  g.rect(wx, wy, WINDOW_SIZE, WINDOW_SIZE);
  g.fill(color);
}

/** Draw a single building procedurally, returning a fully animated AnimatedBuilding */
export function createBuilding(config: BuildingConfig): AnimatedBuilding {
  const container = new Container();
  const { width, height, windowCols, windowRows, district } = config;
  const theme = DISTRICT_THEMES[district];

  // -------------------------------------------------------------------------
  // Building body
  // -------------------------------------------------------------------------
  const body = new Graphics();

  // Main fill
  body.rect(0, 0, width, height);
  body.fill(PALETTE.buildingMid);

  // Left edge highlight
  body.rect(0, 0, 2, height);
  body.fill(PALETTE.buildingLight);

  // Right edge shadow
  body.rect(width - 2, 0, 2, height);
  body.fill(PALETTE.buildingDark);

  // Top edge
  body.rect(0, 0, width, 3);
  body.fill(PALETTE.buildingEdge);

  // Roof accent line in district color
  body.rect(0, 0, width, 2);
  body.fill(theme.primary);

  // Thin grey outline for visibility
  body.rect(0, 0, width, 1);
  body.fill({ color: 0x444466, alpha: 0.5 });
  body.rect(0, height - 1, width, 1);
  body.fill({ color: 0x444466, alpha: 0.5 });
  body.rect(0, 0, 1, height);
  body.fill({ color: 0x444466, alpha: 0.5 });
  body.rect(width - 1, 0, 1, height);
  body.fill({ color: 0x444466, alpha: 0.5 });

  container.addChild(body);

  // -------------------------------------------------------------------------
  // Windows — each is an individual Graphics for per-window animation
  // -------------------------------------------------------------------------
  const windowStartX =
    (width - (windowCols * (WINDOW_SIZE + WINDOW_GAP) - WINDOW_GAP)) / 2;
  const windowStartY = WINDOW_MARGIN;

  const windowGraphics: Graphics[] = [];
  const windowStates: WindowAnimState[] = [];

  const now = performance.now();

  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowCols; col++) {
      const wx = windowStartX + col * (WINDOW_SIZE + WINDOW_GAP);
      const wy = windowStartY + row * (WINDOW_SIZE + WINDOW_GAP);

      // Initial lighting: ~25% lit (windowDim), ~75% off
      const initiallyLit = Math.random() < 0.25;
      const initialColor = initiallyLit ? PALETTE.windowDim : PALETTE.windowOff;

      const g = new Graphics();
      drawWindowGraphics(g, wx, wy, initialColor);
      container.addChild(g);

      const state: WindowAnimState = {
        col,
        row,
        graphics: g,
        lit: initiallyLit,
        renderedColor: initialColor,
        transitioning: false,
        currentAlpha: 1.0,
        fadeDirection: 1,
        pendingColor: initialColor,
        // Stagger initial toggle times: 2s - 12s from now
        nextToggleTime: now + 2000 + Math.random() * 10000,
      };

      windowGraphics.push(g);
      windowStates.push(state);
    }
  }

  // -------------------------------------------------------------------------
  // Door at bottom center
  // -------------------------------------------------------------------------
  const doorWidth = 8;
  const doorHeight = 12;
  const doorX = (width - doorWidth) / 2;
  const doorY = height - doorHeight;
  const door = new Graphics();
  door.rect(doorX, doorY, doorWidth, doorHeight);
  door.fill(PALETTE.buildingDark);
  // Door frame in district color
  door.rect(doorX - 1, doorY - 1, doorWidth + 2, 1);
  door.fill(theme.primary);
  container.addChild(door);

  // -------------------------------------------------------------------------
  // Roof details container (populated by addRoofDetails)
  // -------------------------------------------------------------------------
  const roofDetails = new Container();
  container.addChild(roofDetails);

  const building: AnimatedBuilding = {
    container,
    config,
    windowGraphics,
    windowStates,
    roofDetails,
    _antennaDot: null,
  };

  return building;
}

/**
 * Update per-window animation. Call each frame from your render loop.
 *
 * @param building       The AnimatedBuilding returned by createBuilding
 * @param time           Current elapsed time in ms (e.g. ticker.lastTime)
 * @param dt             Frame delta in ms (e.g. ticker.deltaMS)
 * @param activityLevel  0.0 (very quiet) to 1.0 (very busy)
 */
export function updateBuilding(
  building: AnimatedBuilding,
  time: number,
  dt: number,
  activityLevel: number
): void {
  const targetLitProb = 0.15 + activityLevel * 0.6;

  for (const state of building.windowStates) {
    const g = state.graphics;

    if (!state.transitioning) {
      // Check if it's time to toggle this window
      if (time > state.nextToggleTime) {
        // Decide new lit state
        const willBeLit = Math.random() < targetLitProb;
        const newColor = willBeLit ? pickLitColor() : PALETTE.windowOff;

        if (newColor !== state.renderedColor) {
          // Start fade-out toward crossover point
          state.transitioning = true;
          state.fadeDirection = -1;
          state.pendingColor = newColor;
          state.lit = willBeLit;
        }

        // Schedule next toggle regardless (3-13 seconds from now)
        state.nextToggleTime = time + 3000 + Math.random() * 10000;
      }
    } else {
      // Mid-transition: fade out then fade in
      const step = 0.004 * dt;

      if (state.fadeDirection === -1) {
        // Fading out
        state.currentAlpha -= step;
        if (state.currentAlpha <= 0) {
          // Crossover: redraw with pending color, start fading in
          state.currentAlpha = 0;
          state.renderedColor = state.pendingColor;

          // Find window position from the Graphics bounds
          // We stored position implicitly — reuse the same wx/wy from initial draw.
          // Re-derive from col/row rather than storing extra data.
          const wx =
            (building.config.width -
              (building.config.windowCols * (WINDOW_SIZE + WINDOW_GAP) - WINDOW_GAP)) /
              2 +
            state.col * (WINDOW_SIZE + WINDOW_GAP);
          const wy = WINDOW_MARGIN + state.row * (WINDOW_SIZE + WINDOW_GAP);
          drawWindowGraphics(g, wx, wy, state.renderedColor);

          state.fadeDirection = 1;
        }
      } else {
        // Fading in
        state.currentAlpha += step;
        if (state.currentAlpha >= 1.0) {
          state.currentAlpha = 1.0;
          state.transitioning = false;
        }
      }

      g.alpha = state.currentAlpha;
    }
  }
}

/**
 * Add procedural roof decorations to a building. Call once after createBuilding.
 * Decorations are added to building.roofDetails Container (already a child of building.container).
 *
 * @param building  The AnimatedBuilding to decorate
 * @param time      Current time in ms (used to seed initial blink phase)
 */
export function addRoofDetails(building: AnimatedBuilding, time: number): void {
  const { config, roofDetails } = building;
  const { width, height } = config;

  // Roof details sit above the building top edge (y=0 in building space).
  // We position items at negative y values relative to building.container origin.
  // The roofDetails container itself sits at y=0 so children use building-local coords.

  // ------ Antenna (~40% chance) ------
  if (Math.random() < 0.4) {
    const antennaX = Math.floor(width * 0.3);
    const antennaHeight = 8;

    const antenna = new Graphics();
    // Thin 1px-wide pole
    antenna.rect(antennaX, -antennaHeight, 1, antennaHeight);
    antenna.fill(PALETTE.buildingEdge);
    roofDetails.addChild(antenna);

    // Red blinking dot at the very top
    const dot = new Graphics();
    dot.circle(antennaX, -antennaHeight - 1, 1);
    dot.fill(0xff4040);
    roofDetails.addChild(dot);

    // Seed blink phase so not all antennas blink in sync
    (dot as any)._blinkOffset = Math.floor(Math.random() * 2); // 0 or 1
    building._antennaDot = dot;
  }

  // ------ AC Unit (~30% chance) ------
  if (Math.random() < 0.3) {
    const acX = Math.floor(width * 0.7);
    const acW = 6;
    const acH = 4;

    const ac = new Graphics();
    // Main body
    ac.rect(acX, -acH, acW, acH);
    ac.fill(0x0c0c1e);
    // 1px lighter border (top + sides, skip bottom which is flush with roof)
    ac.rect(acX, -acH, acW, 1);
    ac.fill(PALETTE.buildingEdge);
    ac.rect(acX, -acH, 1, acH);
    ac.fill(PALETTE.buildingEdge);
    ac.rect(acX + acW - 1, -acH, 1, acH);
    ac.fill(PALETTE.buildingEdge);
    // Small vent on top (2x1 centered)
    ac.rect(acX + 2, -acH - 1, 2, 1);
    ac.fill(PALETTE.buildingDark);

    roofDetails.addChild(ac);
  }

  // ------ Satellite Dish (~15% on tall buildings, height > 100) ------
  if (height > 100 && Math.random() < 0.15) {
    const dishX = Math.floor(width * 0.5);

    const dish = new Graphics();
    // Step-pattern approximating a small dish: two rects arranged as an arc
    // Bottom-left: wider
    dish.rect(dishX - 2, -5, 4, 2);
    dish.fill(PALETTE.buildingLight);
    // Top-right: narrower, offset to suggest curvature
    dish.rect(dishX, -7, 2, 2);
    dish.fill(PALETTE.buildingLight);
    // Stem
    dish.rect(dishX, -3, 1, 3);
    dish.fill(PALETTE.buildingEdge);

    roofDetails.addChild(dish);
  }

  // Suppress unused-param warning — time param is available for callers who
  // want deterministic seeding in tests but we use Math.random() here.
  void time;
}

/**
 * Animate roof details each frame. Call from your render loop.
 *
 * @param building  The AnimatedBuilding with roof details already added
 * @param time      Current elapsed time in ms
 */
export function updateRoofDetails(building: AnimatedBuilding, time: number): void {
  if (!building._antennaDot) return;

  const dot = building._antennaDot;
  const blinkOffset: number = (dot as any)._blinkOffset ?? 0;

  // Visible for 1.5 s, invisible for 1.5 s
  const cycle = Math.floor(time / 1500) % 2;
  dot.visible = (cycle + blinkOffset) % 2 === 0;
}

// ---------------------------------------------------------------------------
// Neon sign helpers (preserved from original)
// ---------------------------------------------------------------------------

/** Create a neon sign that flickers */
export function createNeonSign(
  text: string,
  color: number,
  fontSize = 10
): Container {
  const container = new Container();

  const style = new TextStyle({
    fontFamily: '"Press Start 2P", monospace',
    fontSize,
    fill: color,
    align: "center",
  });

  const label = new Text({ text: text.toUpperCase(), style });
  label.anchor.set(0.5, 0.5);

  // Glow backing
  const glow = new Text({ text: text.toUpperCase(), style: { ...style, fill: color } });
  glow.anchor.set(0.5, 0.5);
  glow.alpha = 0.4;
  glow.scale.set(1.1);

  container.addChild(glow);
  container.addChild(label);

  // Store refs for animation
  (container as any)._neonLabel = label;
  (container as any)._neonGlow = glow;
  (container as any)._neonPhase = Math.random() * Math.PI * 2;

  return container;
}

/** Call each frame to animate neon flicker */
export function updateNeonSign(container: Container, time: number) {
  const label = (container as any)._neonLabel as Text;
  const glow = (container as any)._neonGlow as Text;
  const phase = (container as any)._neonPhase as number;

  if (!label || !glow) return;

  // Gentle flicker
  const flicker =
    0.85 +
    Math.sin(time * 0.003 + phase) * 0.1 +
    Math.sin(time * 0.007 + phase * 2) * 0.05;

  label.alpha = flicker;
  glow.alpha = flicker * 0.4;

  // Occasional hard flicker
  if (Math.random() < 0.002) {
    label.alpha = 0.3;
    glow.alpha = 0.1;
  }
}
