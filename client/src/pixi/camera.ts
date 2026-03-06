/**
 * Camera system for pan/zoom on the Pixi canvas.
 * Wraps a world Container and handles mouse/keyboard input.
 */

import { Container, type Application, FederatedPointerEvent } from "pixi.js";

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZoom: number;
  maxZoom: number;
}

export class Camera {
  readonly world: Container;
  private app: Application;
  private bounds: CameraBounds;

  // State
  private _zoom = 1;
  private _panX = 0;
  private _panY = 0;

  /**
   * The base zoom level set by auto-fit when the viewport resizes.
   * User scroll/keyboard zoom is applied multiplicatively on top of this,
   * so manual interactions feel relative to the current fit, not absolute.
   */
  private _baseZoom = 1;

  // Dragging
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  // Keyboard panning
  private keysDown = new Set<string>();
  private readonly PAN_SPEED = 8;

  constructor(app: Application, bounds?: Partial<CameraBounds>) {
    this.app = app;
    this.world = new Container();

    const screenW = app.screen.width;
    const screenH = app.screen.height;

    this.bounds = {
      minX: -screenW * 0.5,
      maxX: screenW * 0.5,
      minY: -screenH * 0.3,
      maxY: screenH * 0.3,
      minZoom: 0.2,
      maxZoom: 3,
      ...bounds,
    };

    // Set pivot to screen center for zoom-toward-center behavior
    this.world.pivot.set(screenW / 2, screenH / 2);
    this.world.position.set(screenW / 2, screenH / 2);

    this.setupMouseEvents();
    this.setupKeyboardEvents();
  }

  get zoom(): number {
    return this._zoom;
  }

  get panX(): number {
    return this._panX;
  }

  get panY(): number {
    return this._panY;
  }

