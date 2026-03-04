import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../palette";

export const SIDEWALK_HEIGHT = 25;
export const ROAD_HEIGHT = 60;
export const CAR_STRIP_HEIGHT = 25;
export const ROAD_TOTAL_HEIGHT = SIDEWALK_HEIGHT + ROAD_HEIGHT + CAR_STRIP_HEIGHT;

/** Draw the ground plane: sidewalk + road + lane markings */
export function createRoad(width: number, roadY: number): Container {
  const container = new Container();

  // Sidewalk
  const sidewalk = new Graphics();
  sidewalk.rect(0, roadY - 25, width, 25);
  sidewalk.fill(PALETTE.sidewalk);
  container.addChild(sidewalk);

  // Road surface
  const road = new Graphics();
  road.rect(0, roadY, width, 60);
  road.fill(PALETTE.roadDark);
  container.addChild(road);

  // Center dashed line
  const centerY = roadY + 29;
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
  edges.rect(0, roadY + 59, width, 1);
  edges.fill(PALETTE.roadLine);
  container.addChild(edges);

  // Bottom sidewalk
  const bottomWalk = new Graphics();
  bottomWalk.rect(0, roadY + 60, width, 25);
  bottomWalk.fill(PALETTE.sidewalk);
  bottomWalk.rect(0, roadY + 60, width, 1);
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

/** Create a neon bar for idle agents */
export function createBar(x: number, y: number): Container {
  const container = new Container();
  container.x = x;
  container.y = y;

  // Neon-red awning (narrower)
  const awning = new Graphics();
  awning.rect(0, -24, 40, 8);
  awning.fill(PALETTE.neonRed);
  for (let i = 0; i < 40; i += 10) {
    awning.rect(i, -24, 5, 8);
    awning.fill({ color: 0xffffff, alpha: 0.1 });
  }
  container.addChild(awning);

  // Bar counter (shorter)
  const bar = new Graphics();
  bar.rect(4, -10, 35, 3);
  bar.fill(PALETTE.buildingLight);
  bar.rect(4, -11, 35, 1);
  bar.fill(PALETTE.buildingEdge);
  container.addChild(bar);

  // 2 bar stools
  for (const sx of [10, 26]) {
    const stool = new Graphics();
    stool.rect(sx, -5, 6, 2);
    stool.fill(PALETTE.lampPost);
    stool.rect(sx + 2, -3, 2, 5);
    stool.fill(PALETTE.lampPost);
    container.addChild(stool);
  }

  return container;
}

/** Create a park area with a tree, bench, and fountain */
export function createPark(x: number, y: number): Container {
  const container = new Container();
  container.x = x;
  container.y = y;

  // Pixel tree — trunk + green crown
  const tree = new Graphics();
  // Trunk
  tree.rect(10, -20, 4, 18);
  tree.fill(0x443322);
  // Crown (layered rectangles for pixel look)
  tree.rect(2, -38, 20, 10);
  tree.fill(0x226633);
  tree.rect(5, -44, 14, 8);
  tree.fill(0x338844);
  tree.rect(8, -48, 8, 6);
  tree.fill(0x44aa55);
  container.addChild(tree);

  // Bench
  const bench = new Graphics();
  // Seat
  bench.rect(30, -6, 20, 2);
  bench.fill(PALETTE.lampPost);
  // Backrest
  bench.rect(30, -12, 2, 8);
  bench.fill(PALETTE.lampPost);
  bench.rect(48, -12, 2, 8);
  bench.fill(PALETTE.lampPost);
  bench.rect(30, -12, 20, 2);
  bench.fill(PALETTE.lampPost);
  // Legs
  bench.rect(32, -4, 2, 6);
  bench.fill(PALETTE.lampPost);
  bench.rect(46, -4, 2, 6);
  bench.fill(PALETTE.lampPost);
  container.addChild(bench);

  // Small fountain — stacked rectangles with water pixel dots
  const fountain = new Graphics();
  // Base pool
  fountain.rect(60, -4, 18, 4);
  fountain.fill(PALETTE.buildingDark);
  // Pool rim
  fountain.rect(59, -5, 20, 1);
  fountain.fill(PALETTE.buildingEdge);
  // Center column
  fountain.rect(67, -14, 4, 10);
  fountain.fill(PALETTE.buildingLight);
  // Top basin
  fountain.rect(64, -16, 10, 2);
  fountain.fill(PALETTE.buildingEdge);
  // Water dots (neon blue)
  fountain.circle(66, -8, 1);
  fountain.fill({ color: PALETTE.neonCyan, alpha: 0.5 });
  fountain.circle(72, -6, 1);
  fountain.fill({ color: PALETTE.neonCyan, alpha: 0.4 });
  fountain.circle(63, -3, 1);
  fountain.fill({ color: PALETTE.neonCyan, alpha: 0.3 });
  fountain.circle(75, -2, 1);
  fountain.fill({ color: PALETTE.neonCyan, alpha: 0.4 });
  container.addChild(fountain);

  return container;
}
