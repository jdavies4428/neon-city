import { Application, Container, Graphics } from "pixi.js";

const WORLD_WIDTH = 1560;
import { SkyRenderer } from "../sky/sky-renderer";
import { CloudLayer } from "../sky/clouds";
import { WeatherSystem, type WeatherState } from "../sky/weather";
import {
  createBuilding,
  addRoofDetails,
  updateBuilding,
  updateRoofDetails,
  type BuildingConfig,
  type AnimatedBuilding,
} from "../sprites/draw-building";
import { createAgent, updateAgent, type AgentConfig } from "../sprites/draw-agent";
import { NeonSign } from "../effects/neon-signs";
import { createStreetlamp } from "../effects/streetlamp";
import { SteamVent, PixelCat, TrafficSystem } from "../effects/ambient";
import { createRoad, createCafe, createBar, createPark } from "./road";
import { BackgroundCity } from "./background-city";
import { GroundLayer } from "./ground-layer";
import { Camera } from "../camera";
import { THEME_CITY, type CityTheme } from "../themes";
import { PALETTE, DISTRICT_THEMES } from "../palette";
import { CityPulse } from "./city-pulse";

export interface CityAgent {
  agentId: string;
  displayName: string;
  colorIndex: number;
  status: "idle" | "walking" | "reading" | "writing" | "thinking" | "stuck";
  currentCommand?: string;
  toolInput?: string;
  agentType?: string;
  agentKind?: "session" | "subagent";
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  variant?: "agent" | "session";
  ideName?: string;
}

interface DistrictLayout {
  type: keyof CityTheme["district"];
  x: number;
  buildings: BuildingConfig[];
}

/** Maps each agent type to its "home" building where it lives when idle */
const AGENT_HOME_BUILDING: Record<string, string> = {
  "explore": "Library",
  "general-purpose": "Library",
  "seo-specialist": "Library",
  "data-analyst": "Library",
  "business-analyst": "Library",
  "frontend-developer": "Workshop",
  "backend-developer": "Workshop",
  "mobile-developer": "Workshop",
  "mobile-app-developer": "Workshop",
  "debugger": "Terminal",
  "database-administrator": "Terminal",
  "code-reviewer": "QC Lab",
  "security-auditor": "QC Lab",
  "security-engineer": "QC Lab",
  "ui-designer": "Studio",
  "content-marketer": "Studio",
  "project-manager": "HQ",
  "multi-agent-coordinator": "HQ",
  "plan": "HQ",
  "ai-engineer": "HQ",
};

const AGENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  "explore": "Codebase explorer",
  "general-purpose": "General-purpose agent",
  "seo-specialist": "SEO optimization",
  "data-analyst": "Data analysis & dashboards",
  "business-analyst": "Requirements & process analysis",
  "frontend-developer": "React, Vue, Angular, UI",
  "backend-developer": "APIs & server-side",
  "mobile-developer": "Cross-platform mobile",
  "mobile-app-developer": "Native iOS/Android",
  "debugger": "Bug diagnosis & fixes",
  "database-administrator": "Database performance & queries",
  "code-reviewer": "Code quality review",
  "security-auditor": "Security audits & compliance",
  "security-engineer": "Security controls & hardening",
  "ui-designer": "Visual design & component styling",
  "content-marketer": "Content strategy & copy",
  "project-manager": "Planning & coordination",
  "multi-agent-coordinator": "Multi-agent orchestration",
  "plan": "Architecture & planning",
  "ai-engineer": "AI/ML systems",
};

/** Callback for click/hover events on city elements */
export interface CityEventCallbacks {
  onBuildingClick?: (label: string, district: string, x: number, y: number) => void;
  onAgentClick?: (agentId: string, x: number, y: number) => void;
  onHover?: (info: { type: string; label: string; details?: string; x: number; y: number } | null) => void;
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
  private backgroundCity: BackgroundCity;
  private groundLayer: GroundLayer;
  private neonSigns: NeonSign[] = [];
  private animatedBuildings: AnimatedBuilding[] = [];
  private agentSprites: Map<string, Container> = new Map();
  private agents: Map<string, CityAgent> = new Map();
  private pendingRemovals: Map<string, { sprite: Container; framesLeft: number }> = new Map();
  private steamVents: SteamVent[] = [];
  private pixelCat: PixelCat;
  private traffic: TrafficSystem;
  private roadY: number;
  private width: number;
  private screenWidth: number;
  private height: number;

