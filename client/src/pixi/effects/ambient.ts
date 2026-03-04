import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

// ─── Steam Vent ────────────────────────────────────

interface SteamParticle {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  alpha: number;
  life: number;
}

export class SteamVent {
  container: Container;
  private graphics: Graphics;
  private particles: SteamParticle[] = [];
  private spawnX: number;
  private spawnY: number;

  constructor(x: number, y: number) {
    this.spawnX = x;
    this.spawnY = y;
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    // Grate
    const grate = new Graphics();
    grate.rect(x - 4, y - 1, 8, 2);
    grate.fill(PALETTE.lampPost);
    grate.rect(x - 3, y - 1, 1, 2);
    grate.fill({ color: 0x000000, alpha: 0.5 });
    grate.rect(x, y - 1, 1, 2);
    grate.fill({ color: 0x000000, alpha: 0.5 });
    grate.rect(x + 3, y - 1, 1, 2);
    grate.fill({ color: 0x000000, alpha: 0.5 });
    this.container.addChild(grate);
  }

  update(dt: number) {
    // Spawn intermittently
    if (Math.random() < 0.15) {
      this.particles.push({
        x: this.spawnX + (Math.random() - 0.5) * 4,
        y: this.spawnY,
        vy: -0.4 - Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.2,
        size: 2 + Math.random() * 2,
        alpha: 0.2 + Math.random() * 0.1,
        life: 0,
      });
    }

    this.graphics.clear();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.vx += (Math.random() - 0.5) * 0.03;
      p.size += 0.03;
      p.alpha *= 0.98;
      p.life++;

      if (p.alpha < 0.02 || p.life > 80) {
        this.particles.splice(i, 1);
        continue;
      }

      this.graphics.circle(p.x, p.y, p.size);
      this.graphics.fill({ color: 0xaaaacc, alpha: p.alpha });
    }
  }
}

// ─── Pixel Cat ─────────────────────────────────────

export class PixelCat {
  container: Container;
  private catGraphics: Graphics;
  private tailPhase = Math.random() * Math.PI * 2;
  private blinkTimer = 0;
  private isBlinking = false;
  private sleeping = false;

  constructor(x: number, y: number) {
    this.container = new Container();
    this.container.x = x;
    this.container.y = y;

    this.catGraphics = new Graphics();
    this.container.addChild(this.catGraphics);

    this.draw(false, 0);
  }

  /** When sleeping=true, cat curls up with tail wrapped and eyes always closed */
  setSleeping(sleeping: boolean) {
    this.sleeping = sleeping;
  }

  private draw(blinking: boolean, tailAngle: number) {
    const g = this.catGraphics;
    g.clear();

    const c = 0x222244; // dark silhouette color

    if (this.sleeping) {
      // Curled sleeping pose: body sits lower, more compact
      // Curled body
      g.rect(0, 4, 9, 3);
      g.fill(c);

      // Head drooped lower
      g.rect(-1, 2, 5, 4);
      g.fill(c);

      // Ears (flatter, sleepier)
      g.rect(-1, 0, 2, 2);
      g.fill(c);
      g.rect(2, 0, 2, 2);
      g.fill(c);

      // Eyes always closed (sleeping)
      // no eye pixels drawn

      // Tail wrapped around body — curves back under rather than extending out
      const tx1 = 9 + Math.sin(tailAngle * 0.3) * 1;
      const ty1 = 6;
      const tx2 = 5 + Math.sin(tailAngle * 0.3 + 0.5) * 1;
      const ty2 = 8;

      g.moveTo(9, 5);
      g.lineTo(tx1, ty1);
      g.lineTo(tx2, ty2);
      g.stroke({ color: c, width: 1.5 });
    } else {
      // Normal awake pose
      // Body (lying down on rooftop)
      g.rect(0, 2, 10, 4);
      g.fill(c);

      // Head
      g.rect(-2, 0, 6, 5);
      g.fill(c);

      // Ears
      g.rect(-2, -2, 2, 2);
      g.fill(c);
      g.rect(2, -2, 2, 2);
      g.fill(c);

      // Eyes (unless blinking)
      if (!blinking) {
        g.rect(0, 1, 1, 1);
        g.fill(PALETTE.neonGreen);
        g.rect(3, 1, 1, 1);
        g.fill(PALETTE.neonGreen);
      }

      // Tail (animated)
      const tailX = 10;
      const tailY = 3;
      const tx1 = tailX + 4 + Math.sin(tailAngle) * 2;
      const ty1 = tailY - 2 + Math.cos(tailAngle) * 1;
      const tx2 = tx1 + 3 + Math.sin(tailAngle + 0.5) * 1;
      const ty2 = ty1 - 1;

      g.moveTo(tailX, tailY);
      g.lineTo(tx1, ty1);
      g.lineTo(tx2, ty2);
      g.stroke({ color: c, width: 1.5 });
    }
  }

