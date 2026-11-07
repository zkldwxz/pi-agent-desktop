/**
 * Window-level appearance preferences that are not the colour mode or the code
 * palette: the code font, ligatures, conversation width and whether the
 * sidebar shows times. Ported from baocode's Settings ▸ Appearance
 * (`lib/settings/pages/appearance_page.dart`).
 *
 * Like the code theme these never touch pi's settings.json — they live in
 * localStorage and paint through attributes and variables on <html>, so CSS
 * does the work and no component re-renders to follow them.
 */

export type ChatWidth = "default" | "full";

export interface AppearancePrefs {
  /** a font family name; empty = the bundled Geist Mono */
  codeFont: string;
  ligatures: boolean;
  chatWidth: ChatWidth;
  sidebarTimes: boolean;
}

export const APPEARANCE_DEFAULT: AppearancePrefs = {
  codeFont: "",
  ligatures: true,
  chatWidth: "default",
  sidebarTimes: true,
};

const KEY = "pi:appearance";
const BUNDLED_MONO = '"Geist Mono Variable"';

const listeners = new Set<(prefs: AppearancePrefs) => void>();

export function loadAppearance(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return APPEARANCE_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<AppearancePrefs>;
    return {
      codeFont: typeof parsed.codeFont === "string" ? parsed.codeFont : APPEARANCE_DEFAULT.codeFont,
      ligatures: typeof parsed.ligatures === "boolean" ? parsed.ligatures : APPEARANCE_DEFAULT.ligatures,
      chatWidth: parsed.chatWidth === "full" ? "full" : "default",
      sidebarTimes: typeof parsed.sidebarTimes === "boolean" ? parsed.sidebarTimes : APPEARANCE_DEFAULT.sidebarTimes,
    };
  } catch {
    return APPEARANCE_DEFAULT;
  }
}

/** A family name as a CSS value: quoted, with quotes and backslashes the
 *  user typed stripped so a stray `"` cannot break out of the declaration. */
function familyValue(name: string): string {
  const clean = name.replace(/["\\;{}]/g, "").trim();
  return clean ? `"${clean}", ${BUNDLED_MONO}` : BUNDLED_MONO;
}

export function applyAppearance(prefs: AppearancePrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--font-mono-face", familyValue(prefs.codeFont));
  root.dataset.ligatures = prefs.ligatures ? "on" : "off";
  root.dataset.chatWidth = prefs.chatWidth;
  root.dataset.sidebarTimes = prefs.sidebarTimes ? "on" : "off";
}

export function saveAppearance(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* a full quota still leaves the running window painted */
  }
  applyAppearance(prefs);
  for (const listener of listeners) listener(prefs);
}

export function onAppearance(listener: (prefs: AppearancePrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
