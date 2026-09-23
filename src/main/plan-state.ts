import type { PlanState } from "@shared/types";

/**
 * The state the window shows before any plugin has said anything.
 *
 * Plan mode is a plugin: it publishes its own state over pi's event bus on
 * session start, and the desktop bridge mirrors it into `HostState.plan`. This
 * is only the value that fills the field in between — and the one left behind
 * when the plugin is not installed at all.
 */
export const EMPTY_PLAN: PlanState = { phase: "off", steps: [], updatedAt: 0 };
