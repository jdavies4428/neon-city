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

const WINDOW_SIZE = 6;
const WINDOW_GAP = 4;
const WINDOW_MARGIN = 8;

/** Draw a single building procedurally */
export function createBuilding(config: BuildingConfig): Container {
  const container = new Container();
  const { width, height, windowCols, windowRows, district } = config;
  const theme = DISTRICT_THEMES[district];

  // Building body
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

  container.addChild(body);

  // Windows
  const windowStartX =
    (width - (windowCols * (WINDOW_SIZE + WINDOW_GAP) - WINDOW_GAP)) / 2;
  const windowStartY = WINDOW_MARGIN;

  const litMap = new Map<string, "read" | "write" | "dim">();
  if (config.litWindows) {
    for (const [c, r, type] of config.litWindows) {
      litMap.set(`${c},${r}`, type);
    }
  }

  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowCols; col++) {
      const wx = windowStartX + col * (WINDOW_SIZE + WINDOW_GAP);
      const wy = windowStartY + row * (WINDOW_SIZE + WINDOW_GAP);

      const win = new Graphics();
      const key = `${col},${row}`;
      const litType = litMap.get(key);

      let color: number;
      if (litType === "read") {
        color = PALETTE.glowRead;
      } else if (litType === "write") {
        color = PALETTE.glowWrite;
      } else if (litType === "dim") {
        color = PALETTE.windowLit;
      } else {
        // Random: ~30% chance of being dimly lit
        color =
          Math.random() > 0.7 ? PALETTE.windowDim : PALETTE.windowOff;
      }

      win.rect(wx, wy, WINDOW_SIZE, WINDOW_SIZE);
      win.fill(color);

      // Window glow effect for lit windows
      if (litType === "read" || litType === "write") {
        const glow = new Graphics();
        glow.rect(wx - 1, wy - 1, WINDOW_SIZE + 2, WINDOW_SIZE + 2);
        glow.fill({ color: color, alpha: 0.3 });
        container.addChild(glow);
      }

      container.addChild(win);
    }
  }

  // Door at bottom center
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

  // Label below building
  if (config.label) {
    const style = new TextStyle({
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 7,
      fill: theme.primary,
      align: "center",
    });
    const label = new Text({ text: config.label, style });
    label.anchor.set(0.5, 0);
    label.x = width / 2;
    label.y = height + 4;
    container.addChild(label);
  }

  return container;
}

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
  const flicker = 0.85 + Math.sin(time * 0.003 + phase) * 0.1 +
    Math.sin(time * 0.007 + phase * 2) * 0.05;

  label.alpha = flicker;
  glow.alpha = flicker * 0.4;

  // Occasional hard flicker
  if (Math.random() < 0.002) {
    label.alpha = 0.3;
    glow.alpha = 0.1;
  }
}
