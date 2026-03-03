import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

/** Draw the ground plane: sidewalk + road + lane markings */
export function createRoad(width: number, roadY: number): Container {
  const container = new Container();

  // Sidewalk
  const sidewalk = new Graphics();
  sidewalk.rect(0, roadY - 10, width, 10);
  sidewalk.fill(PALETTE.sidewalk);
  // Sidewalk edge
  sidewalk.rect(0, roadY - 1, width, 1);
  sidewalk.fill(PALETTE.roadLine);
  container.addChild(sidewalk);

  // Road surface
  const road = new Graphics();
  road.rect(0, roadY, width, 40);
  road.fill(PALETTE.roadDark);
  container.addChild(road);

  // Center dashed line
  const centerY = roadY + 19;
  const dashLine = new Graphics();
  for (let x = 0; x < width; x += 30) {
    dashLine.rect(x, centerY, 16, 2);
    dashLine.fill(PALETTE.roadLineYellow);
  }
  container.addChild(dashLine);

  // Road edge lines
  const edges = new Graphics();
  edges.rect(0, roadY, width, 1);
  edges.fill(PALETTE.roadLine);
  edges.rect(0, roadY + 39, width, 1);
  edges.fill(PALETTE.roadLine);
  container.addChild(edges);

  // Bottom sidewalk
  const bottomWalk = new Graphics();
  bottomWalk.rect(0, roadY + 40, width, 8);
  bottomWalk.fill(PALETTE.sidewalk);
  bottomWalk.rect(0, roadY + 40, width, 1);
  bottomWalk.fill(PALETTE.roadLine);
  container.addChild(bottomWalk);

  return container;
}

/** Create a small café area for idle agents */
export function createCafe(x: number, y: number): Container {
  const container = new Container();
  container.x = x;
  container.y = y;

  // Awning
  const awning = new Graphics();
  awning.rect(0, -20, 50, 8);
  awning.fill(PALETTE.neonPink);
  // Stripes
  for (let i = 0; i < 50; i += 10) {
    awning.rect(i, -20, 5, 8);
    awning.fill({ color: 0xffffff, alpha: 0.15 });
  }
  container.addChild(awning);

  // Table
  const table = new Graphics();
  table.rect(10, -8, 14, 2);
  table.fill(PALETTE.lampPost);
  table.rect(16, -6, 2, 8);
  table.fill(PALETTE.lampPost);
  container.addChild(table);

  // Chair
  const chair = new Graphics();
  chair.rect(30, -4, 8, 2);
  chair.fill(PALETTE.lampPost);
  chair.rect(30, -8, 2, 6);
  chair.fill(PALETTE.lampPost);
  container.addChild(chair);

  // Coffee cup on table
  const cup = new Graphics();
  cup.rect(13, -12, 4, 4);
  cup.fill(0xffffff);
  // Steam
  cup.rect(14, -15, 1, 2);
  cup.fill({ color: 0xffffff, alpha: 0.4 });
  cup.rect(16, -16, 1, 2);
  cup.fill({ color: 0xffffff, alpha: 0.3 });
  container.addChild(cup);

  return container;
}
