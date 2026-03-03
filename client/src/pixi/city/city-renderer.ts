import { Application, Container } from "pixi.js";
import { SkyRenderer } from "../sky/sky-renderer";
import { CloudLayer } from "../sky/clouds";
import { WeatherSystem, type WeatherState } from "../sky/weather";
import { createBuilding, type BuildingConfig } from "../sprites/draw-building";
import { createAgent, updateAgent, type AgentConfig } from "../sprites/draw-agent";
import { NeonSign } from "../effects/neon-signs";
import { createStreetlamp } from "../effects/streetlamp";
import { SteamVent, PixelCat, TrafficSystem } from "../effects/ambient";
import { createRoad, createCafe } from "./road";
import { Camera } from "../camera";
import { THEME_CITY, type CityTheme } from "../themes";

export interface CityAgent {
  agentId: string;
  displayName: string;
  colorIndex: number;
  status: "idle" | "walking" | "reading" | "writing" | "thinking" | "stuck";
  currentCommand?: string;
  toolInput?: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

interface DistrictLayout {
  type: keyof CityTheme["district"];
  x: number;
  buildings: BuildingConfig[];
}

/** Callback for click/hover events on city elements */
export interface CityEventCallbacks {
  onBuildingClick?: (label: string, district: string, x: number, y: number) => void;
  onAgentClick?: (agentId: string, x: number, y: number) => void;
  onHover?: (info: { type: string; label: string; x: number; y: number } | null) => void;
}

export class CityRenderer {
  private app: Application;
  private sky: SkyRenderer;
  private clouds: CloudLayer;
  private weather: WeatherSystem;
  private cityLayer: Container;
  private agentLayer: Container;
  private effectLayer: Container;
  private weatherLayer: Container;
  private neonSigns: NeonSign[] = [];
  private agentSprites: Map<string, Container> = new Map();
  private agents: Map<string, CityAgent> = new Map();
  private steamVents: SteamVent[] = [];
  private pixelCat: PixelCat;
  private traffic: TrafficSystem;
  private roadY: number;
  private width: number;
  private height: number;

  // Camera
  camera: Camera;

  // Theme
  private theme: CityTheme = THEME_CITY;

  // Events
  private callbacks: CityEventCallbacks = {};

  constructor(app: Application) {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;
    this.roadY = this.height * 0.72;

    // Camera wraps a world container
    this.camera = new Camera(app);
    app.stage.addChild(this.camera.world);

    // Sky (background) — added to world so it pans/zooms
    this.sky = new SkyRenderer(this.width, this.height);
    this.camera.world.addChild(this.sky.container);

    // Clouds (behind city, in front of sky)
    this.clouds = new CloudLayer(this.width, this.height);
    this.camera.world.addChild(this.clouds.container);

    // City elements (buildings, road)
    this.cityLayer = new Container();
    this.camera.world.addChild(this.cityLayer);

    // Effects (neon, particles, ambient)
    this.effectLayer = new Container();
    this.camera.world.addChild(this.effectLayer);

    // Agents (foreground)
    this.agentLayer = new Container();
    this.camera.world.addChild(this.agentLayer);

    // Weather (on top of everything except UI)
    this.weatherLayer = new Container();
    this.weather = new WeatherSystem(this.width, this.height);
    this.weatherLayer.addChild(this.weather.container);
    this.camera.world.addChild(this.weatherLayer);

    // Traffic on road
    this.traffic = new TrafficSystem(this.width, this.roadY);
    this.effectLayer.addChild(this.traffic.container);

    // Pixel cat on a rooftop
    this.pixelCat = new PixelCat(
      this.width * 0.45,
      this.roadY - 145 // on top of a tall building
    );
    this.effectLayer.addChild(this.pixelCat.container);

    this.buildCity();

    // Main render loop
    app.ticker.maxFPS = 30;
    app.ticker.add((ticker) => this.update(ticker.lastTime, ticker.deltaMS));
  }

  /** Set event callbacks for click/hover */
  setCallbacks(cbs: CityEventCallbacks) {
    this.callbacks = cbs;
  }

  /** Apply a new theme (rebuilds the city) */
  setTheme(theme: CityTheme) {
    this.theme = theme;
    this.app.renderer.background.color = theme.background;
    // Would need to rebuild sky/buildings/road with new colors.
    // For now, update the background and neon sign colors.
    // A full rebuild would clear and re-draw, but that's expensive.
    // We store the theme for any newly created elements.
  }

  getTheme(): CityTheme {
    return this.theme;
  }