  // Building position lookup for getAgentPosition()
  private buildingPositions: Map<string, { x: number; y: number; width: number; height: number }> = new Map();

  // City pulse (reactive activity tracking)
  private pulse: CityPulse;

  // Flag set when powerStrain > 0.7 — read during lamp rendering
  private powerStrainFlicker: boolean = false;
  private manualWeatherOverride: boolean = false;
  private dayOverlay: Graphics;
  private isDaytime: boolean = false;

  // Camera
  camera: Camera;

  // Theme
  private theme: CityTheme = THEME_CITY;

  // Events
  private callbacks: CityEventCallbacks = {};

  constructor(app: Application) {
    this.app = app;
    this.screenWidth = app.screen.width;
    this.width = WORLD_WIDTH;
    this.height = app.screen.height;
    this.roadY = this.height * 0.65;

    // Camera wraps a world container
    this.camera = new Camera(app);
    app.stage.addChild(this.camera.world);

    // Sky (background) — added to world so it pans/zooms
    this.sky = new SkyRenderer(WORLD_WIDTH, this.height);
    this.camera.world.addChild(this.sky.container);

    // Clouds (behind city, in front of sky)
    this.clouds = new CloudLayer(WORLD_WIDTH, this.height);
    this.camera.world.addChild(this.clouds.container);

    // Parallax background silhouettes (between clouds and foreground city)
    this.backgroundCity = new BackgroundCity(WORLD_WIDTH, this.height, this.roadY);
    this.camera.world.addChild(this.backgroundCity.container);

    // Ground layer below road (grating, drains, neon puddles)
    this.groundLayer = new GroundLayer(WORLD_WIDTH, this.roadY, this.height);
    this.camera.world.addChild(this.groundLayer.container);

    // City elements (buildings, road)
    this.cityLayer = new Container();
    this.camera.world.addChild(this.cityLayer);

    // Effects (neon, particles, ambient)
    this.effectLayer = new Container();
    this.camera.world.addChild(this.effectLayer);

    // Agents (foreground)
    this.agentLayer = new Container();
    this.camera.world.addChild(this.agentLayer);

    // Daylight overlay — semi-transparent wash that brightens the scene during sunny mode
    this.dayOverlay = new Graphics();
    this.camera.world.addChild(this.dayOverlay);

    // Weather (on top of everything except UI)
    this.weatherLayer = new Container();
    this.weather = new WeatherSystem(WORLD_WIDTH, this.height);
    this.weatherLayer.addChild(this.weather.container);
    this.camera.world.addChild(this.weatherLayer);

    // Traffic on road
    this.traffic = new TrafficSystem(WORLD_WIDTH, this.roadY);
    this.effectLayer.addChild(this.traffic.container);

    // Pixel cat on a rooftop — sits atop the Terminal building
    this.pixelCat = new PixelCat(
      980 + 60, // center of Terminal building
      this.roadY - 290
    );
    this.effectLayer.addChild(this.pixelCat.container);

    // City pulse — aggregates activity signals into visual parameters
    this.pulse = new CityPulse();

    this.buildCity();

    // Update camera pan bounds for the full world width
    this.camera.setWorldSize(WORLD_WIDTH, this.height);
    // Fit the city so it fills the full viewport both horizontally and
    // vertically. The bottom margin reserves space for the agent-bar (≈48px).
    this.camera.fitCityToViewport(WORLD_WIDTH, this.roadY, 48);

    // Main render loop
    app.ticker.maxFPS = 30;
    app.ticker.add((ticker) => this.update(ticker.lastTime, ticker.deltaMS));
  }

