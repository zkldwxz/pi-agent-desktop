/**
 * The fleet's state, and the small views of it a terminal can draw.
 *
 * Mirrors plan-mode's state.ts: one plain object published over the bus
 * (`agent-team:fleet`), the same shape the desktop consumes. Nothing here is
 * persisted — sub-agent sessions are in-memory, so the fleet exists only for
 * as long as the session that spawned it.
 */

export type FleetAgentStatus = "running" | "completed" | "interrupted" | "errored";

export interface FleetAgent {
	/** the task_name the model chose at spawn time */
	name: string;
	status: FleetAgentStatus;
	/** one line of the spawn message — what this agent is doing */
	task: string;
	/** "provider/model" as inherited at spawn time */
	model?: string;
	thinkingLevel?: string;
	spawnedAt: number;
	endedAt?: number;
	/** running total, refreshed from the session's own stats */
	tokens?: { input: number; output: number; total: number };
	cost?: number;
	/** a one-screen preview of `result`, for the panel and list output */
	summary?: string;
	/** the whole deliverable: the final answer (or the error text) as the root
	 *  receives it. Kept out of `list()` — the bus payload — and only attached
	 *  on the wait/wake delivery paths. */
	result?: string;
}

export interface FleetState {
	agents: FleetAgent[];
	updatedAt: number;
}

export const EMPTY_FLEET: FleetState = { agents: [], updatedAt: 0 };

const STATUS_MARK: Record<FleetAgentStatus, string> = {
	running: "◐",
	completed: "✓",
	interrupted: "✕",
	errored: "!",
};

export function truncate(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The status line: one glance, e.g. `team 1/3 · auth_audit running` */
export function statusLine(state: FleetState): string {
	const running = state.agents.filter((agent) => agent.status === "running");
	if (!running.length) return "";
	const rest = state.agents.length - running.length;
	const first = running[0];
	return `team ${running.length} run${running.length === 1 ? "" : "s"}${rest ? ` · ${rest} done` : ""} · ${truncate(first.name, 24)}`;
}

/** The widget: one row per agent, most recent first. */
export function widgetLines(state: FleetState): string[] {
	if (!state.agents.length) return [];
	return state.agents
		.slice(-6)
		.reverse()
		.map((agent) => {
			const tokens = agent.tokens ? ` · ${(agent.tokens.total / 1000).toFixed(1)}k` : "";
			return `${STATUS_MARK[agent.status]} ${truncate(agent.name, 28)}${tokens ? ` ${tokens}` : ""}`;
		});
}