  private buildCity() {
    // Road
    const road = createRoad(this.width, this.roadY);
    this.cityLayer.addChild(road);

    // Districts — spread across the width
    const districts: DistrictLayout[] = [
      {
        type: "creative",
        x: this.width * 0.05,
        buildings: [
          { width: 60, height: 120, windowCols: 4, windowRows: 8, district: "creative", label: "components" },
          { width: 45, height: 90, windowCols: 3, windowRows: 6, district: "creative", label: "pages" },
        ],
      },
      {
        type: "data",
        x: this.width * 0.3,
        buildings: [
          { width: 55, height: 160, windowCols: 4, windowRows: 12, district: "data", label: "api" },
          { width: 50, height: 130, windowCols: 3, windowRows: 9, district: "data", label: "routes" },
          { width: 40, height: 100, windowCols: 3, windowRows: 7, district: "data", label: "models" },
        ],
      },
      {
        type: "qc",
        x: this.width * 0.58,
        buildings: [
          { width: 55, height: 100, windowCols: 4, windowRows: 7, district: "qc", label: "tests" },
          { width: 45, height: 80, windowCols: 3, windowRows: 5, district: "qc", label: "specs" },
        ],
      },
      {
        type: "workshop",
        x: this.width * 0.8,
        buildings: [
          { width: 40, height: 70, windowCols: 3, windowRows: 4, district: "workshop", label: "utils" },
          { width: 35, height: 55, windowCols: 2, windowRows: 3, district: "workshop", label: "config" },
        ],
      },
    ];

    // Render each district
    for (const dist of districts) {
      const dTheme = this.theme.district[dist.type];
      let offsetX = dist.x;

      // District neon sign
      const sign = new NeonSign({
        text: dTheme.sign,
        color: dTheme.primary,
        fontSize: 9,
      });
      // Position sign above tallest building
      const maxH = Math.max(...dist.buildings.map((b) => b.height));
      sign.container.x = offsetX + 40;
      sign.container.y = this.roadY - maxH - 25;
      this.effectLayer.addChild(sign.container);
      this.neonSigns.push(sign);

      // Buildings
      for (const bConfig of dist.buildings) {
        // Randomize some lit windows
        const litWindows: BuildingConfig["litWindows"] = [];
        for (let c = 0; c < bConfig.windowCols; c++) {
          for (let r = 0; r < bConfig.windowRows; r++) {
            if (Math.random() > 0.75) {
              litWindows.push([c, r, "dim"]);
            }
          }
        }
        const building = createBuilding({ ...bConfig, litWindows });
        building.x = offsetX;
        building.y = this.roadY - bConfig.height;

        // Make building interactive
        building.eventMode = "static";
        building.cursor = "pointer";
        building.on("pointerdown", () => {
          this.callbacks.onBuildingClick?.(
            bConfig.label || "unknown",
            dist.type,
            building.x + bConfig.width / 2,
            building.y
          );
        });
        building.on("pointerenter", () => {
          this.callbacks.onHover?.({
            type: "building",
            label: bConfig.label || "unknown",
            x: building.x + bConfig.width / 2,
            y: building.y,
          });
        });
        building.on("pointerleave", () => {
          this.callbacks.onHover?.(null);
        });

        this.cityLayer.addChild(building);
        offsetX += bConfig.width + 12;
      }
    }

    // Streetlamps
    const lampSpacing = 120;
    for (let x = 60; x < this.width; x += lampSpacing) {
      const lamp = createStreetlamp();
      lamp.x = x;
      lamp.y = this.roadY;
      this.cityLayer.addChild(lamp);
    }

    // Steam vents (between districts)
    const ventPositions = [this.width * 0.25, this.width * 0.53, this.width * 0.75];
    for (const vx of ventPositions) {
      const vent = new SteamVent(vx, this.roadY - 8);
      this.effectLayer.addChild(vent.container);
      this.steamVents.push(vent);
    }

    // Café for idle agents (bottom-left)
    const cafe = createCafe(30, this.roadY - 2);
    this.cityLayer.addChild(cafe);

    // Café neon sign
    const cafeSign = new NeonSign({
      text: "CAFE",
      color: 0xff40aa,
      fontSize: 7,
    });
    cafeSign.container.x = 55;
    cafeSign.container.y = this.roadY - 28;
    this.effectLayer.addChild(cafeSign.container);
    this.neonSigns.push(cafeSign);
  }

  /** Add or update an agent */
  setAgent(agent: CityAgent) {
    this.agents.set(agent.agentId, agent);

    // Remove old sprite
    const existing = this.agentSprites.get(agent.agentId);
    if (existing) {
      this.agentLayer.removeChild(existing);
      existing.destroy();
    }

    // Create new sprite
    const sprite = createAgent({
      colorIndex: agent.colorIndex,
      displayName: agent.displayName,
      status: agent.status,
      currentCommand: agent.currentCommand,
      toolInput: agent.toolInput,
    });
    sprite.x = agent.x;
    sprite.y = agent.y;

    // Make agent interactive
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointerdown", () => {
      this.callbacks.onAgentClick?.(
        agent.agentId,
        sprite.x,
        sprite.y
      );
    });
    sprite.on("pointerenter", () => {
      this.callbacks.onHover?.({
        type: "agent",
        label: agent.displayName,
        x: sprite.x,
        y: sprite.y,
      });
    });
    sprite.on("pointerleave", () => {
      this.callbacks.onHover?.(null);
    });