  /** Expose the CityPulse so App.tsx can feed it error/token data */
  getPulse(): CityPulse {
    return this.pulse;
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

    // -----------------------------------------------------------------------
    // Compact layout: 6 essential buildings + Park (center) + Cafe + Bar
    //
    // Each building maps to what agents actually DO:
    //   Library   — Read, Glob, Grep, WebSearch (research agents)
    //   Workshop  — Write, Edit (frontend/backend/mobile devs)
    //   Terminal  — Bash (the iconic tallest building)
    //   QC Lab    — Testing, debugging, security agents
    //   Studio    — Design, creative, UI agents
    //   HQ        — Coordination, planning, project management
    //
    // Idle agents hang out at Park (center), Cafe, or Bar on sidewalks.
    // When called, they walk to the relevant building.
    // -----------------------------------------------------------------------

    const LIBRARY_X  = 30;
    const WORKSHOP_X = 200;
    const CAFE_X     = 380;
    const PARK_X     = 510;
    const BAR_X      = 830;
    const TERMINAL_X = 970;
    const QC_X       = 1130;
    const STUDIO_X   = 1270;
    const HQ_X       = 1420;

    // Districts — one purposeful building each
    const districts: DistrictLayout[] = [
      {
        type: "library",
        x: LIBRARY_X,
        buildings: [
          { width: 130, height: 280, windowCols: 7, windowRows: 14, district: "library", label: "Library" },
        ],
      },
      {
        type: "workshop",
        x: WORKSHOP_X,
        buildings: [
          { width: 140, height: 260, windowCols: 7, windowRows: 13, district: "workshop", label: "Workshop" },
        ],
      },
      {
        type: "terminal",
        x: TERMINAL_X,
        buildings: [
          { width: 120, height: 340, windowCols: 6, windowRows: 17, district: "terminal", label: "Terminal" },
        ],
      },
      {
        type: "qc",
        x: QC_X,
        buildings: [
          { width: 110, height: 220, windowCols: 6, windowRows: 11, district: "qc", label: "QC Lab" },
        ],
      },
      {
        type: "studio",
        x: STUDIO_X,
        buildings: [
          { width: 120, height: 200, windowCols: 6, windowRows: 10, district: "studio", label: "Studio" },
        ],
      },
      {
        type: "hq",
        x: HQ_X,
        buildings: [
          { width: 130, height: 300, windowCols: 7, windowRows: 15, district: "hq", label: "HQ" },
        ],
      },
    ];

    // --- Central Park (wide, center of city — idle agents gather here) ---
    const parkGround = new Graphics();
    parkGround.rect(PARK_X - 10, this.roadY - 8, 310, 10);
    parkGround.fill({ color: 0x1a4a2a, alpha: 0.8 });
    this.cityLayer.addChild(parkGround);

    const park1 = createPark(PARK_X, this.roadY - 4);
    park1.scale.set(2);
    this.cityLayer.addChild(park1);

    const park2 = createPark(PARK_X + 80, this.roadY - 4);
    park2.scale.set(2);
    this.cityLayer.addChild(park2);

    const park3 = createPark(PARK_X + 160, this.roadY - 4);
    park3.scale.set(2);
    this.cityLayer.addChild(park3);

    this.buildingPositions.set("Park", { x: PARK_X, y: this.roadY, width: 300, height: 50 });

    const parkSign = new NeonSign({ text: "PARK", color: DISTRICT_THEMES.social.primary, fontSize: 12 });
    parkSign.container.x = PARK_X + 120;
    parkSign.container.y = this.roadY - 140;
    this.effectLayer.addChild(parkSign.container);
    this.neonSigns.push(parkSign);

    // --- Cafe (left side social spot) ---
    const cafe = createCafe(CAFE_X, this.roadY - 4);
    cafe.scale.set(2);
    this.cityLayer.addChild(cafe);
    this.buildingPositions.set("Cafe", { x: CAFE_X, y: this.roadY, width: 100, height: 50 });

    const cafeSign = new NeonSign({ text: "CAFE", color: 0xff40aa, fontSize: 9 });
    cafeSign.container.x = CAFE_X + 30;
    cafeSign.container.y = this.roadY - 80;
    this.effectLayer.addChild(cafeSign.container);
    this.neonSigns.push(cafeSign);

    // --- Bar (right side social spot) ---
    const bar = createBar(BAR_X, this.roadY - 4);
    bar.scale.set(2);
    this.cityLayer.addChild(bar);
    this.buildingPositions.set("Bar", { x: BAR_X, y: this.roadY, width: 80, height: 50 });

    const barSign = new NeonSign({ text: "BAR", color: PALETTE.neonRed, fontSize: 9 });
    barSign.container.x = BAR_X + 30;
    barSign.container.y = this.roadY - 80;
    this.effectLayer.addChild(barSign.container);
    this.neonSigns.push(barSign);

    // Beer mug icon to the right of BAR sign
    const barMug = new Graphics();
    const mugX = BAR_X + 68;
    const mugY = this.roadY - 86;
    barMug.rect(mugX, mugY, 8, 12);
    barMug.fill({ color: PALETTE.neonYellow, alpha: 0.7 });
    barMug.rect(mugX + 8, mugY + 3, 4, 6);
    barMug.stroke({ color: PALETTE.neonYellow, width: 1.5, alpha: 0.5 });
    barMug.rect(mugX, mugY - 3, 8, 3);
    barMug.fill({ color: 0xffffff, alpha: 0.5 });
    this.effectLayer.addChild(barMug);

    // Render each district
    for (const dist of districts) {
      // Skip social — it has no buildings array (handled above)
      if (dist.buildings.length === 0) continue;

      const dTheme = this.theme.district[dist.type];
      let offsetX = dist.x;

      // District neon sign — positioned above tallest building
      const sign = new NeonSign({
        text: dTheme.sign,
        color: dTheme.primary,
        fontSize: 12,
      });
      const maxH = Math.max(...dist.buildings.map((b) => b.height));
      sign.container.x = offsetX + 60;
      sign.container.y = this.roadY - maxH - 30;
      this.effectLayer.addChild(sign.container);
      this.neonSigns.push(sign);

      // Buildings
      for (const bConfig of dist.buildings) {
        const building = createBuilding(bConfig);
        const now = performance.now();
        addRoofDetails(building, now);

        const { container } = building;
        container.x = offsetX;
        container.y = this.roadY - bConfig.height;

        // Store position for agent routing
        if (bConfig.label) {
          this.buildingPositions.set(bConfig.label, {
            x: container.x,
            y: container.y,
            width: bConfig.width,
            height: bConfig.height,
          });
        }

        this.cityLayer.addChild(container);
        this.animatedBuildings.push(building);
        offsetX += bConfig.width + 10;
      }
    }

    // Streetlamps — stop at HQ right edge, not past it
    const lampSpacing = 120;
    const lampLimit = HQ_X + 130; // HQ right edge
    for (let x = 60; x < lampLimit; x += lampSpacing) {
      const lamp = createStreetlamp();
      lamp.x = x;
      lamp.y = this.roadY;
      this.cityLayer.addChild(lamp);
    }

    // Steam vents spread evenly across the world
    const ventPositions = [200, 500, 780, 1050, 1350];
    for (const vx of ventPositions) {
      const vent = new SteamVent(vx, this.roadY - 8);
      this.effectLayer.addChild(vent.container);
      this.steamVents.push(vent);
    }
  }

