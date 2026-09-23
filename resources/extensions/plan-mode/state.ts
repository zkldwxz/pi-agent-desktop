/**
 * The plan, as data.
 *
 * One state object describes the whole machine, and it is what the extension
 * persists into the session (`pi.appendEntry`) and publishes to the desktop
 * (`pi.events`). Nothing here is rendered: this file is the contract between
 * the extension and whatever is watching it — a terminal footer, the desktop
 * window, or a test.
 */

export type PlanPhase = "off" | "planning" | "review" | "executing";

export interface PlanStep {
	id: string;
	label: string;
	status: "pending" | "running" | "done" | "failed";
	detail?: string;
}

export interface PlanState {
	phase: PlanPhase;
	/** the plan file on disk, once one exists */
	path?: string;
	title?: string;
	steps: PlanStep[];
	/** the plan's own notes: risks, alternatives, what was ruled out */
	body?: string;
	/** the model that wrote the plan — what a Build falls back to */
	parentModel?: { provider: string; id: string };
	/** the thinking level the mode raised, so it knows what to put back */
	thinkingBefore?: string;
	updatedAt: number;
}

export const EMPTY_PLAN: PlanState = { phase: "off", steps: [], updatedAt: 0 };

export function stepsFrom(raw: Array<{ label?: unknown; detail?: unknown }> | undefined): PlanStep[] {
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, 40).map((item, index) => {
		const label = String(item?.label ?? "").trim();
		const detail = String(item?.detail ?? "").trim();
		return {
			id: `step-${index + 1}`,
			label: label.slice(0, 160) || `Step ${index + 1}`,
			detail: detail ? detail.slice(0, 400) : undefined,
			status: "pending" as const,
		};
	});
}

/** Read back whatever an older session wrote, tolerating older shapes. */
export function normalizeState(raw: unknown): PlanState | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const phase = record.phase;
	if (phase !== "off" && phase !== "planning" && phase !== "review" && phase !== "executing") return null;
	const steps = Array.isArray(record.steps)
		? record.steps.map((step, index) => {
				const item = step as Record<string, unknown>;
				const status = item.status;
				return {
					id: typeof item.id === "string" ? item.id : `step-${index + 1}`,
					label: String(item.label ?? `Step ${index + 1}`).slice(0, 160),
					detail: item.detail ? String(item.detail).slice(0, 400) : undefined,
					status:
						status === "running" || status === "done" || status === "failed"
							? (status as PlanStep["status"])
							: ("pending" as const),
				} satisfies PlanStep;
			})
		: [];
	const parent = record.parentModel as { provider?: unknown; id?: unknown } | undefined;
	return {
		phase,
		path: typeof record.path === "string" ? record.path : undefined,
		title: typeof record.title === "string" ? record.title : undefined,
		steps,
		body: typeof record.body === "string" && record.body.trim() ? record.body.slice(0, 4000) : undefined,
		parentModel:
			parent && typeof parent.provider === "string" && typeof parent.id === "string"
				? { provider: parent.provider, id: parent.id }
				: undefined,
		thinkingBefore: typeof record.thinkingBefore === "string" ? record.thinkingBefore : undefined,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
	};
}

/** `Plan: 3/7` — the footer line the extension keeps in sync. */
export function statusLine(state: PlanState): string | undefined {
	if (state.phase === "off") return undefined;
	if (state.phase === "planning") return "⏸ plan";
	if (state.phase === "review") return `📋 plan ready (${state.steps.length})`;
	const done = state.steps.filter((step) => step.status === "done").length;
	return `📋 ${done}/${state.steps.length}`;
}

/** The step list, as the widget lines a terminal would draw. */
export function widgetLines(state: PlanState): string[] | undefined {
	if (!state.steps.length || state.phase === "off") return undefined;
	return state.steps.map((step) => {
		const box = step.status === "done" ? "☑" : step.status === "running" ? "◐" : step.status === "failed" ? "✗" : "☐";
		return `${box} ${step.label}`;
	});
}
