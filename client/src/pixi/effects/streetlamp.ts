import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

/** Create a streetlamp with light cone */
export function createStreetlamp(): Container {
  const container = new Container();

  // Pole
  const pole = new Graphics();
  pole.rect(-1, -30, 2, 30);
  pole.fill(PALETTE.lampPost);

  // Arm
  pole.rect(-1, -30, 8, 2);
  pole.fill(PALETTE.lampPost);

  // Bulb
  pole.rect(5, -30, 4, 3);
  pole.fill(PALETTE.lampLight);

  container.addChild(pole);

  // Light cone
  const cone = new Graphics();
  cone.moveTo(5, -27);
  cone.lineTo(-8, 0);
  cone.lineTo(18, 0);
  cone.closePath();
  cone.fill({ color: PALETTE.lampLight, alpha: 0.06 });
  container.addChild(cone);

  // Ground glow
  const glow = new Graphics();
  glow.ellipse(7, 0, 14, 4);
  glow.fill({ color: PALETTE.lampGlow, alpha: 0.12 });
  container.addChild(glow);

  return container;
}
