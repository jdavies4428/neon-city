import { Application, TextureStyle } from "pixi.js";

// Crisp pixel art — must be set before any texture creation
TextureStyle.defaultOptions.scaleMode = "nearest";

let app: Application | null = null;

export async function initCityApp(
  canvas: HTMLCanvasElement
): Promise<Application> {
  if (app) {
    app.destroy(true);
  }

  app = new Application();

  await app.init({
    canvas,
    backgroundColor: 0x05050f,
    antialias: false,
    resolution: 1,
    autoDensity: true,
  });

  // Size to the current viewport immediately so there is no blank frame.
  app.renderer.resize(window.innerWidth, window.innerHeight);

  return app;
}

export function getCityApp(): Application | null {
  return app;
}

/**
 * Manually resize the PixiJS renderer to the given pixel dimensions.
 * Call this from a ResizeObserver or window resize handler instead of
 * relying on `resizeTo`, which can cause infinite ResizeObserver loops.
 */
export function resizeCityApp(width: number, height: number): void {
  if (!app?.renderer) return;
  app.renderer.resize(width, height);
}

export function destroyCityApp() {
  if (app) {
    app.destroy(true);
    app = null;
  }
}
