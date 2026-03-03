import { Container, Text, TextStyle, Graphics } from "pixi.js";

export interface NeonSignConfig {
  text: string;
  color: number;
  fontSize?: number;
}

export class NeonSign {
  container: Container;
  private label: Text;
  private glow: Graphics;
  private phase: number;
  private color: number;

  constructor(config: NeonSignConfig) {
    this.container = new Container();
    this.color = config.color;
    this.phase = Math.random() * Math.PI * 2;

    const fontSize = config.fontSize || 8;

    const style = new TextStyle({
      fontFamily: '"Press Start 2P", monospace',
      fontSize,
      fill: config.color,
      letterSpacing: 2,
    });

    this.label = new Text({ text: config.text.toUpperCase(), style });
    this.label.anchor.set(0.5, 0.5);

    // Glow rectangle behind text
    this.glow = new Graphics();
    this.drawGlow(1);

    this.container.addChild(this.glow);
    this.container.addChild(this.label);
  }

  private drawGlow(alpha: number) {
    this.glow.clear();
    const pad = 6;
    const w = this.label.width + pad * 2;
    const h = this.label.height + pad * 2;
    this.glow.roundRect(-w / 2, -h / 2, w, h, 2);
    this.glow.fill({ color: this.color, alpha: alpha * 0.15 });
    this.glow.stroke({ color: this.color, width: 1, alpha: alpha * 0.5 });
  }

  update(time: number) {
    // Gentle flicker
    const base =
      0.8 +
      Math.sin(time * 0.004 + this.phase) * 0.1 +
      Math.sin(time * 0.009 + this.phase * 1.7) * 0.05;

    // Occasional hard flicker
    const hardFlicker = Math.random() < 0.003 ? 0.3 : 1;
    const alpha = base * hardFlicker;

    this.label.alpha = alpha;
    this.drawGlow(alpha);
  }
}
