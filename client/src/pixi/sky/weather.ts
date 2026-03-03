import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

export type WeatherState =
  | "clear"    // all tests pass — stars, moon bright
  | "fog"      // warnings — reduced visibility
  | "rain"     // test failures — drops + puddles + neon reflections
  | "storm"    // build broken — heavy rain + lightning
  | "snow"     // all agents idle — gentle drift
  | "aurora";  // deploy in progress — colorful sky bands

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: number;
}

export class WeatherSystem {
  container: Container;
  private graphics: Graphics;
  private overlayGraphics: Graphics; // for fog / flash
  private puddleGraphics: Graphics;
  private auroraGraphics: Graphics;
  private particles: Particle[] = [];
  private _state: WeatherState = "clear";
  private width: number;
  private height: number;
  private lightningTimer = 0;
  private lightningFlash = 0;
  private auroraPhase = 0;
  private transitionAlpha = 0; // for smooth state transitions
  private targetAlpha = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container = new Container();

    // Aurora layer (behind particles)
    this.auroraGraphics = new Graphics();
    this.container.addChild(this.auroraGraphics);

    // Main particle layer
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    // Puddle layer (on road surface)
    this.puddleGraphics = new Graphics();
    this.container.addChild(this.puddleGraphics);

    // Overlay layer (fog, lightning flash)
    this.overlayGraphics = new Graphics();
    this.container.addChild(this.overlayGraphics);
  }

  get state(): WeatherState {
    return this._state;
  }

  setState(newState: WeatherState) {
    if (newState === this._state) return;
    this._state = newState;
    // Gradually transition particles
    this.particles = [];
  }

  update(time: number, dt: number) {
    const roadY = this.height * 0.72;

    switch (this._state) {
      case "rain":
        this.updateRain(dt, roadY, false);
        break;
      case "storm":
        this.updateRain(dt, roadY, true);
        this.updateLightning(time, dt);
        break;
      case "snow":
        this.updateSnow(dt, roadY);
        break;
      case "fog":
        this.updateFog(dt);
        break;
      case "aurora":
        this.updateAurora(time);
        break;
      case "clear":
      default:
        this.clearEffects();
        break;
    }

    this.render(roadY);
  }

  // ─── Rain ────────────────────────────────────────────

  private updateRain(dt: number, roadY: number, heavy: boolean) {
    const spawnRate = heavy ? 12 : 5;
    const speed = heavy ? 14 : 9;

    // Spawn new drops
    for (let i = 0; i < spawnRate; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: -10,
        vx: heavy ? -1.5 + Math.random() * -1 : -0.8,
        vy: speed + Math.random() * 3,
        size: heavy ? 2 : 1,
        alpha: 0.3 + Math.random() * 0.3,
        life: 0,
        maxLife: 200,
        color: heavy ? 0x6688bb : 0x5577aa,
      });
    }

    // Update existing
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.life++;

      // Remove if past road or too old
      if (p.y > roadY + 40 || p.life > p.maxLife) {
        this.particles.splice(i, 1);

        // Splash at road level
        if (p.y >= roadY - 5 && Math.random() < 0.3) {
          this.spawnSplash(p.x, roadY + 2);
        }
      }
    }

    // Cap particles
    if (this.particles.length > 800) {
      this.particles.splice(0, this.particles.length - 800);
    }
  }

  private spawnSplash(x: number, y: number) {
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 2,
        size: 1,
        alpha: 0.4,
        life: 0,
        maxLife: 12,
        color: 0x88aacc,
      });
    }
  }

  // ─── Lightning ───────────────────────────────────────

  private updateLightning(time: number, dt: number) {
    this.lightningTimer -= dt;

    if (this.lightningTimer <= 0) {
      // Random interval between flashes (3-8 seconds)
      this.lightningTimer = 3000 + Math.random() * 5000;
      this.lightningFlash = 1.0;
    }

    // Decay flash
    if (this.lightningFlash > 0) {
      this.lightningFlash *= 0.85;
      if (this.lightningFlash < 0.02) this.lightningFlash = 0;
    }
  }

  // ─── Snow ────────────────────────────────────────────

  private updateSnow(dt: number, roadY: number) {
    // Gentle spawn rate
    if (Math.random() < 0.4) {
      this.particles.push({
        x: Math.random() * this.width,
        y: -5,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 0.5 + Math.random() * 1.2,
        size: Math.random() > 0.7 ? 3 : 2,
        alpha: 0.5 + Math.random() * 0.3,
        life: 0,
        maxLife: 600,
        color: 0xddddff,
      });
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      // Gentle sway
      p.vx += (Math.random() - 0.5) * 0.05;
      p.vx = Math.max(-1, Math.min(1, p.vx));

      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.life++;

      // Fade out near ground
      if (p.y > roadY) {
        p.alpha *= 0.95;
      }

      if (p.y > roadY + 30 || p.alpha < 0.05 || p.life > p.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    if (this.particles.length > 300) {
      this.particles.splice(0, this.particles.length - 300);
    }
  }

  // ─── Fog ─────────────────────────────────────────────

  private updateFog(dt: number) {
    // Fog doesn't use particles — just overlay opacity transitions
    this.targetAlpha = 0.25;
    this.transitionAlpha += (this.targetAlpha - this.transitionAlpha) * 0.01;
  }

  // ─── Aurora ──────────────────────────────────────────

  private updateAurora(time: number) {
    this.auroraPhase = time * 0.0004;
  }

  // ─── Clear ───────────────────────────────────────────

  private clearEffects() {
    this.particles = [];
    this.lightningFlash = 0;
    this.transitionAlpha *= 0.95;
  }

  // ─── Render ──────────────────────────────────────────

  private render(roadY: number) {
    this.graphics.clear();
    this.overlayGraphics.clear();
    this.puddleGraphics.clear();
    this.auroraGraphics.clear();

    // Draw particles
    for (const p of this.particles) {
      if (this._state === "snow") {
        // Snow: small circles
        this.graphics.circle(p.x, p.y, p.size * 0.5);
        this.graphics.fill({ color: p.color, alpha: p.alpha });
      } else {
        // Rain: angled lines
        this.graphics.moveTo(p.x, p.y);
        this.graphics.lineTo(p.x + p.vx * 1.5, p.y + p.size * 3);
        this.graphics.stroke({ color: p.color, width: 1, alpha: p.alpha });
      }
    }

    // Puddle reflections (rain/storm)
    if (this._state === "rain" || this._state === "storm") {
      this.drawPuddles(roadY);
    }

    // Lightning flash overlay
    if (this.lightningFlash > 0) {
      this.overlayGraphics.rect(0, 0, this.width, this.height);
      this.overlayGraphics.fill({ color: 0xccddff, alpha: this.lightningFlash * 0.6 });
    }

    // Fog overlay
    if (this._state === "fog" || this.transitionAlpha > 0.01) {
      const alpha = this._state === "fog" ? this.transitionAlpha : this.transitionAlpha;
      this.overlayGraphics.rect(0, 0, this.width, this.height * 0.8);
      this.overlayGraphics.fill({ color: 0x222244, alpha });
    }

    // Aurora bands
    if (this._state === "aurora") {
      this.drawAurora();
    }
  }

  private drawPuddles(roadY: number) {
    // Neon puddle reflections on the road surface
    const colors = [PALETTE.neonPink, PALETTE.neonBlue, PALETTE.neonGreen, PALETTE.neonCyan];
    const puddleCount = this._state === "storm" ? 8 : 5;

    for (let i = 0; i < puddleCount; i++) {
      // Deterministic placement based on index
      const px = ((i * 137 + 42) % this.width);
      const py = roadY + 5 + (i % 3) * 10;
      const pw = 15 + (i % 4) * 8;
      const ph = 2 + (i % 2);
      const color = colors[i % colors.length];

      // Puddle base
      this.puddleGraphics.ellipse(px, py, pw, ph);
      this.puddleGraphics.fill({ color: 0x111133, alpha: 0.5 });

      // Neon reflection in puddle
      const shimmer = 0.2 + Math.sin(this.auroraPhase * 2 + i * 1.3) * 0.1;
      this.puddleGraphics.ellipse(px, py, pw * 0.7, ph * 0.6);
      this.puddleGraphics.fill({ color, alpha: shimmer });
    }
  }

  private drawAurora() {
    const skyHeight = this.height * 0.4;
    const bandCount = 5;
    const colors = [0x40ff80, 0x40ddff, 0x8840ff, 0xff40aa, 0x4080ff];

    for (let b = 0; b < bandCount; b++) {
      const baseY = skyHeight * 0.1 + b * (skyHeight * 0.15);

      this.auroraGraphics.moveTo(0, baseY);

      // Wavy band
      for (let x = 0; x <= this.width; x += 8) {
        const wave1 = Math.sin(x * 0.008 + this.auroraPhase + b * 0.7) * 20;
        const wave2 = Math.sin(x * 0.003 + this.auroraPhase * 0.6 + b * 1.2) * 35;
        const y = baseY + wave1 + wave2;
        this.auroraGraphics.lineTo(x, y);
      }

      // Close the band shape
      this.auroraGraphics.lineTo(this.width, baseY + 40);
      for (let x = this.width; x >= 0; x -= 8) {
        const wave1 = Math.sin(x * 0.008 + this.auroraPhase + b * 0.7 + 0.5) * 15;
        const wave2 = Math.sin(x * 0.003 + this.auroraPhase * 0.6 + b * 1.2 + 0.3) * 25;
        const y = baseY + 30 + wave1 + wave2;
        this.auroraGraphics.lineTo(x, y);
      }
      this.auroraGraphics.closePath();

      const alpha = 0.06 + Math.sin(this.auroraPhase + b * 1.5) * 0.03;
      this.auroraGraphics.fill({ color: colors[b % colors.length], alpha });
    }
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}
