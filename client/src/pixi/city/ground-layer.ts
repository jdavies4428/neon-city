import { Container, Graphics } from "pixi.js";
import { PALETTE, DISTRICT_THEMES } from "../palette";

interface Puddle {
  x: number;
  y: number;
  rx: number;   // x-radius (half width)
  ry: number;   // y-radius (half height)
  color: number;
  baseAlpha: number;
  graphics: Graphics;
}

/**
 * GroundLayer draws the ground plane below the road:
 *   – A solid dark fill from the bottom of the road to the canvas edge
 *   – Subtle horizontal grating lines to break up the flat colour
 *   – Eight subway-grate rectangles rendered as crosshatch patterns
 *   – Ten small drain circles spread across the full 3200px world width
 *   – Ten puddle ellipses (one or two per district area) whose alpha shimmers
 *     each frame via a sine wave, giving the impression of neon reflections
 *
 * Everything except the puddle alpha is drawn once in the constructor.
 * The update() method only re-draws the puddle graphics.
 */
export class GroundLayer {
  container: Container;
  private puddles: Puddle[] = [];

  constructor(width: number, roadY: number, height: number) {
    this.container = new Container();

    // ── Ground fill ──────────────────────────────────────────────────────────
    // Covers everything from the bottom of the road surface to the canvas edge.
    // The road itself is drawn at roadY, is 85 px tall (road + car strip),
    // so we start at roadY + 85.
    const groundFill = new Graphics();
    groundFill.rect(0, roadY + 85, width, height - roadY - 85);
    groundFill.fill(0x060610);
    this.container.addChild(groundFill);

    // ── Horizontal grating lines ──────────────────────────────────────────────
    // Fine 1-px horizontal rules every 14 px to suggest a grid / pavement
    // texture without being distracting (alpha 0.25).
    const gratingGraphics = new Graphics();
    const gratingStart = roadY + 85;
    const gratingEnd = height;
    for (let y = gratingStart; y < gratingEnd; y += 14) {
      gratingGraphics.rect(0, y, width, 1);
      gratingGraphics.fill({ color: 0x0a0a18, alpha: 0.25 });
    }
    this.container.addChild(gratingGraphics);

    // ── Subway grate rectangles ───────────────────────────────────────────────
    // Eight grates evenly spread across the 3200px world width.
    // Each grate is a 10-column × 14-row crosshatch of alternating 2-px bars.
    const gratePositions = [0.08, 0.22, 0.36, 0.50, 0.63, 0.73, 0.84, 0.93];
    const grateGraphics = new Graphics();

    for (const frac of gratePositions) {
      const gx = Math.floor(width * frac);
      const gy = roadY + 89; // just below the road bottom edge

      // 10 columns × 14 rows, 2 px each, 2 px apart → total ~58 × 82 px
      const cellSize = 2;
      const cellGap = 2;
      const cols = 10;
      const rows = 14;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          // Alternating bars to form a crosshatch
          const isBar = (row + col) % 2 === 0;
          if (isBar) {
            grateGraphics.rect(
              gx + col * (cellSize + cellGap),
              gy + row * (cellSize + cellGap),
              cellSize,
              cellSize
            );
            grateGraphics.fill(0x040408);
          }
        }
      }
    }

    this.container.addChild(grateGraphics);

    // ── Drain circles ─────────────────────────────────────────────────────────
    // 10 small drain circles spread evenly across the full 3200px world width.
    const drainData: Array<{ xFrac: number; radius: number }> = [
      { xFrac: 0.04, radius: 2 },
      { xFrac: 0.14, radius: 3 },
      { xFrac: 0.25, radius: 2 },
      { xFrac: 0.34, radius: 3 },
      { xFrac: 0.44, radius: 2 },
      { xFrac: 0.55, radius: 3 },
      { xFrac: 0.64, radius: 2 },
      { xFrac: 0.74, radius: 3 },
      { xFrac: 0.84, radius: 2 },
      { xFrac: 0.94, radius: 3 },
    ];

    const drainGraphics = new Graphics();
    const drainY = roadY + 93;

    for (const d of drainData) {
      const dx = Math.floor(width * d.xFrac);
      drainGraphics.circle(dx, drainY, d.radius);
      drainGraphics.fill(0x040408);
    }

    this.container.addChild(drainGraphics);

    // ── Puddle ellipses ───────────────────────────────────────────────────────
    // Ten puddles spread across the full 3200px world — one or two per district
    // area plus extras between districts.  Colours are taken from the nearest
    // district's primary neon so they look like reflections on wet pavement.
    const puddleDefs: Array<{
      xFrac: number;
      rx: number;
      ry: number;
      color: number;
    }> = [
      { xFrac: 0.04,  rx: 14, ry: 2, color: DISTRICT_THEMES.studio.primary   },
      { xFrac: 0.10,  rx: 22, ry: 4, color: DISTRICT_THEMES.studio.primary   },
      { xFrac: 0.20,  rx: 18, ry: 3, color: PALETTE.neonBlue                 },
      { xFrac: 0.30,  rx: 25, ry: 5, color: DISTRICT_THEMES.library.primary  },
      { xFrac: 0.38,  rx: 20, ry: 3, color: DISTRICT_THEMES.library.primary  },
      { xFrac: 0.48,  rx: 18, ry: 3, color: PALETTE.neonBlue                 },
      { xFrac: 0.57,  rx: 22, ry: 4, color: DISTRICT_THEMES.qc.primary       },
      { xFrac: 0.66,  rx: 16, ry: 2, color: DISTRICT_THEMES.qc.primary       },
      { xFrac: 0.76,  rx: 20, ry: 3, color: DISTRICT_THEMES.workshop.primary },
      { xFrac: 0.88,  rx: 15, ry: 2, color: DISTRICT_THEMES.hq.primary       },
    ];

    const puddleBaseY = roadY + 99;

    for (const def of puddleDefs) {
      const px = Math.floor(width * def.xFrac);
      const py = puddleBaseY;

      const g = new Graphics();
      this.container.addChild(g);

      const puddle: Puddle = {
        x: px,
        y: py,
        rx: def.rx,
        ry: def.ry,
        color: def.color,
        baseAlpha: 0.06,
        graphics: g,
      };

      this.puddles.push(puddle);

      // Draw initial state
      this.drawPuddle(puddle, puddle.baseAlpha);
    }
  }

  private drawPuddle(puddle: Puddle, alpha: number) {
    puddle.graphics.clear();
    puddle.graphics.ellipse(puddle.x, puddle.y, puddle.rx, puddle.ry);
    puddle.graphics.fill({ color: puddle.color, alpha });
  }

  /**
   * Call every frame with a monotonically increasing timestamp (milliseconds).
   * Only the puddle shimmer is animated; all other geometry is static.
   */
  update(time: number) {
    for (let i = 0; i < this.puddles.length; i++) {
      const puddle = this.puddles[i];
      const shimmerAlpha =
        puddle.baseAlpha * (0.8 + 0.4 * Math.sin(time * 0.002 + i * 1.7));
      this.drawPuddle(puddle, shimmerAlpha);
    }
  }
}
