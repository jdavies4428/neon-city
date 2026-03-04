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
  private sunContainer: Container;
  private skyBg: Graphics;
  private width: number;
  private height: number;
  private isDay: boolean = false;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container = new Container();

    // Sky gradient background — kept as a class field so we can redraw it
    this.skyBg = new Graphics();
    this.drawSkyGradient(false);
    this.container.addChild(this.skyBg);

    // Generate stars
    this.starGraphics = new Graphics();
    const skyHeight = height * 0.6;
    const starCount = Math.floor((width * height) / 4000);
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * (width + 200) - 100,
        y: Math.random() * (skyHeight + 400) - 400,
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

    const moonGlow = new Graphics();
    moonGlow.circle(0, 0, 60);
    moonGlow.fill({ color: PALETTE.moonGlow, alpha: 0.12 });
    moonGlow.circle(0, 0, 40);
    moonGlow.fill({ color: PALETTE.moonGlow, alpha: 0.1 });
    this.moonContainer.addChild(moonGlow);

    const moon = new Graphics();
    moon.circle(0, 0, 22);
    moon.fill(PALETTE.moon);
    // Craters
    moon.circle(-6, -5, 4);
    moon.fill({ color: 0xddddbb, alpha: 0.7 });
    moon.circle(8, 3, 3);
    moon.fill({ color: 0xddddbb, alpha: 0.5 });
    moon.circle(-2, 6, 2);
    moon.fill({ color: 0xddddbb, alpha: 0.4 });
    this.moonContainer.addChild(moon);

    this.moonContainer.x = moonX;
    this.moonContainer.y = moonY;
    this.container.addChild(this.moonContainer);

    // Sun — positioned in the upper-right quadrant, starts hidden
    this.sunContainer = new Container();
    const sunX = width * 0.75;
    const sunY = height * 0.1;

    const sunGlow = new Graphics();
    sunGlow.circle(0, 0, 50);
    sunGlow.fill({ color: PALETTE.sunGlow, alpha: 0.2 });
    sunGlow.circle(0, 0, 30);
    sunGlow.fill({ color: PALETTE.sunGlow, alpha: 0.15 });
    this.sunContainer.addChild(sunGlow);

    const sun = new Graphics();
    sun.circle(0, 0, 16);
    sun.fill(PALETTE.sunColor);
    this.sunContainer.addChild(sun);

    this.sunContainer.x = sunX;
    this.sunContainer.y = sunY;
    this.sunContainer.visible = false;
    this.container.addChild(this.sunContainer);
  }

  /** Redraw the sky gradient for the given mode. */
  private drawSkyGradient(isDay: boolean) {
    this.skyBg.clear();
    const skyHeight = this.height * 0.6;
    const strips = 30;

    const topColor = isDay ? PALETTE.skyDayTop : PALETTE.skyTop;
    const bottomColor = isDay ? PALETTE.skyDayBottom : PALETTE.skyBottom;

    // Fill above the gradient with the top color — visible when camera is
    // zoomed/panned to show area above y=0 (prevents black gap at top).
    this.skyBg.rect(-300, -800, this.width + 600, 800);
    this.skyBg.fill(topColor);

    for (let i = 0; i < strips; i++) {
      const t = i / strips;
      const r1 = (topColor >> 16) & 0xff;
      const g1 = (topColor >> 8) & 0xff;
      const b1 = topColor & 0xff;
      const r2 = (bottomColor >> 16) & 0xff;
      const g2 = (bottomColor >> 8) & 0xff;
      const b2 = bottomColor & 0xff;

      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      const color = (r << 16) | (g << 8) | b;

      const stripH = skyHeight / strips;
      this.skyBg.rect(-300, i * stripH, this.width + 600, stripH + 1);
      this.skyBg.fill(color);
    }

    // Fill below gradient with bottom color (covers rest of visible world)
    this.skyBg.rect(-300, skyHeight, this.width + 600, this.height * 2);
    this.skyBg.fill(bottomColor);
  }

  /** Switch between night mode (default) and day mode. */
  setDaytime(isDay: boolean) {
    if (this.isDay === isDay) return;
    this.isDay = isDay;

    this.drawSkyGradient(isDay);
    this.starGraphics.visible = !isDay;
    this.moonContainer.visible = !isDay;
    this.sunContainer.visible = isDay;
  }

  update(time: number) {
    // Twinkle stars (only when visible)
    if (!this.isDay) {
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
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}
