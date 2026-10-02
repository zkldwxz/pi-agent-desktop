import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FleetAgent, PlanState, SlashCommand } from "@shared/types";
import { EMPTY_PLAN } from "./plan-state";

/**
 * The window's side of the extension bus.
 *
 * Extensions talk to whatever is hosting pi; a terminal draws their status
 * lines, and this is what a window does instead. Three jobs:
 *
 * - **Plan state.** The plan-mode extension publishes its state on
 *   `plan-mode:state`; we mirror it into `HostState.plan` so React can render
 *   the pill, the review card and the dock without knowing the extension exists.
 *   A ping on session start makes it re-announce — the extension is loaded
 *   before this subscription exists, and its first publish would be missed.
 * - **Fleet state.** Same dance for the agent-team extension on
 *   `agent-team:fleet`: the delegation fleet's sub-agents, mirrored into
 *   `HostState.fleet` for the fleet panel.
 * - **Command discovery.** `pi.getCommands()` is the session's real slash-command
 *   list: extension commands, prompt templates and skills in one place. The `/`
 *   menu reads it, so a plugin's command appears without the desktop knowing
 *   anything about that plugin.
 *
 * It is always on. It is plumbing, not a feature.
 */

const BUS_STATE = "plan-mode:state";
const BUS_PING = "plan-mode:ping";
const BUS_FLEET = "agent-team:fleet";
const BUS_FLEET_PING = "agent-team:ping";

/** Anything a plugin hands us is untrusted input until it matches the shape. */
function coercePlan(raw: unknown): PlanState {
	if (!raw || typeof raw !== "object") return { ...EMPTY_PLAN, updatedAt: Date.now() };
	const record = raw as Record<string, unknown>;
	const phase = record.phase;
	const steps = Array.isArray(record.steps)
		? record.steps.slice(0, 60).map((step, index) => {
				const item = step as Record<string, unknown>;
				const status = item.status;
				return {
					id: typeof item.id === "string" ? item.id : `step-${index + 1}`,
					label: String(item.label ?? `Step ${index + 1}`).slice(0, 200),
					detail: item.detail ? String(item.detail).slice(0, 400) : undefined,
					status:
						status === "running" || status === "done" || status === "failed"
							? (status as "running" | "done" | "failed")
							: ("pending" as const),
				};
			})
		: [];
	const parent = record.parentModel as { provider?: unknown; id?: unknown } | undefined;
	return {
		phase:
			phase === "planning" || phase === "review" || phase === "executing"
				? (phase as PlanState["phase"])
				: "off",
		path: typeof record.path === "string" ? record.path : undefined,
		title: typeof record.title === "string" ? record.title : undefined,
		notes: typeof record.body === "string" ? record.body.slice(0, 8000) : undefined,
		steps,
		parentModel:
			parent && typeof parent.provider === "string" && typeof parent.id === "string"
				? { provider: parent.provider, id: parent.id }
				: undefined,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
	};
}

/** Same rule for the fleet: one defensive coercion, then it is ours. */
function coerceFleet(raw: unknown): FleetAgent[] {
	if (!raw || typeof raw !== "object") return [];
	const agents = (raw as Record<string, unknown>).agents;
	if (!Array.isArray(agents)) return [];
	return agents.slice(0, 32).map((entry, index) => {
		const item = entry as Record<string, unknown>;
		const status = item.status;
		const tokens = item.tokens as { input?: unknown; output?: unknown; total?: unknown } | undefined;
		return {
			name: typeof item.name === "string" ? item.name.slice(0, 64) : `agent-${index + 1}`,
			status:
				status === "running" || status === "completed" || status === "interrupted" || status === "errored"
					? (status as FleetAgent["status"])
					: ("running" as const),
			task: typeof item.task === "string" ? item.task.slice(0, 200) : "",
			model: typeof item.model === "string" ? item.model.slice(0, 120) : undefined,
			thinkingLevel: typeof item.thinkingLevel === "string" ? item.thinkingLevel.slice(0, 24) : undefined,
			spawnedAt: typeof item.spawnedAt === "number" ? item.spawnedAt : Date.now(),
			endedAt: typeof item.endedAt === "number" ? item.endedAt : undefined,
			tokens:
				tokens && typeof tokens.total === "number"
					? {
							input: Number(tokens.input ?? 0),
							output: Number(tokens.output ?? 0),
							total: Number(tokens.total ?? 0),
						}
					: undefined,
			cost: typeof item.cost === "number" ? item.cost : undefined,
			summary: typeof item.summary === "string" ? item.summary.slice(0, 600) : undefined,
		};
	});
}

export interface DesktopBridgeHooks {
	onPlanState: (state: PlanState) => void;
	onFleetState: (agents: FleetAgent[]) => void;
	onCommands: (commands: SlashCommand[]) => void;
}

export interface DesktopBridgeHandle {
  /** re-run announce: re-report commands and ping the plugins for their state —
   *  used when a parked runtime is promoted back to the active view */
  reannounce: () => void;
}

export function registerDesktopBridge(pi: ExtensionAPI, hooks: DesktopBridgeHooks): DesktopBridgeHandle {
	let unsubscribers: Array<() => void> = [];

	const subscribe = () => {
		if (unsubscribers.length) return;
		try {
			unsubscribers.push(pi.events.on(BUS_STATE, (data) => hooks.onPlanState(coercePlan(data))));
			unsubscribers.push(pi.events.on(BUS_FLEET, (data) => hooks.onFleetState(coerceFleet(data))));
		} catch {
			/* a runtime without a bus: the session entries still carry the state */
		}
	};

	const reportCommands = () => {
		try {
			const commands = pi.getCommands?.() ?? [];
			hooks.onCommands(
				commands.map((command) => ({
					name: command.name,
					description: command.description,
					source: command.source === "extension" ? "extension" : command.source,
				})),
			);
		} catch {
			/* the runner is not ready yet; the next event tries again */
		}
	};

	const announce = () => {
		subscribe();
		reportCommands();
		try {
			/* "tell me again" — the plugins published before this window existed */
			pi.events.emit(BUS_PING, null);
			pi.events.emit(BUS_FLEET_PING, null);
		} catch {
			/* ignore */
		}
	};

	pi.on("session_start", async () => announce());
	pi.on("session_tree", async () => announce());
	/* `resources_discover` and `agent_settled` come after every extension has
	 * bound, so a ping here always finds a listener — it is the safety net for
	 * the case where the plugin published before this side was listening */
	pi.on("resources_discover", async () => announce());
	pi.on("agent_settled", async () => announce());
  pi.on("session_shutdown", async () => {
    unsubscribers.splice(0).forEach((off) => off());
    hooks.onPlanState({ ...EMPTY_PLAN });
    hooks.onFleetState([]);
    hooks.onCommands([]);
  });
  return { reannounce: announce };
}
