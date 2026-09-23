/**
 * The code colour palette, as a window-level preference.
 *
 * Syntax colours come from `styles/hljs-themes.css`: every `.hljs-*` rule maps
 * to a `--code-*` variable, and the theme blocks key off
 * `<html data-code-theme="…">`. Each theme carries a light and a dark palette,
 * so a block follows the window's colour mode — the code style only picks the
 * family, exactly like the accent palettes that will arrive later.
 */

export type CodeTheme = "github" | "one" | "dracula";

export const CODE_THEMES: Array<{ id: CodeTheme; label: string }> = [
  { id: "github", label: "GitHub" },
  { id: "one", label: "One" },
  { id: "dracula", label: "Dracula" },
];

const KEY = "pi:code-theme";
const KNOWN = new Set<string>(CODE_THEMES.map((theme) => theme.id));

export function getCodeTheme(): CodeTheme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored && KNOWN.has(stored) ? (stored as CodeTheme) : "github";
  } catch {
    return "github";
  }
}

export function applyCodeTheme(theme: CodeTheme): void {
  document.documentElement.dataset.codeTheme = theme;
}

export function setCodeTheme(theme: CodeTheme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* a full storage quota still leaves the running window themed */
  }
  applyCodeTheme(theme);
}
