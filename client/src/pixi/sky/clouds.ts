import { Container, Graphics } from "pixi.js";

interface Cloud {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  alpha: number;
  segments: Array<{ ox: number; oy: number; rx: number; ry: number }>;
}

/**
 * Parallax cloud layer — multiple depth layers scrolling at different speeds.
 * Clouds are drawn procedurally as soft pixel-art blobs.
 */
export class CloudLayer {
  container: Container;
  private clouds: Cloud[] = [];
  private graphics: Graphics;
  private screenWidth: number;
  private screenHeight: number;
  private _opacity = 1; // multiplier for fog/clear transitions

  constructor(width: number, height: number) {
    this.screenWidth = width;
    this.screenHeight = height;
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    this.generateClouds();
  }

  private _isDay = false;

  set opacity(v: number) {
    this._opacity = Math.max(0, Math.min(1, v));
  }

  /** Switch cloud color between night (blue-gray) and day (white). */
  setDaytime(isDay: boolean) {
    this._isDay = isDay;
  }

  private generateClouds() {
    const skyH = this.screenHeight * 0.55;

    // Three depth layers: far, mid, near
    const layers = [
      { count: 4, minY: 10, maxY: skyH * 0.3, speed: 0.08, alphaBase: 0.04, sizeScale: 0.6 },
      { count: 3, minY: skyH * 0.15, maxY: skyH * 0.5, speed: 0.15, alphaBase: 0.06, sizeScale: 0.8 },
      { count: 2, minY: skyH * 0.3, maxY: skyH * 0.65, speed: 0.25, alphaBase: 0.08, sizeScale: 1 },
    ];

    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const w = (60 + Math.random() * 80) * layer.sizeScale;
        const h = (12 + Math.random() * 16) * layer.sizeScale;

        // Build cloud shape from overlapping ellipses
        const segCount = 3 + Math.floor(Math.random() * 3);
        const segments: Cloud["segments"] = [];
        for (let s = 0; s < segCount; s++) {
          segments.push({
            ox: (s / segCount - 0.5) * w * 0.8 + (Math.random() - 0.5) * 10,
            oy: (Math.random() - 0.5) * h * 0.3,
            rx: w * (0.3 + Math.random() * 0.25),
            ry: h * (0.5 + Math.random() * 0.3),
          });
        }

        this.clouds.push({
          x: Math.random() * (this.screenWidth + w * 2) - w,
          y: layer.minY + Math.random() * (layer.maxY - layer.minY),
          width: w,
          height: h,
          speed: layer.speed + Math.random() * 0.05,
          alpha: layer.alphaBase + Math.random() * 0.02,
          segments,
        });
      }
    }
  }

  update(dt: number) {
    this.graphics.clear();

    for (const cloud of this.clouds) {
      // Scroll
      cloud.x += cloud.speed * (dt / 16);

      // Wrap around
      if (cloud.x > this.screenWidth + cloud.width) {
        cloud.x = -cloud.width * 2;
      }

      // Draw cloud segments
      const alpha = cloud.alpha * this._opacity;
      if (alpha < 0.005) continue;

      for (const seg of cloud.segments) {
        this.graphics.ellipse(
          cloud.x + seg.ox,
          cloud.y + seg.oy,
          seg.rx,
          seg.ry
        );
        const cloudColor = this._isDay ? 0xddddee : 0x8888bb;
        const dayAlpha = this._isDay ? alpha * 3 : alpha; // Clouds more visible during day
        this.graphics.fill({ color: cloudColor, alpha: dayAlpha });
      }
    }
  }

  resize(width: number, height: number) {
    this.screenWidth = width;
    this.screenHeight = height;
  }
}