  /** Add or update an agent */
  setAgent(agent: CityAgent) {
    // If this agent is currently pending removal, cancel that and reuse
    const pendingRemoval = this.pendingRemovals.get(agent.agentId);
    if (pendingRemoval) {
      this.pendingRemovals.delete(agent.agentId);
      this.agentLayer.removeChild(pendingRemoval.sprite);
      pendingRemoval.sprite.destroy();
    }

    const isNewAgent = !this.agentSprites.has(agent.agentId);

    this.agents.set(agent.agentId, agent);

    // Remove old sprite if updating
    const existing = this.agentSprites.get(agent.agentId);
    if (existing) {
      this.agentLayer.removeChild(existing);
      existing.destroy();
    }

    // Create new sprite — pass variant and ideName through AgentConfig
    const agentConfig: AgentConfig = {
      colorIndex: agent.colorIndex,
      displayName: agent.displayName,
      status: agent.status,
      currentCommand: agent.currentCommand,
      toolInput: agent.toolInput,
      variant: agent.variant,
      ideName: agent.ideName,
      agentType: agent.agentType,
      agentKind: agent.agentKind,
    };
    const sprite = createAgent(agentConfig);
    sprite.x = agent.x;
    sprite.y = agent.y;

    // Arrival animation for brand-new agents: start above target, fully transparent
    if (isNewAgent) {
      sprite.y = agent.y - 20;
      sprite.alpha = 0;
      (sprite as any)._arrivalFrames = 30;
      (sprite as any)._arrivalTargetY = agent.y;
    }

    // Agent hover tooltip
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointerenter", (e: any) => {
      if (this.callbacks?.onHover) {
        const global = e.global || e.data?.global || { x: 0, y: 0 };
        const description = agent.agentType
          ? AGENT_TYPE_DESCRIPTIONS[agent.agentType] || agent.agentType
          : agent.agentKind === "session" ? "IDE session" : "";
        this.callbacks.onHover({
          type: "agent",
          label: agent.displayName,
          details: description,
          x: global.x,
          y: global.y,
        });
      }
    });
    sprite.on("pointerleave", () => {
      if (this.callbacks?.onHover) {
        this.callbacks.onHover(null);
      }
    });

    this.agentLayer.addChild(sprite);
    this.agentSprites.set(agent.agentId, sprite);
  }

  /** Flush the current agent roster to the pulse system.
   *  Call this once after a batch of setAgent() calls to avoid O(N²) work. */
  flushPulse() {
    const agentList = Array.from(this.agents.values()).map((a) => ({
      status: a.status,
      district: undefined as string | undefined,
    }));
    this.pulse.onAgentUpdate(agentList);
  }

  /** Remove an agent — fades out over 20 frames before destroying */
  removeAgent(agentId: string) {
    this.agents.delete(agentId);
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.agentSprites.delete(agentId);
      // Begin fade-out instead of immediate destruction
      this.pendingRemovals.set(agentId, { sprite, framesLeft: 20 });
    }
  }

  /** Set the weather state (accepts raw states including "sunny") */
  setWeather(state: string, isManual = false) {
    if (isManual) this.manualWeatherOverride = true;
    // If user manually chose weather, ignore non-manual overrides
    if (this.manualWeatherOverride && !isManual) return;

    const isDay = state === "sunny";
    this.isDaytime = isDay;

    // Toggle sky day/night mode
    this.sky.setDaytime(isDay);

    // Daylight wash — brightens buildings, road, and ground during daytime
    this.dayOverlay.clear();
    if (isDay) {
      // Light blue wash over the entire scene
      this.dayOverlay.rect(-300, -800, this.width + 600, this.roadY + 800);
      this.dayOverlay.fill({ color: 0x6699cc, alpha: 0.3 });
      // Lighter wash over the road/ground area
      this.dayOverlay.rect(-300, this.roadY, this.width + 600, this.height);
      this.dayOverlay.fill({ color: 0x556688, alpha: 0.2 });
    }

    // Propagate daytime to subsystems
    this.clouds.setDaytime(isDay);
    this.backgroundCity.setDaytime(isDay);

    // Map "sunny" -> "clear" for the particle weather system (no precipitation)
    const weatherState = state === "sunny" ? "clear" : state;
    this.weather.setState(weatherState as WeatherState);

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

    // Update parallax background
    this.backgroundCity.update(dt);

    // Update ground layer (puddle shimmer)
    this.groundLayer.update(time);

    // Update weather particles
    this.weather.update(time, dt);

    // Update city pulse (must happen before ambient effects read it)
    this.pulse.update(time);

    // Power strain flicker flag for streetlamp glow variation
    this.powerStrainFlicker = this.pulse.powerStrain > 0.7;

    // Idle-triggered ambient changes
    if (this.pulse.idleDuration > 120_000) {
      this.pixelCat.setSleeping(true);
    } else {
      this.pixelCat.setSleeping(false);
    }
    if (this.pulse.idleDuration > 60_000 && !this.manualWeatherOverride) {
      this.setWeather("fog");
    }

    // Update ambient effects
    for (const vent of this.steamVents) {
      vent.update(dt);
    }
    this.pixelCat.update(time);

    // Drive traffic speed/density from pulse
    this.traffic.setActivityLevel(this.pulse.overallActivity);
    this.traffic.update(dt);

    // Update neon signs
    for (const sign of this.neonSigns) {
      sign.update(time);
    }

    // Update animated buildings (window flicker + roof details).
    // Use pulse.overallActivity when agents are present; fall back to a
    // gentle sine-wave so the city still feels alive when empty.
    const hasActivity = this.pulse.overallActivity > 0;
    const sineBase = 0.4 + Math.sin(time * 0.0002) * 0.2;
    const activityLevel = hasActivity ? this.pulse.overallActivity : sineBase;
    for (const building of this.animatedBuildings) {
      updateBuilding(building, time, dt, activityLevel);
      updateRoofDetails(building, time);
    }

    // Wander logic for walking citizen agents — pick new targets periodically
    for (const [, agent] of this.agents) {
      if (agent.status !== "walking" || !agent.agentId.startsWith("citizen-")) continue;
      const sprite = this.agentSprites.get(agent.agentId);
      if (!sprite) continue;
      const distToTarget = Math.abs(agent.targetX - sprite.x);
      if (distToTarget < 5) {
        // Arrived — pick a new random destination along the sidewalk
        const hqX = this.buildingPositions.get("HQ")?.x ?? 1420;
        agent.targetX = 80 + Math.random() * (hqX - 80);
        agent.targetY = this.roadY - 5;
      }
    }

    // Update agents — lerp toward target
    for (const [id, agent] of this.agents) {
      const sprite = this.agentSprites.get(id);
      if (!sprite) continue;

      // Arrival animation: lerp from above/transparent to final position
      const arrivalFrames = (sprite as any)._arrivalFrames as number | undefined;
      if (arrivalFrames !== undefined && arrivalFrames > 0) {
        const targetY = (sprite as any)._arrivalTargetY as number;
        const progress = 1 - arrivalFrames / 30; // 0 → 1 over 30 frames
        sprite.alpha = progress;
        sprite.y = targetY - 20 * (1 - progress);
        (sprite as any)._arrivalFrames = arrivalFrames - 1;

        if (arrivalFrames <= 1) {
          sprite.alpha = 1;
          sprite.y = targetY;
          (sprite as any)._arrivalFrames = undefined;
          (sprite as any)._arrivalTargetY = undefined;
        }

        updateAgent(sprite, time, dt);
        continue;
      }

      // Smooth movement toward target
      const dx = agent.targetX - sprite.x;
      const dy = agent.targetY - sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        sprite.x += dx * 0.03;
        sprite.y += dy * 0.03;
        // Set walking animation flag
        (sprite as any)._isMoving = true;

        // Flip sprite based on direction
        if (dx < 0) {
          sprite.scale.x = -Math.abs(sprite.scale.x);
        } else if (dx > 0) {
          sprite.scale.x = Math.abs(sprite.scale.x);
        }
      } else {
        (sprite as any)._isMoving = false;
      }

      updateAgent(sprite, time, dt);
    }

    // Pending removals — fade out then destroy
    for (const [id, pending] of this.pendingRemovals) {
      pending.framesLeft -= 1;
      // Lerp alpha from 1 → 0 over 20 frames
      pending.sprite.alpha = Math.max(0, pending.framesLeft / 20);

      if (pending.framesLeft <= 0) {
        this.agentLayer.removeChild(pending.sprite);
        pending.sprite.destroy();
        this.pendingRemovals.delete(id);
      }
    }
  }

  getAgentPosition(
    status: string,
    currentCommand: string | undefined,
    agentIndex: number,
    agentType?: string,
    agentKind?: "session" | "subagent"
  ): { x: number; y: number } {
    const sidewalkY = this.roadY - 5;
    const spacing = 20;
    const verticalSpacing = 22;

    // Helper: place agent inside building on left side near top, stacking vertically.
    // Wrap slot within building capacity so high global indices don't overflow below the building.
    const insideBuilding = (bldg: { x: number; y: number; width: number; height: number }, slot: number) => {
      const maxSlots = Math.max(1, Math.floor((bldg.height - 40) / verticalSpacing));
      const wrappedSlot = slot % maxSlots;
      return {
        x: bldg.x + 8,
        y: this.roadY - bldg.height + 45 + wrappedSlot * verticalSpacing,
      };
    };

    // --- Working agents go inside the relevant building (left side, near top) ---
    const isWorking = status === "reading" || status === "writing" || status === "thinking" || status === "stuck" || !!currentCommand;

    if (isWorking) {
      // 1. Tool-command mapping (highest priority)
      if (currentCommand) {
        const cmd = currentCommand;
        let building: string | undefined;
        if (cmd === "Read" || cmd === "Glob" || cmd === "Grep" || cmd === "Search" || cmd === "WebFetch" || cmd === "WebSearch") building = "Library";
        else if (cmd === "Write" || cmd === "Edit") building = "Workshop";
        else if (cmd === "Bash") building = "Terminal";

        if (building) {
          const pos = this.buildingPositions.get(building);
          if (pos) {
            return insideBuilding(pos, agentIndex);
          }
        }
      }

      // 2. Agent type home building
      if (agentType) {
        const home = AGENT_HOME_BUILDING[agentType];
        if (home) {
          const pos = this.buildingPositions.get(home);
          if (pos) {
            return insideBuilding(pos, agentIndex);
          }
        }
      }

      // 3. Fallback — use HQ
      const hq = this.buildingPositions.get("HQ");
      if (hq) {
        return insideBuilding(hq, agentIndex);
      }
    }

    // --- Idle / walking agents stay on sidewalk ---

    if (status === "walking") {
      const hqX = this.buildingPositions.get("HQ")?.x ?? 1420;
      const x = 80 + ((agentIndex * 137) % (hqX - 80));
      return { x, y: sidewalkY };
    }

    // Max x boundary — agents must stay within HQ right edge
    const maxX = (this.buildingPositions.get("HQ")?.x ?? 1420) + 130 - 20;

    // Idle: session agents go to Bar, subagents go to their home building's sidewalk or social spots
    if (agentKind === "session") {
      const barPos = this.buildingPositions.get("Bar");
      const spot = barPos || { x: 830, y: this.roadY, width: 110, height: 50 };
      const rawX = spot.x + 20 + agentIndex * spacing;
      // Wrap within spot width if overflowing
      const x = rawX > maxX ? spot.x + 20 + ((agentIndex * spacing) % Math.max(spot.width - 20, spacing)) : rawX;
      return { x, y: sidewalkY - 28 };
    }

    // Idle subagents: go to home building sidewalk area
    if (agentType) {
      const home = AGENT_HOME_BUILDING[agentType];
      if (home) {
        const pos = this.buildingPositions.get(home);
        if (pos) {
          const rawX = pos.x + 20 + agentIndex * spacing;
          const x = rawX > maxX ? pos.x + 20 + ((agentIndex * spacing) % Math.max(pos.width - 20, spacing)) : rawX;
          return { x, y: sidewalkY };
        }
      }
    }

    // Final fallback: spread across park/cafe/bar
    const parkPos = this.buildingPositions.get("Park");
    const cafePos = this.buildingPositions.get("Cafe");
    const barPos = this.buildingPositions.get("Bar");
    const spots = [
      parkPos  || { x: 510, y: this.roadY, width: 300, height: 50 },
      parkPos  || { x: 510, y: this.roadY, width: 300, height: 50 },
      cafePos  || { x: 380, y: this.roadY, width: 100, height: 50 },
      barPos   || { x: 830, y: this.roadY, width: 110, height: 50 },
    ];
    const spotIdx = agentIndex % spots.length;
    const spot = spots[spotIdx]!;
    const slotInSpot = Math.floor(agentIndex / spots.length);
    const spotWidth = spot.width - 20;
    const xOffset = 15 + (slotInSpot * spacing) % spotWidth;
    return { x: spot.x + xOffset, y: sidewalkY };
  }

  /** Get world dimensions for minimap */
  getWorldDimensions(): { width: number; height: number; roadYFraction: number } {
    return {
      width: WORLD_WIDTH,
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
    this.screenWidth = this.app.screen.width;
    this.camera.setWorldSize(WORLD_WIDTH, this.height);
    this.camera.fitCityToViewport(WORLD_WIDTH, this.roadY, 48);
  }

  destroy() {
    this.app.ticker.remove(this.update as any);
    this.camera.destroy();
    for (const [, sprite] of this.agentSprites) {
      sprite.destroy();
    }
    this.agentSprites.clear();
    this.agents.clear();
    for (const [, pending] of this.pendingRemovals) {
      pending.sprite.destroy();
    }
    this.pendingRemovals.clear();
  }
}
