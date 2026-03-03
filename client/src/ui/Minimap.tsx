import { useEffect, useRef } from "react";

interface MinimapAgent {
  id: string;
  x: number;
  y: number;
  status: string;
}

interface Props {
  /** World width */
  worldWidth: number;
  /** World height */
  worldHeight: number;
  /** Camera viewport position & zoom */
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  /** Screen dimensions */
  screenWidth: number;
  screenHeight: number;
  /** Agent positions */
  agents: MinimapAgent[];
  /** Road Y position (fraction 0-1) */
  roadYFraction: number;
}

const MAP_W = 160;
const MAP_H = 90;

const STATUS_COLORS: Record<string, string> = {
  reading: "#ffd050",
  writing: "#40ff80",
  thinking: "#8840ff",
  stuck: "#ff4040",
  idle: "#555570",
  walking: "#40ddff",
};

export function Minimap({
  worldWidth,
  worldHeight,
  cameraX,
  cameraY,
  cameraZoom,
  screenWidth,
  screenHeight,
  agents,
  roadYFraction,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale factors
    const sx = MAP_W / worldWidth;
    const sy = MAP_H / worldHeight;

    // Clear
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // Background
    ctx.fillStyle = "#05050f";
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // Road line
    const roadY = roadYFraction * MAP_H;
    ctx.fillStyle = "#111122";
    ctx.fillRect(0, roadY, MAP_W, 6);
    ctx.fillStyle = "#333355";
    ctx.fillRect(0, roadY, MAP_W, 1);

    // Building blocks (simplified)
    ctx.fillStyle = "#141432";
    // Creative district
    ctx.fillRect(MAP_W * 0.05, roadY - 20, 12, 20);
    ctx.fillRect(MAP_W * 0.12, roadY - 15, 10, 15);
    // Data district
    ctx.fillRect(MAP_W * 0.3, roadY - 28, 12, 28);
    ctx.fillRect(MAP_W * 0.38, roadY - 22, 10, 22);
    ctx.fillRect(MAP_W * 0.45, roadY - 17, 8, 17);
    // QC district
    ctx.fillRect(MAP_W * 0.58, roadY - 17, 12, 17);
    ctx.fillRect(MAP_W * 0.66, roadY - 13, 10, 13);
    // Workshop district
    ctx.fillRect(MAP_W * 0.8, roadY - 12, 8, 12);
    ctx.fillRect(MAP_W * 0.86, roadY - 9, 7, 9);

    // Agents as dots
    for (const a of agents) {
      const ax = a.x * sx;
      const ay = a.y * sy;
      ctx.fillStyle = STATUS_COLORS[a.status] || "#888888";
      ctx.beginPath();
      ctx.arc(ax, ay, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Viewport rectangle
    const vpW = (screenWidth / cameraZoom) * sx;
    const vpH = (screenHeight / cameraZoom) * sy;
    // Camera offset: the world pivot is at screen center, pan shifts it
    const vpX = (worldWidth / 2 - cameraX) * sx - vpW / 2;
    const vpY = (worldHeight / 2 - cameraY) * sy - vpH / 2;

    ctx.strokeStyle = "#40ddff";
    ctx.lineWidth = 1;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
  }, [worldWidth, worldHeight, cameraX, cameraY, cameraZoom, screenWidth, screenHeight, agents, roadYFraction]);

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        className="minimap-canvas"
      />
    </div>
  );
}
