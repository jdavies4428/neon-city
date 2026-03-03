import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

export class SkyRenderer {
  container: Container;
  private stars: Star[] = [];
  private starGraphics: Graphics;
  private moonContainer: Container;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container = new Container();

    // Sky gradient background
    const bg = new Graphics();
    const skyHeight = height * 0.6;

    // Draw gradient manually with horizontal strips
    const strips = 30;
    for (let i = 0; i < strips; i++) {
      const t = i / strips;
      const r1 = (PALETTE.skyTop >> 16) & 0xff;
      const g1 = (PALETTE.skyTop >> 8) & 0xff;
      const b1 = PALETTE.skyTop & 0xff;
      const r2 = (PALETTE.skyBottom >> 16) & 0xff;
      const g2 = (PALETTE.skyBottom >> 8) & 0xff;
      const b2 = PALETTE.skyBottom & 0xff;

      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      const color = (r << 16) | (g << 8) | b;

      const stripH = skyHeight / strips;
      bg.rect(0, i * stripH, width, stripH + 1);
      bg.fill(color);
    }
    this.container.addChild(bg);

    // Generate stars
    this.starGraphics = new Graphics();
    const starCount = Math.floor((width * height) / 4000);
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * skyHeight * 0.8,
        size: Math.random() > 0.9 ? 2 : 1,
        brightness: 0.3 + Math.random() * 0.7,
        twinkleSpeed: 0.001 + Math.random() * 0.003,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
    this.container.addChild(this.starGraphics);

    // Moon
    this.moonContainer = new Container();
    const moonX = width * 0.8;
    const moonY = height * 0.12;

    // Moon glow
    const moonGlow = new Graphics();
    moonGlow.circle(0, 0, 40);
    moonGlow.fill({ color: PALETTE.moonGlow, alpha: 0.15 });
    moonGlow.circle(0, 0, 25);
    moonGlow.fill({ color: PALETTE.moonGlow, alpha: 0.1 });
    this.moonContainer.addChild(moonGlow);

    // Moon body
    const moon = new Graphics();
    moon.circle(0, 0, 14);
    moon.fill(PALETTE.moon);
    // Craters
    moon.circle(-4, -3, 3);
    moon.fill({ color: 0xddddbb, alpha: 0.7 });
    moon.circle(5, 2, 2);
    moon.fill({ color: 0xddddbb, alpha: 0.5 });
    this.moonContainer.addChild(moon);

    this.moonContainer.x = moonX;
    this.moonContainer.y = moonY;
    this.container.addChild(this.moonContainer);
  }

  update(time: number) {
    // Twinkle stars
    this.starGraphics.clear();
    for (const star of this.stars) {
      const alpha =
        star.brightness *
        (0.6 +
          0.4 * Math.sin(time * star.twinkleSpeed + star.twinklePhase));
      this.starGraphics.rect(star.x, star.y, star.size, star.size);
      this.starGraphics.fill({ color: PALETTE.stars, alpha });
    }

    // Gentle moon drift
    this.moonContainer.y += Math.sin(time * 0.0003) * 0.02;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}
