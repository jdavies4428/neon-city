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

  constructor(x: number, y: number) {
    this.container = new Container();
    this.container.x = x;
    this.container.y = y;

    this.catGraphics = new Graphics();
    this.container.addChild(this.catGraphics);

    this.draw(false, 0);
  }

  private draw(blinking: boolean, tailAngle: number) {
    const g = this.catGraphics;
    g.clear();

    const c = 0x222244; // dark silhouette color

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

  update(time: number) {
    this.tailPhase += 0.02;

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
  type: "car" | "packet";
}

export class TrafficSystem {
  container: Container;
  private graphics: Graphics;
  private cars: CarState[] = [];
  private width: number;
  private roadY: number;
  private spawnTimer = 0;

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
      if (car.x < -30 || car.x > this.width + 30) {
        this.cars.splice(i, 1);
        continue;
      }

      this.drawCar(car);
    }
  }

  private spawnCar() {
    if (this.cars.length >= 4) return;

    const direction: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
    const colors = [PALETTE.neonBlue, PALETTE.neonPink, PALETTE.neonGreen, PALETTE.neonOrange, PALETTE.neonCyan];
    const isPacket = Math.random() > 0.5;

    this.cars.push({
      x: direction === 1 ? -20 : this.width + 20,
      speed: 0.5 + Math.random() * 0.8,
      direction,
      color: colors[Math.floor(Math.random() * colors.length)],
      type: isPacket ? "packet" : "car",
    });
  }

  private drawCar(car: CarState) {
    const y = car.direction === 1 ? this.roadY + 8 : this.roadY + 26;

    if (car.type === "car") {
      // Pixel car body
      this.graphics.rect(car.x, y, 14, 6);
      this.graphics.fill(0x1a1a33);

      // Roof
      this.graphics.rect(car.x + 3, y - 3, 8, 3);
      this.graphics.fill(0x1a1a33);

      // Headlight
      const hlX = car.direction === 1 ? car.x + 13 : car.x;
      this.graphics.rect(hlX, y + 1, 2, 2);
      this.graphics.fill(PALETTE.lampLight);

      // Tail light
      const tlX = car.direction === 1 ? car.x : car.x + 12;
      this.graphics.rect(tlX, y + 1, 2, 2);
      this.graphics.fill(PALETTE.neonRed);

      // Wheels
      this.graphics.rect(car.x + 2, y + 6, 3, 2);
      this.graphics.fill(0x111111);
      this.graphics.rect(car.x + 9, y + 6, 3, 2);
      this.graphics.fill(0x111111);
    } else {
      // Data packet — small glowing box
      this.graphics.rect(car.x, y + 1, 6, 4);
      this.graphics.fill({ color: car.color, alpha: 0.8 });

      // Glow trail
      const trailX = car.direction === 1 ? car.x - 8 : car.x + 6;
      for (let t = 0; t < 3; t++) {
        const tx = trailX + t * 3 * -car.direction;
        this.graphics.rect(tx, y + 2, 2, 2);
        this.graphics.fill({ color: car.color, alpha: 0.3 - t * 0.1 });
      }
    }
  }

  resize(width: number, roadY: number) {
    this.width = width;
    this.roadY = roadY;
  }
}
