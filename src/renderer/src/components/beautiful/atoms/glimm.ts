/**
 * Minimal, dependency-free stand-in for `glimm`.
 *
 * `PromptBar` uses it to fire a one-shot rainbow sweep across the composer when
 * the model changes. The real package ships a WebGL shader; this implements the
 * same public surface on canvas 2D so the effect still exists without pulling a
 * GPU dependency into the desktop bundle.
 *
 * Public surface kept: `ACCENTS`, `accentChain`, `createShader`, `playSweep`.
 */

export const ACCENTS = {
  red: "#f0503c",
  orange: "#f08a3c",
  yellow: "#e8c33c",
  green: "#3cae6a",
  cyan: "#3cb8c8",
  blue: "#3c6ef0",
  purple: "#8a5cf0",
} as const;

export function accentChain(colors: readonly string[]): string[] {
  return [...colors];
}

export interface ShaderOptions {
  canvas: HTMLCanvasElement;
  palette: readonly string[];
  direction?: "ltr" | "rtl";
  bandTight?: number;
  swellAmount?: number;
}

export interface Shader {
  canvas: HTMLCanvasElement;
  palette: readonly string[];
  direction: "ltr" | "rtl";
  destroy: () => void;
}

export function createShader(options: ShaderOptions): Shader {
  return {
    canvas: options.canvas,
    palette: options.palette,
    direction: options.direction ?? "ltr",
    destroy: () => {
      const ctx = options.canvas.getContext("2d");
      ctx?.clearRect(0, 0, options.canvas.width, options.canvas.height);
    },
  };
}

export interface SweepOptions {
  palette?: readonly string[];
  direction?: "ltr" | "rtl";
  sweepMs?: number;
  outroMs?: number;
  peakAlpha?: number;
  bandTight?: number;
  brightness?: number;
  swellAmount?: number;
  waveSpeed?: number;
  easing?: "easeOutExpo" | "linear";
}

export interface Sweep {
  done: Promise<void>;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function resize(canvas: HTMLCanvasElement): { width: number; height: number } {
  // A full-resolution backing store for a decorative sweep is a waste: the band
  // is soft anyway, so half resolution is invisible and a quarter of the pixels.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  return { width, height };
}

/**
 * The band, drawn once.
 *
 * The original painted a spectrum gradient and then ran a `ctx.filter` blur over
 * the whole canvas *every frame* — a software blur of a few hundred thousand
 * pixels per frame, which is what made the sweep stutter. The soft falloff is
 * baked into a small offscreen strip instead (one pass, at ~1/20 the pixels), so
 * each frame is a single `drawImage`.
 */
function bandStrip(palette: readonly string[]): HTMLCanvasElement {
  const strip = document.createElement("canvas");
  strip.width = 512;
  strip.height = 64;
  const ctx = strip.getContext("2d");
  if (!ctx) return strip;
  const spectrum = ctx.createLinearGradient(0, 0, strip.width, 0);
  const stops = Math.max(1, palette.length - 1);
  palette.forEach((color, index) => spectrum.addColorStop(index / stops, color));
  ctx.fillStyle = spectrum;
  ctx.fillRect(0, 0, strip.width, strip.height);
  // dissolve both ends so the band has no hard edges
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createLinearGradient(0, 0, strip.width, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.16, "rgba(0,0,0,0.55)");
  fade.addColorStop(0.5, "rgba(0,0,0,1)");
  fade.addColorStop(0.84, "rgba(0,0,0,0.55)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, strip.width, strip.height);
  return strip;
}

export function playSweep(shader: Shader, options: SweepOptions = {}): Sweep {
  const {
    palette = shader.palette,
    direction = shader.direction,
    sweepMs = 560,
    outroMs = 90,
    peakAlpha = 1.3,
    bandTight = 10,
    brightness = 1.4,
    easing = "easeOutExpo",
  } = options;

  const canvas = shader.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { done: Promise.resolve() };

  const state = resize(canvas);
  const dpr = canvas.width / state.width;
  const ease = easing === "linear" ? (t: number) => t : easeOutExpo;
  const band = Math.max(0.08, 1 / Math.max(1, bandTight));
  const total = sweepMs + outroMs;
  const start = performance.now();
  const strip = palette.length ? bandStrip(palette) : null;

  let raf = 0;
  let settle: () => void = () => {};

  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const frame = (now: number) => {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / total);
    const sweep = ease(Math.min(1, elapsed / sweepMs));
    const head = direction === "ltr" ? sweep : 1 - sweep;
    const alpha = elapsed > sweepMs ? Math.max(0, 1 - (elapsed - sweepMs) / outroMs) : 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    if (alpha > 0.002 && strip) {
      const x = head * state.width;
      const half = Math.max(24, state.width * band);
      ctx.globalAlpha = Math.min(1, alpha * peakAlpha * 0.75 * brightness);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(strip, x - half * 1.6, 0, half * 3.2, state.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    if (progress < 1) {
      raf = requestAnimationFrame(frame);
      return;
    }

    ctx.clearRect(0, 0, state.width, state.height);
    settle();
  };

  raf = requestAnimationFrame(frame);

  return {
    done: done.finally(() => cancelAnimationFrame(raf)),
  };
}