    this.agentLayer.addChild(sprite);
    this.agentSprites.set(agent.agentId, sprite);
  }

  /** Remove an agent */
  removeAgent(agentId: string) {
    this.agents.delete(agentId);
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.agentLayer.removeChild(sprite);
      sprite.destroy();
      this.agentSprites.delete(agentId);
    }
  }

  /** Set the weather state */
  setWeather(state: string) {
    this.weather.setState(state as WeatherState);

    // Clouds get thicker during rain/storm/fog
    if (state === "rain" || state === "storm" || state === "fog") {
      this.clouds.opacity = 1.5;
    } else if (state === "snow") {
      this.clouds.opacity = 0.8;
    } else {
      this.clouds.opacity = 1;
    }
  }

  /** Get all agent positions for the minimap */
  getAgentPositions(): Array<{ id: string; x: number; y: number; status: string }> {
    const result: Array<{ id: string; x: number; y: number; status: string }> = [];
    for (const [id, agent] of this.agents) {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        result.push({ id, x: sprite.x, y: sprite.y, status: agent.status });
      }
    }
    return result;
  }

  /** Focus camera on a specific agent */
  focusAgent(agentId: string) {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.camera.focusOn(sprite.x, sprite.y, 2);
    }
  }

  /** Main update loop */
  private update(time: number, dt: number) {
    // Update camera (keyboard panning)
    this.camera.update(dt);

    // Update sky
    this.sky.update(time);

    // Update clouds
    this.clouds.update(dt);

    // Update weather particles
    this.weather.update(time, dt);

    // Update ambient effects
    for (const vent of this.steamVents) {
      vent.update(dt);
    }
    this.pixelCat.update(time);
    this.traffic.update(dt);

    // Update neon signs
    for (const sign of this.neonSigns) {
      sign.update(time);
    }

    // Update agents — lerp toward target
    for (const [id, agent] of this.agents) {
      const sprite = this.agentSprites.get(id);
      if (!sprite) continue;

      // Smooth movement toward target
      const dx = agent.targetX - sprite.x;
      const dy = agent.targetY - sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        sprite.x += dx * 0.03;
        sprite.y += dy * 0.03;

        // Flip sprite based on direction
        if (dx < 0) {
          sprite.scale.x = -Math.abs(sprite.scale.x);
        } else if (dx > 0) {
          sprite.scale.x = Math.abs(sprite.scale.x);
        }
      }

      updateAgent(sprite, time, dt);
    }
  }

  /** Get a position for an agent based on status */
  getAgentPosition(
    status: string,
    agentIndex: number
  ): { x: number; y: number } {
    const streetY = this.roadY + 15;
    const spacing = 60;

    switch (status) {
      case "reading":
        // Near data tower
        return { x: this.width * 0.35 + agentIndex * spacing, y: streetY };
      case "writing":
        // Near creative district
        return { x: this.width * 0.1 + agentIndex * spacing, y: streetY };
      case "thinking":
        // Park bench area (mid city)
        return { x: this.width * 0.5 + agentIndex * 40, y: streetY };
      case "stuck":
        // Traffic light area
        return { x: this.width * 0.65 + agentIndex * 30, y: streetY };
      case "idle":
        // Café
        return { x: 50 + agentIndex * 25, y: this.roadY - 4 };
      default:
        // Walking along road
        return {
          x: this.width * 0.2 + agentIndex * spacing,
          y: streetY,
        };
    }
  }

  /** Get world dimensions for minimap */
  getWorldDimensions(): { width: number; height: number; roadYFraction: number } {
    return {
      width: this.width,
      height: this.height,
      roadYFraction: this.roadY / this.height,
    };
  }

  /**
   * Called whenever the PixiJS canvas is resized (e.g. when a sidebar opens or
   * closes). Adjusts the camera zoom so the entire city world remains visible
   * inside the new viewport width. Pan is reset to zero so the full scene
   * centres correctly after the fit.
   *
   * User zoom/pan interactions continue to work normally on top of the new
   * base zoom — scroll-wheel zoom is still applied multiplicatively.
   */
  onViewportResize(_viewportWidth: number, _viewportHeight: number) {
    // The city world spans this.width pixels horizontally (built at initial
    // canvas width). fitToWidth reads app.screen.width which is already updated
    // by the time this is called, so we just pass the world width.
    this.camera.setPan(0, 0);
    this.camera.fitToWidth(this.width);
  }

  destroy() {
    this.app.ticker.remove(this.update as any);
    this.camera.destroy();
    for (const [, sprite] of this.agentSprites) {
      sprite.destroy();
    }
    this.agentSprites.clear();
    this.agents.clear();
  }
}
