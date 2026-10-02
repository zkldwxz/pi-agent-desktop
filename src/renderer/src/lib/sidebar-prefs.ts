import type { WorkspacePrefs } from "../components/agent/WorkspaceList";

/* Sidebar grouping prefs are read in two places — the sidebar owns the state,
 * but Settings' general page edits the same value — so load/save/subscribe
 * live here instead of inside the component tree. */

const KEY = "pi-workspace-prefs";

export const SIDEBAR_PREFS_DEFAULT: WorkspacePrefs = {
  group: "workspace",
  order: "recent",
  show: 3,
  statusFilter: "all",
};

const listeners = new Set<(prefs: WorkspacePrefs) => void>();

export function loadSidebarPrefs(fallback: WorkspacePrefs): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) };
  } catch {
    return fallback;
  }
}

/** Persists and notifies subscribers. The sidebar also saves through this on
 *  its own state changes; the echo is harmless because React bails out when a
 *  state update carries the identical object. */
export function saveSidebarPrefs(prefs: WorkspacePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  for (const listener of listeners) listener(prefs);
}

export function onSidebarPrefs(listener: (prefs: WorkspacePrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
