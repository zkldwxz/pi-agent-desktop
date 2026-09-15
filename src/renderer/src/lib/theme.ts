import { useCallback, useEffect, useState } from "react";

export type ColorMode = "light" | "dark" | "system";

const MODE_KEY = "pi-color-mode";
/** accent themes are not built yet — the key exists so saved choices survive */
const THEME_KEY = "pi-accent-theme";

const QUERY = "(prefers-color-scheme: dark)";

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
    root.classList.toggle("dark", dark);
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
