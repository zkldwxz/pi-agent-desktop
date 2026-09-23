import { useSyncExternalStore } from "react";
import { t } from "./i18n";

/**
 * The shell's keyboard shortcuts.
 *
 * Every chord the renderer answers is declared here once, so the key handler,
 * the tooltips, the command palette's hint column and the Settings ▸ 快捷键
 * table can never drift apart. Chords the user rebinds are stored per machine
 * in localStorage — they are about this window, not about the agent, so they
 * do not belong in ~/.pi/agent/settings.json.
 */

export type Chord = {
  /** normalised `KeyboardEvent.key`: lowercase letter, ",", "-", "+", "0", "escape"… */
  key: string;
  /** Ctrl on Windows/Linux, Cmd on macOS */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type ShortcutGroup = "Conversation" | "Views & panels" | "Interface scale";

export type ShortcutSpec = {
  id: string;
  group: ShortcutGroup;
  /** English source string; translated through the i18n map when displayed */
  label: string;
  /** what ships with the app — also what a single row resets to */
  fallback: Chord;
  /** wheel chords have no printable key, so they are shown but not recorded */
  rebindable?: boolean;
};

export const SHORTCUTS: ShortcutSpec[] = [
  { id: "abort", group: "Conversation", label: "Abort the running turn", fallback: { key: "escape" } },
  { id: "palette", group: "Conversation", label: "Open the command palette", fallback: { mod: true, key: "k" } },
  { id: "newSession", group: "Conversation", label: "Start a new session", fallback: { mod: true, key: "n" } },
  { id: "focusComposer", group: "Conversation", label: "Focus the composer", fallback: { mod: true, key: "l" } },
  { id: "settings", group: "Views & panels", label: "Open settings", fallback: { mod: true, key: "," } },
  { id: "usage", group: "Views & panels", label: "Open usage & cache", fallback: { mod: true, key: "u" } },
  { id: "dock", group: "Views & panels", label: "Toggle the right dock", fallback: { mod: true, key: "b" } },
  { id: "designMode", group: "Views & panels", label: "Toggle design mode", fallback: { mod: true, shift: true, key: "d" } },
  { id: "zoomIn", group: "Interface scale", label: "Zoom in", fallback: { mod: true, key: "+" } },
  { id: "zoomOut", group: "Interface scale", label: "Zoom out", fallback: { mod: true, key: "-" } },
  { id: "zoomReset", group: "Interface scale", label: "Reset the zoom", fallback: { mod: true, key: "0" } },
  {
    id: "zoomWheel",
    group: "Interface scale",
    label: "Zoom the interface with the wheel",
    fallback: { mod: true, key: "wheel" },
    rebindable: false,
  },
];

const KEY = "pi-shortcuts";
/** one binding per row: `null` means "cleared on purpose" */
let overrides: Record<string, Chord | null> = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<string, Chord | null>;
  } catch {
    /* corrupt or unavailable */
  }
  return {};
})();

const listeners = new Set<() => void>();
let captureActive = false;

/* getSnapshot must hand back a stable reference between renders */
let chordsCache: Record<string, Chord | null> | null = null;

function emit(): void {
  chordsCache = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* private mode */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `=` is `+` without shift, and the two layouts should not be two shortcuts. */
export function normalizeKey(raw: string): string {
  if (raw === "=") return "+";
  if (raw.length === 1) return raw.toLowerCase();
  return raw.toLowerCase();
}

export function chordOf(id: string): Chord | null {
  const spec = SHORTCUTS.find((entry) => entry.id === id);
  if (!spec) return null;
  return overrides[id] === undefined ? spec.fallback : overrides[id];
}

/** Re-render the caller whenever a chord is rebound. */
export function useShortcuts(): Record<string, Chord | null> {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!chordsCache) {
        chordsCache = Object.fromEntries(SHORTCUTS.map((spec) => [spec.id, chordOf(spec.id)]));
      }
      return chordsCache;
    },
    () => chordsCache ?? {},
  );
}

export function formatChord(chord: Chord | null): string {
  if (!chord) return "";
  const parts: string[] = [];
  if (chord.mod) parts.push(navigator.platform?.startsWith("Mac") ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(navigator.platform?.startsWith("Mac") ? "⌥" : "Alt");
  if (chord.shift) parts.push("Shift");
  parts.push(prettyKey(chord.key));
  return parts.join(navigator.platform?.startsWith("Mac") ? "" : "+");
}

function prettyKey(key: string): string {
  if (key === "escape") return "Esc";
  if (key === "wheel") return navigator.platform?.startsWith("Mac") ? "滚轮" : "Scroll";
  if (key === ",") return ",";
  if (key === "+") return "+";
  if (key === "-") return "-";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The chord text shown in a tooltip or a hint column. */
export function shortcutHint(id: string): string {
  const chord = chordOf(id);
  return chord ? formatChord(chord) : t("Unassigned");
}

/** the modifier state a wheel event carries, so one matcher serves both */
export type ModifierEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function matches(event: ModifierEvent, chord: Chord | null): boolean {
  if (!chord) return false;
  if (normalizeKey(event.key) !== chord.key) return false;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (chord.mod !== undefined && chord.mod !== mod) return false;
  if (!chord.mod && (event.ctrlKey || event.metaKey)) return false;
  if (Boolean(chord.alt) !== event.altKey) return false;
  if (chord.shift && !event.shiftKey) return false;
  return true;
}

/** Which shortcut an event fires, or null. The first declared match wins. */
export function resolveEvent(event: KeyboardEvent): string | null {
  if (captureActive) return null;
  for (const spec of SHORTCUTS) {
    if (spec.rebindable === false) continue;
    if (matches(event, chordOf(spec.id))) return spec.id;
  }
  return null;
}

export function isCapturing(): boolean {
  return captureActive;
}

/** Hold the global handler still while a row is being recorded. */
export function beginCapture(): void {
  captureActive = true;
}

export function endCapture(): void {
  captureActive = false;
}

export function setChord(id: string, chord: Chord | null): void {
  overrides = { ...overrides, [id]: chord };
  emit();
}

export function resetChord(id: string): void {
  const next = { ...overrides };
  delete next[id];
  overrides = next;
  emit();
}

export function resetAll(): void {
  overrides = {};
  emit();
}

export function isDefault(id: string): boolean {
  return overrides[id] === undefined;
}

/** ids that share a chord with at least one other id */
export function findConflicts(): Map<string, string[]> {
  const byChord = new Map<string, string[]>();
  for (const spec of SHORTCUTS) {
    const chord = chordOf(spec.id);
    if (!chord) continue;
    const signature = `${chord.mod ? "c" : ""}${chord.alt ? "a" : ""}${chord.shift ? "s" : ""}:${chord.key}`;
    const bucket = byChord.get(signature) ?? [];
    bucket.push(spec.id);
    byChord.set(signature, bucket);
  }
  const conflicts = new Map<string, string[]>();
  for (const bucket of byChord.values()) {
    if (bucket.length > 1) {
      for (const id of bucket) conflicts.set(id, bucket.filter((other) => other !== id));
    }
  }
  return conflicts;
}

/** Turn a live keydown into the chord a recording row should store. */
export function chordFromEvent(event: KeyboardEvent): Chord | null {
  const key = normalizeKey(event.key);
  if (key === "escape" || key === "control" || key === "meta" || key === "shift" || key === "alt") return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (!mod && !event.altKey && !event.shiftKey) {
    // a bare key would swallow normal typing — only Esc may be bare
    return null;
  }
  return { key, mod, shift: event.shiftKey || undefined, alt: event.altKey || undefined };
}
