import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

interface SilhouetteBuilding {
  x: number;
  width: number;
  height: number;
  hasAntenna: boolean;
  antennaHeight: number;
  hasDish: boolean;
  windows: Array<{ ox: number; oy: number }>;
}

interface ParallaxLayer {
  container: Container;
  graphics: Graphics;
  buildings: SilhouetteBuilding[];
  color: number;
  scrollSpeed: number;
  totalWidth: number;
  offsetX: number;
}

/**
 * BackgroundCity draws two distant parallax silhouette layers behind the
 * foreground city.  The far layer is very faint and slow; the mid layer is
 * slightly brighter and faster.  Both tile seamlessly when they scroll past
 * their generated width so the backdrop never shows empty sky.
 */
export class BackgroundCity {
  container: Container;
  private farLayer: ParallaxLayer;
  private midLayer: ParallaxLayer;
  private roadY: number;
  private isDay = false;
  private farNightColor = 0x12122a;
  private midNightColor = 0x161638;
  private farDayColor = 0x3a5580;
  private midDayColor = 0x2a4466;

  constructor(width: number, height: number, roadY: number) {
    this.roadY = roadY;
    this.container = new Container();

    // We generate 2× the canvas width so one full copy is always visible
    // while the other is waiting off-screen to wrap into place.
    const tileWidth = width * 2;

    this.farLayer = this.createLayer({
      buildingCount: 40,
      minHeight: 60,
      maxHeight: 180,
      minWidth: 15,
      maxWidth: 35,
      minGap: 5,
      maxGap: 15,
      color: 0x12122a,
      baseAlpha: 0.45,
      scrollSpeed: 0,
      tileWidth,
      seed: width * 7,
    });

    this.midLayer = this.createLayer({
      buildingCount: 25,
      minHeight: 100,
      maxHeight: 250,
      minWidth: 20,
      maxWidth: 40,
      minGap: 5,
      maxGap: 15,
      color: 0x161638,
      baseAlpha: 0.55,
      scrollSpeed: 0,
      tileWidth,
      seed: width * 13,
    });

    this.container.addChild(this.farLayer.container);
    this.container.addChild(this.midLayer.container);

    this.drawLayer(this.farLayer);
    this.drawLayer(this.midLayer);
  }

  /** Switch between night and day silhouette colors. */
  setDaytime(isDay: boolean) {
    if (this.isDay === isDay) return;
    this.isDay = isDay;
    this.farLayer.color = isDay ? this.farDayColor : this.farNightColor;
    this.midLayer.color = isDay ? this.midDayColor : this.midNightColor;
    // Increase alpha slightly during day for better contrast against bright sky
    this.farLayer.container.alpha = isDay ? 0.6 : 0.45;
    this.midLayer.container.alpha = isDay ? 0.7 : 0.55;
    this.drawLayer(this.farLayer);
    this.drawLayer(this.midLayer);
  }

  /** Simple deterministic pseudo-random number generator (LCG). */
  private lcg(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (Math.imul(1664525, s) + 1013904223) | 0;
      return (s >>> 0) / 0xffffffff;
    };
  }

  private createLayer(opts: {
    buildingCount: number;
    minHeight: number;
    maxHeight: number;
    minWidth: number;
    maxWidth: number;
    minGap: number;
    maxGap: number;
    color: number;
    baseAlpha: number;
    scrollSpeed: number;
    tileWidth: number;
    seed: number;
  }): ParallaxLayer {
    const rand = this.lcg(opts.seed);
    const buildings: SilhouetteBuilding[] = [];

    let cursorX = 0;
    for (let i = 0; i < opts.buildingCount; i++) {
      const bw = Math.floor(opts.minWidth + rand() * (opts.maxWidth - opts.minWidth + 1));
      const bh = Math.floor(opts.minHeight + rand() * (opts.maxHeight - opts.minHeight + 1));
      const gap = Math.floor(opts.minGap + rand() * (opts.maxGap - opts.minGap + 1));

      const hasAntenna = rand() < 0.15;
      const antennaHeight = hasAntenna ? Math.floor(6 + rand() * 5) : 0; // 6–10 px

      const hasDish = rand() < 0.10;

      // 0–3 lit window dots per building
      const windowCount = Math.floor(rand() * 4); // 0, 1, 2, or 3
      const windows: Array<{ ox: number; oy: number }> = [];
      for (let w = 0; w < windowCount; w++) {
        windows.push({
          ox: Math.floor(rand() * Math.max(1, bw - 4)),
          oy: Math.floor(rand() * Math.max(1, bh - 4)),
        });
      }

      buildings.push({
        x: cursorX,
        width: bw,
        height: bh,
        hasAntenna,
        antennaHeight,
        hasDish,
        windows,
      });

      cursorX += bw + gap;
    }

    const container = new Container();
    container.alpha = opts.baseAlpha;

    const graphics = new Graphics();
    container.addChild(graphics);

    return {
      container,
      graphics,
      buildings,
      color: opts.color,
      scrollSpeed: opts.scrollSpeed,
      totalWidth: cursorX,
      offsetX: 0,
    };
  }

  private drawLayer(layer: ParallaxLayer) {
    const g = layer.graphics;
    g.clear();

    for (const b of layer.buildings) {
      const bx = b.x + layer.offsetX;
      const by = this.roadY - b.height;

      // Main building silhouette
      g.rect(bx, by, b.width, b.height);
      g.fill(layer.color);

      // Antenna spike — 1px wide rect centered on roof
      if (b.hasAntenna) {
        const ax = bx + Math.floor(b.width / 2);
        g.rect(ax, by - b.antennaHeight, 1, b.antennaHeight);
        g.fill(layer.color);
      }

      // Satellite dish outline — small 3x2 rect near roofline
      if (b.hasDish) {
        const dx = bx + Math.floor(b.width * 0.65);
        const dy = by + 2;
        g.rect(dx, dy, 3, 2);
        g.fill(layer.color);
      }

      // Dim lit windows — 2x2 rects with a slightly brighter color
      for (const win of b.windows) {
        g.rect(bx + win.ox, by + win.oy, 2, 2);
        g.fill({ color: PALETTE.windowDim, alpha: 0.6 });
      }
    }

    // Draw a second copy offset by totalWidth so the tile seam is invisible
    for (const b of layer.buildings) {
      const bx = b.x + layer.offsetX + layer.totalWidth;
      const by = this.roadY - b.height;

      g.rect(bx, by, b.width, b.height);
      g.fill(layer.color);

      if (b.hasAntenna) {
        const ax = bx + Math.floor(b.width / 2);
        g.rect(ax, by - b.antennaHeight, 1, b.antennaHeight);
        g.fill(layer.color);
      }

      if (b.hasDish) {
        const dx = bx + Math.floor(b.width * 0.65);
        const dy = by + 2;
        g.rect(dx, dy, 3, 2);
        g.fill(layer.color);
      }

      for (const win of b.windows) {
        g.rect(bx + win.ox, by + win.oy, 2, 2);
        g.fill({ color: PALETTE.windowDim, alpha: 0.6 });
      }
    }
  }

  /** Called every frame.  dt is deltaMS from the Pixi ticker. */
  update(dt: number) {
    const scale = dt / 16; // normalise to ~60 fps

    for (const layer of [this.farLayer, this.midLayer]) {
      layer.offsetX -= layer.scrollSpeed * scale;

      // Wrap: once the left copy has scrolled a full tile off the left edge,
      // snap back by one tile so it's seamless.
      if (layer.offsetX <= -layer.totalWidth) {
        layer.offsetX += layer.totalWidth;
      }

      this.drawLayer(layer);
    }
  }
}