  update(time: number) {
    // Slow tail sway when sleeping, normal speed when awake
    this.tailPhase += this.sleeping ? 0.005 : 0.02;

    if (this.sleeping) {
      // Always closed eyes when sleeping — draw immediately and skip blink logic
      this.draw(true, this.tailPhase);
      return;
    }

    // Blink every 3-6 seconds
    this.blinkTimer -= 1;
    if (this.blinkTimer <= 0) {
      this.isBlinking = !this.isBlinking;
      this.blinkTimer = this.isBlinking ? 5 : 100 + Math.random() * 100;
    }

    this.draw(this.isBlinking, this.tailPhase);
  }
}

// ─── Data Car / Packet ─────────────────────────────

interface CarState {
  x: number;
  speed: number;
  direction: 1 | -1;
  color: number;
  type: "sedan" | "truck" | "van";
}

export class TrafficSystem {
  container: Container;
  private graphics: Graphics;
  private cars: CarState[] = [];
  private width: number;
  private roadY: number;
  private spawnTimer = 0;
  private activityLevel: number = 0.5;
  private nextDirection: 1 | -1 = 1;

  constructor(width: number, roadY: number) {
    this.width = width;
    this.roadY = roadY;
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  update(dt: number) {
    // Spawn cars/packets occasionally
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2000 + Math.random() * 5000;
      this.spawnCar();
    }

    this.graphics.clear();

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      car.x += car.speed * car.direction * (dt / 16);

      // Remove if off screen
      if (car.x < -40 || car.x > this.width + 40) {
        this.cars.splice(i, 1);
        continue;
      }

      this.drawCar(car);
    }
  }

  /** 0-1 activity level: higher = faster cars, more spawns (max 8 at full activity) */
  setActivityLevel(level: number) {
    this.activityLevel = Math.max(0, Math.min(1, level));
  }

  private spawnCar() {
    // Scale max car count from 4 (idle) to 8 (full activity)
    const maxCars = Math.round(4 + this.activityLevel * 4);
    if (this.cars.length >= maxCars) return;

    // Alternate directions to guarantee both lanes are used
    const direction = this.nextDirection;
    this.nextDirection = direction === 1 ? -1 : 1;
    const accentColors = [PALETTE.neonBlue, PALETTE.neonPink, PALETTE.neonGreen, PALETTE.neonOrange, PALETTE.neonCyan];

    // Speed scales with activity: 0.5 multiplier at rest, up to 1.5x at full
    const baseSpeed = 0.5 + Math.random() * 0.8;
    const speedMultiplier = 0.5 + this.activityLevel;

    // Vehicle type: 50% sedan, 30% truck, 20% van
    const roll = Math.random();
    const type: CarState["type"] = roll < 0.5 ? "sedan" : roll < 0.8 ? "truck" : "van";

    // Trucks are slower
    const typeSpeedMul = type === "truck" ? 0.7 : type === "van" ? 0.85 : 1;

    this.cars.push({
      x: direction === 1 ? -30 : this.width + 30,
      speed: baseSpeed * speedMultiplier * typeSpeedMul,
      direction,
      color: accentColors[Math.floor(Math.random() * accentColors.length)],
      type,
    });
  }

  private drawCar(car: CarState) {
    const g = this.graphics;
    const y = car.direction === 1 ? this.roadY + 6 : this.roadY + 38;
    const d = car.direction;
    const x = car.x;

    if (car.type === "sedan") {
      // Body
      g.rect(x, y, 22, 9);
      g.fill(0x3a3a5a);
      // Roof
      g.rect(x + 5, y - 4, 12, 4);
      g.fill(0x3a3a5a);
      // Windows (dark tint)
      g.rect(x + 6, y - 3, 4, 3);
      g.fill({ color: car.color, alpha: 0.15 });
      g.rect(x + 11, y - 3, 5, 3);
      g.fill({ color: car.color, alpha: 0.15 });
      // Headlight
      g.rect(d === 1 ? x + 20 : x, y + 2, 3, 3);
      g.fill(PALETTE.lampLight);
      // Tail light
      g.rect(d === 1 ? x : x + 19, y + 2, 3, 3);
      g.fill(PALETTE.neonRed);
      // Wheels
      g.rect(x + 3, y + 9, 4, 3);
      g.fill(0x111111);
      g.rect(x + 15, y + 9, 4, 3);
      g.fill(0x111111);

    } else if (car.type === "truck") {
      // Cab (front section)
      const cabX = d === 1 ? x + 24 : x;
      g.rect(cabX, y - 4, 10, 13);
      g.fill(0x3a3a5a);
      // Cab roof
      g.rect(cabX + 1, y - 7, 8, 3);
      g.fill(0x3a3a5a);
      // Cab window
      g.rect(cabX + 2, y - 6, 6, 3);
      g.fill({ color: car.color, alpha: 0.15 });
      // Cargo box (rear section)
      const cargoX = d === 1 ? x : x + 10;
      g.rect(cargoX, y - 6, 24, 15);
      g.fill(0x2a2a48);
      // Cargo edge highlight
      g.rect(cargoX, y - 6, 24, 1);
      g.fill({ color: car.color, alpha: 0.2 });
      // Headlight
      g.rect(d === 1 ? x + 32 : x, y + 2, 3, 3);
      g.fill(PALETTE.lampLight);
      // Tail light
      g.rect(d === 1 ? x : x + 31, y + 2, 3, 3);
      g.fill(PALETTE.neonRed);
      // Wheels (3 axles)
      g.rect(x + 3, y + 9, 4, 3);
      g.fill(0x111111);
      g.rect(x + 14, y + 9, 4, 3);
      g.fill(0x111111);
      g.rect(x + 27, y + 9, 4, 3);
      g.fill(0x111111);

    } else {
      // Van — boxy, taller than sedan
      g.rect(x, y - 2, 26, 11);
      g.fill(0x3a3a5a);
      // Roof
      g.rect(x + 1, y - 5, 24, 3);
      g.fill(0x3a3a5a);
      // Front window
      const winX = d === 1 ? x + 18 : x + 2;
      g.rect(winX, y - 4, 6, 4);
      g.fill({ color: car.color, alpha: 0.15 });
      // Side windows (small)
      g.rect(x + 8, y - 4, 3, 3);
      g.fill({ color: car.color, alpha: 0.1 });
      g.rect(x + 13, y - 4, 3, 3);
      g.fill({ color: car.color, alpha: 0.1 });
      // Headlight
      g.rect(d === 1 ? x + 24 : x, y + 2, 3, 3);
      g.fill(PALETTE.lampLight);
      // Tail light
      g.rect(d === 1 ? x : x + 23, y + 2, 3, 3);
      g.fill(PALETTE.neonRed);
      // Wheels
      g.rect(x + 3, y + 9, 4, 3);
      g.fill(0x111111);
      g.rect(x + 19, y + 9, 4, 3);
      g.fill(0x111111);
    }
  }

  resize(width: number, roadY: number) {
    this.width = width;
    this.roadY = roadY;
  }
}
