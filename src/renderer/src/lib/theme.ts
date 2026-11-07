import { useCallback, useEffect, useRef, useState } from "react";

export type ColorMode = "light" | "dark" | "system";

const MODE_KEY = "pi-color-mode";
/** accent themes are not built yet — the key exists so saved choices survive */
const THEME_KEY = "pi-accent-theme";

const QUERY = "(prefers-color-scheme: dark)";

const FALLBACK_HOT = "oklch(0.606 0.25 292.717)";

/** oklch → sRGB hex. The composer sweep is painted into a canvas gradient, so it
 *  is handed plain hex rather than a colour syntax the 2D context may not parse. */
function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lt = l + 0.3963377774 * a + 0.2158037573 * b;
  const mt = l - 0.1055613458 * a - 0.0638541728 * b;
  const st = l - 0.0894841775 * a - 1.291485548 * b;
  const [lc, mc, sc] = [lt ** 3, mt ** 3, st ** 3];
  const linear = [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
  const channel = (v: number) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, g)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(linear[0])}${channel(linear[1])}${channel(linear[2])}`;
}

/**
 * The composer sweep's palette: the hot hue, run through itself.
 *
 * The sweep only ever fires at Max depth (picking the flagship model, or the
 * depth slider reaching the top), and that is exactly where the track and the
 * level label turn purple — so the band is the same violet rather than the
 * accent blue the rest of the UI is painted in. It walks the hue from shade to
 * tint instead of through hues, which keeps the travelling light visible rather
 * than flattening into one flat block of purple.
 */
export function hotSweep(): readonly string[] {
  const raw =
    (typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--hot").trim()
      : "") || FALLBACK_HOT;
  const parts = raw.replace(/^oklch\(/, "").replace(/\)$/, "").split(/[\s/]+/).filter(Boolean);
  const [l, c, h] = parts.map(Number);
  if (parts.length < 3 || [l, c, h].some((n) => Number.isNaN(n))) {
    const hex = /^#|^rgb/.test(raw) ? raw : FALLBACK_HOT;
    return [hex, hex, hex];
  }
  const at = (delta: number, drift: number) =>
    oklchToHex(Math.max(0, Math.min(1, l + delta)), Math.max(0, c * 0.95), h + drift);
  return [at(-0.16, -10), at(-0.02, -3), at(0.13, 6), at(0.26, 12)];
}

/** `hotSweep()` re-read when the painted theme changes, not on every render. */
export function useHotSweep(): readonly string[] {
  const [palette, setPalette] = useState<readonly string[]>(hotSweep);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setPalette(hotSweep());
    const theme = window.matchMedia(QUERY);
    theme.addEventListener("change", read);
    const observed = new MutationObserver(read);
    observed.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => {
      theme.removeEventListener("change", read);
      observed.disconnect();
    };
  }, []);
  return palette;
}

function readMode(): ColorMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // migrate the boolean the app used before colour modes existed
  const legacy = localStorage.getItem("pi-theme");
  if (legacy === "dark") return "dark";
  if (legacy === "light") return "light";
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export interface ThemeState {
  /** what the user picked */
  mode: ColorMode;
  /** what is actually painted right now */
  dark: boolean;
  /** reserved: accent theme id, empty until themes ship */
  accent: string;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
  /** freezes transitions for two frames so a flip is one clean repaint */
  frozen: boolean;
}

/**
 * Colour mode.
 *
 * Three states, not two: `system` is a real choice and has to keep tracking the
 * OS after it is picked, so the media query stays subscribed rather than being
 * read once. The legacy boolean the app used before is migrated on read.
 */
export function useTheme(): ThemeState {
  const [mode, setModeState] = useState<ColorMode>(readMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [frozen, setFrozen] = useState(false);
  /* false until the first effect: the boot paint must not animate */
  const painted = useRef(false);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const dark = mode === "system" ? systemDark : mode === "dark";

  useEffect(() => {
    const root = document.documentElement;
    if (frozen) root.classList.add("theme-switching");
    const flip = () => root.classList.toggle("dark", dark);
    /* a real light↔dark change crossfades the window (baocode fades its
       content out and back in over the canvas colour); the first paint and a
       mode change that keeps the same look (dark → system-while-dark) do not */
    const changes = root.classList.contains("dark") !== dark;
    const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown })
      .startViewTransition;
    if (changes && start && painted.current) start.call(document, flip);
    else flip();
    painted.current = true;
    localStorage.setItem(MODE_KEY, mode);
    if (!frozen) return;
    // hold the freeze for two frames so the token swap is one repaint
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setFrozen(false)));
    return () => cancelAnimationFrame(frame);
  }, [dark, mode, frozen]);

  const setMode = useCallback((next: ColorMode) => {
    setFrozen(true);
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setFrozen(true);
    setModeState((current) => {
      const resolved = current === "system" ? (systemPrefersDark() ? "dark" : "light") : current;
      return resolved === "dark" ? "light" : "dark";
    });
  }, []);

  return {
    mode,
    dark,
    accent: localStorage.getItem(THEME_KEY) ?? "",
    setMode,
    toggle,
    frozen,
  };
}