  private setupMouseEvents() {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;

    // Wheel zoom
    this.app.canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      this.setZoom(this._zoom * zoomDelta);
    }, { passive: false });

    // Drag pan
    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      // Only pan with middle mouse button or if holding space
      if (e.button === 1 || this.keysDown.has(" ")) {
        this.dragging = true;
        this.dragStartX = e.globalX;
        this.dragStartY = e.globalY;
        this.panStartX = this._panX;
        this.panStartY = this._panY;
      }
    });

    stage.on("pointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      const dx = e.globalX - this.dragStartX;
      const dy = e.globalY - this.dragStartY;
      this.setPan(
        this.panStartX + dx / this._zoom,
        this.panStartY + dy / this._zoom
      );
    });

    stage.on("pointerup", () => {
      this.dragging = false;
    });

    stage.on("pointerupoutside", () => {
      this.dragging = false;
    });
  }

  private setupKeyboardEvents() {
    const onKeyDown = (e: KeyboardEvent) => {
      this.keysDown.add(e.key);

      // Zoom with +/-
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        this.setZoom(this._zoom * 1.15);
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        this.setZoom(this._zoom * 0.87);
      }
      // Reset zoom with 0
      if (e.key === "0") {
        this.setZoom(1);
        this.setPan(0, 0);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  /** Call every frame to handle keyboard panning */
  update(_dt: number) {
    let dx = 0;
    let dy = 0;

    if (this.keysDown.has("ArrowLeft")) dx += this.PAN_SPEED;
    if (this.keysDown.has("ArrowRight")) dx -= this.PAN_SPEED;
    if (this.keysDown.has("ArrowUp")) dy += this.PAN_SPEED;
    if (this.keysDown.has("ArrowDown")) dy -= this.PAN_SPEED;

    if (dx !== 0 || dy !== 0) {
      this.setPan(this._panX + dx, this._panY + dy);
    }
  }

  setZoom(z: number) {
    // When a base (fit) zoom is active, the minimum interactive zoom is the
    // base zoom itself — the user should never be able to zoom out further than
    // the auto-fit level that keeps all city content visible.
    const effectiveMin = Math.min(this.bounds.minZoom, this._baseZoom);
    this._zoom = Math.max(effectiveMin, Math.min(this.bounds.maxZoom, z));
    this.applyTransform();
  }

  /**
   * Adjust zoom so the city world (worldWidth pixels wide) exactly fills the
   * current viewport width. Call this whenever the viewport resizes due to a
   * sidebar opening or closing.
   *
   * The computed zoom becomes the new interactive minimum — users can zoom in
   * further but cannot zoom out past the fit level.
   */
  fitToWidth(worldWidth: number) {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    if (screenW <= 0 || worldWidth <= 0) return;

    // Update pivot to match current screen dimensions (may change on resize)
    this.world.pivot.set(screenW / 2, screenH / 2);

    const fitZoom = screenW / worldWidth;
    // Allow fit zoom to go below the normal minZoom floor (e.g. on very narrow
    // viewports), but never exceed the configured maximum.
    const clampedFit = Math.min(fitZoom, this.bounds.maxZoom);
    this._baseZoom = clampedFit;

    // Only apply the fit if the current zoom would clip content — i.e. if the
    // current zoom is larger than the fit level (world would overflow viewport).
    // If the user has already zoomed out further (smaller zoom), keep it.
    if (this._zoom > clampedFit) {
      this._zoom = clampedFit;
    }

    this.applyTransform();
  }

  /**
   * Fit the city into the viewport so buildings span the full width.
   *
   * contentWidth  — full world width (WORLD_WIDTH px).
   * roadY         — world-space Y coordinate of the road surface.
   * bottomMargin  — screen pixels to reserve below the road for the bottom bar.
   *
   * Uses width-based zoom only so all buildings are always visible with no
   * horizontal cropping. The sky gradient fills the vertical space above
   * the buildings (extended in sky-renderer.ts to cover any visible area).
   */
  fitCityToViewport(contentWidth: number, roadY: number, bottomMargin = 60) {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    if (screenW <= 0 || screenH <= 0 || contentWidth <= 0) return;

    // Update pivot to match current screen dimensions (may change on resize)
    this.world.pivot.set(screenW / 2, screenH / 2);

    // Width-based zoom: city fills the viewport horizontally
    const fitZoom = screenW / contentWidth;
    const clampedFit = Math.min(fitZoom, this.bounds.maxZoom);
    this._baseZoom = clampedFit;
    this._zoom = clampedFit;

    // Y bounds: set generous bounds so the vertical pan that anchors the road
    // at the bottom is never clamped away.
    const maxPanY = screenH / this._zoom;
    this.bounds.minY = -maxPanY;
    this.bounds.maxY = maxPanY;

    // Center the world horizontally: shift so world midpoint aligns with
    // screen midpoint. The pivot is at screenW/2 in world coords, so when
    // contentWidth ≠ screenW the default panX=0 leaves the city off-center.
    const panX = (screenW - contentWidth) / 2;

    // X bounds: accommodate the centering offset + any scroll room
    const scaledWorldW = contentWidth * this._zoom;
    const excessX = Math.max(0, (scaledWorldW - screenW) / 2 / this._zoom);
    const centerPad = Math.abs(panX) + 50;
    this.bounds.minX = -(excessX + centerPad);
    this.bounds.maxX = excessX + centerPad;

    // Road strip extends 85px below roadY (60px road + 25px car strip).
    const roadBottomWorldY = roadY + 85; // 60px road + 25px car strip
    const targetScreenY = screenH - bottomMargin;

    // Derive panY so that world point roadBottomWorldY maps to targetScreenY.
    // Screen coordinate formula (from applyTransform + pivot):
    //   sy = (wy - screenH/2) * zoom + screenH/2 + panY*zoom
    // Solving for panY:
    //   panY = (targetScreenY - screenH/2) / zoom - (roadBottomWorldY - screenH/2)
    const panY = (targetScreenY - screenH / 2) / this._zoom - (roadBottomWorldY - screenH / 2);

    this._panX = panX;
    this._panY = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, panY));

    this.applyTransform();
  }

  /**
   * Update the pan bounds to accommodate a wider/taller world.
   * Call this after building the city with a new world size so the user
   * can pan across the full extent without the camera clipping at old
   * screen-width limits.
   *
   * minX / maxX are set so the world edges stay reachable:
   *   panX range = [-(worldWidth - screenWidth)/2, (worldWidth - screenWidth)/2]
   * which centres the world at panX=0 and lets the user reach both edges.
   */
  setWorldSize(worldWidth: number, worldHeight?: number) {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    // Half the "excess" world beyond the viewport — this is how far the user
    // can pan left or right before the world edge exits the screen.
    const excessX = Math.max(0, (worldWidth - screenW) / 2);
    const excessY = worldHeight != null ? Math.max(0, (worldHeight - screenH) / 2) : this.bounds.maxY;

    this.bounds.minX = -excessX;
    this.bounds.maxX = excessX;
    this.bounds.minY = -excessY;
    this.bounds.maxY = excessY;
  }

  setPan(x: number, y: number) {
    this._panX = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, x));
    this._panY = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, y));
    this.applyTransform();
  }

  /** Smoothly focus on a world-space position */
  focusOn(worldX: number, worldY: number, targetZoom?: number) {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.setPan(screenW / 2 - worldX, screenH / 2 - worldY);
    if (targetZoom) this.setZoom(targetZoom);
  }

  private applyTransform() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.world.scale.set(this._zoom);
    this.world.position.set(
      screenW / 2 + this._panX * this._zoom,
      screenH / 2 + this._panY * this._zoom
    );
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    return {
      x: (screenX - screenW / 2 - this._panX * this._zoom) / this._zoom + screenW / 2,
      y: (screenY - screenH / 2 - this._panY * this._zoom) / this._zoom + screenH / 2,
    };
  }

  destroy() {
    // Keyboard listeners are on window — ideally store refs and remove.
    // For now the app destroys before this matters.
  }
}
