/**
 * Plan mode, as a pi extension.
 *
 * Four phases, one file each side of the line:
 *
 *   off ──/plan──▶ planning ──create_plan──▶ review ──/plan build──▶ executing ──▶ off
 *                    ▲                          │
 *                    └──────── /plan refine ────┘
 *
 * Planning and building are two tasks, not one. The planning task ends when the
 * plan is on screen — that is what the user asked for, and it is what they
 * answer. Approving it starts the build as a *second* task, and the window shows
 * them as two cards because the build opens with a `plan-mode-build` boundary
 * message (see `startExecution`, and `buildTurns` on the desktop side). Without
 * that boundary the entire build lands inside the planning turn: one card, every
 * tool call the research and the work produced, and no seam between them.
 *
 * `planning` and `review` are read-only, and the read-only lock lives in the
 * `tool_call` hook (`gating.ts`): a write call is refused while the mode says so.
 * The tool catalog itself never changes — see `gating.ts` for why that matters
 * (the catalog is part of the cached request prefix). The plan itself is a file
 * under `.pi/plans/`, written by the `create_plan` tool — the only write plan
 * mode is for. Approving it hands the agent the remaining steps; progress rides
 * on `todo_write`, which the desktop already renders.
 *
 * Read-only is runtime state, not log state. The session log remembers the plan;
 * the gate is re-derived from that log whenever a session starts or a branch
 * becomes current, because a resumed session's restored phase is history and the
 * lock has to close on *this* run. A plan that reaches review without the mode
 * being entered first still closes it: whatever route the plan took, the user
 * approves it before the work starts, and the model is told so in the tool
 * result.
 *
 * Nothing here renders. State is published for whoever is watching — the
 * terminal footer via `setStatus`/`setWidget`, the desktop window over pi's
 * event bus — which is what keeps this file usable from the CLI and from an
 * Electron app with the same code.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	EMPTY_PLAN,
	normalizeState,
	statusLine,
	stepsFrom,
	widgetLines,
	type PlanState,
	type PlanStep,
} from "./state.ts";
import { blockReason, isWriteTool } from "./gating.ts";
import { writePlanFile } from "./plan-file.ts";
import {
	executionReminder,
	planningReminder,
	refineReminder,
	reminderPhase,
	reviewReminder,
} from "./prompt.ts";

const STATE_ENTRY = "plan-mode";
const BUS_STATE = "plan-mode:state";
const BUS_PING = "plan-mode:ping";

/** Plan-mode reminders, keyed by the phase each one belongs to. */
const REMINDERS: Record<string, PlanState["phase"]> = {
	"plan-mode-context": "planning",
	"plan-review-context": "review",
	"plan-execution-context": "executing",
};

/** The most of a plan's notes the per-turn reminder carries before it truncates. */
const NOTES_LIMIT = 600;

/** The most of them the state keeps — the file on disk is the full record. */
const NOTES_STATE_LIMIT = 2000;

/** Steps the plan's own wording, matched against the task list as it runs. */
function todoStatus(raw: unknown): PlanStep["status"] | undefined {
	switch (String(raw ?? "").toLowerCase()) {
		case "completed":
		case "done":
			return "done";
		case "failed":
			return "failed";
		case "in_progress":
		case "running":
			return "running";
		case "pending":
			return "pending";
		default:
			return undefined;
	}
}

/**
 * A step label and a task-list label, as one key.
 *
 * Both are typed by a model, so the same step arrives as "Add the refresh
 * route" in one place and "Add the refresh route." in the other; matching on
 * words instead of punctuation is what keeps progress lined up.
 */
function matchKey(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
		.trim();
}

/** The text of a message whose content is a string or an array of parts. */
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const record = part as { type?: string; text?: string };
			return record?.type === "text" ? String(record.text ?? "") : "";
		})
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state: PlanState = { ...EMPTY_PLAN };
	/* whether *this* runtime is the one that raised the thinking level — the
	 * persisted `thinkingBefore` says what the level was, only this flag can say
	 * whether it is still ours to put back. */
	let thinkingRaised = false;
	let ctxRef: ExtensionContext | undefined;
	let unsubscribed: (() => void) | undefined;

	const remember = (ctx?: ExtensionContext): ExtensionContext | undefined => {
		if (ctx) ctxRef = ctx;
		return ctxRef;
	};

	const drawSurface = (ctx: ExtensionContext | undefined) => {
		if (!ctx) return;
		try {
			ctx.ui.setStatus("plan-mode", statusLine(state));
			ctx.ui.setWidget("plan-mode", widgetLines(state));
		} catch {
			/* a headless run has no chrome to draw on */
		}
	};

	const persist = () => {
		try {
			pi.appendEntry(STATE_ENTRY, state);
		} catch {
			/* persistence is a convenience; never let it break the turn */
		}
	};

	const publish = (ctx?: ExtensionContext) => {
		const live = remember(ctx);
		state.updatedAt = Date.now();
		drawSurface(live);
		try {
			pi.events.emit(BUS_STATE, state);
		} catch {
			/* a stale runtime throws here; the session entries still carry the state */
		}
	};

	const commit = (ctx?: ExtensionContext) => {
		publish(ctx);
		persist();
	};

	/**
	 * Enter the read-only phase.
	 *
	 * The tool catalog is left exactly as it is — that is the point of this
	 * function being this short (see `gating.ts`): a plan phase must not change
	 * the request prefix. The one runtime change is the thinking level, because
	 * plans are where the extra reasoning pays for itself. That costs one cache
	 * write: changing thinking parameters invalidates the cached conversation
	 * (Anthropic's cache invariants), and leaving the mode costs the same once.
	 * The alternative — worse plans — is the worse trade.
	 */
	const enterReadOnly = () => {
		if (thinkingRaised) return;
		thinkingRaised = true;
		/* the level to come back to is the live one, not a level from the log */
		const before = pi.getThinkingLevel();
		state.thinkingBefore = undefined;
		if (["off", "minimal", "low", "medium"].includes(before)) {
			try {
				pi.setThinkingLevel("xhigh");
				state.thinkingBefore = before;
			} catch {
				/* model without reasoning — keep what it has */
			}
		}
	};

	const leaveReadOnly = () => {
		const level = state.thinkingBefore;
		state.thinkingBefore = undefined;
		if (!thinkingRaised) return;
		thinkingRaised = false;
		/* walk the level back only while plan mode is still what set it: a level
		 * the user moved during planning is theirs, not ours to undo */
		if (level && pi.getThinkingLevel() === "xhigh") {
			try {
				pi.setThinkingLevel(level as never);
			} catch {
				/* ignore */
			}
		}
	};

	const enterPlanning = (ctx?: ExtensionContext, opts: { keepPlan?: boolean } = {}) => {
		state.phase = "planning";
		if (!opts.keepPlan) {
			state.path = undefined;
			state.title = undefined;
			state.body = undefined;
			state.steps = [];
		}
		enterReadOnly();
		commit(ctx);
	};

	const cancel = (ctx?: ExtensionContext, reason = "Plan mode off. Full access restored.") => {
		leaveReadOnly();
		state = { ...EMPTY_PLAN, updatedAt: Date.now() };
		commit(ctx);
		try {
			ctx?.ui.notify(reason, "info");
		} catch {
			/* ignore */
		}
	};

	const remaining = () => state.steps.filter((step) => step.status !== "done");

	/** The per-turn build reminder, with each remaining step's own detail. */
	const executionMessage = () => {
		const left = remaining();
		const list = left
			.map((step, index) => `${index + 1}. ${step.label}${step.detail ? `\n   - ${step.detail}` : ""}`)
			.join("\n");
		const notes =
			state.body && state.body.length > NOTES_LIMIT ? `${state.body.slice(0, NOTES_LIMIT)}…` : state.body;
		return executionReminder({
			remaining: list,
			doneCount: state.steps.length - left.length,
			total: state.steps.length,
			path: state.path,
			notes,
		});
	};

	const startExecution = (ctx?: ExtensionContext) => {
		leaveReadOnly();
		state.phase = "executing";
		for (const step of state.steps) {
			/* nothing is in flight before the build starts, and a step that failed
			 * last time is a step to try again */
			if (step.status === "failed" || step.status === "running") step.status = "pending";
		}
		commit(ctx);
		/* The build is a task of its own, and this is where it opens.
		 *
		 * It is sent first so the boundary lands ahead of the build's first beat,
		 * and it carries no `triggerTurn`: the hidden reminder below is what starts
		 * the run, so a boundary that cannot start one is still the right thing to
		 * send when a build is resumed rather than started. On the desktop this
		 * type is also the seam the transcript cuts the new task card on — the
		 * plugin and `buildTurns` match the same string on purpose. */
		pi.sendMessage(
			{
				customType: "plan-mode-build",
				content: `**Building the plan${state.title ? ` — ${state.title}` : ""}** (${state.steps.length} steps)`,
				display: true,
			},
			{ deliverAs: "followUp" },
		);
		/* The kickoff is the same hidden reminder the later turns get, and it
		 * starts the turn itself. A custom message rather than a user one: the
		 * build should not leave a user-shaped bubble in the transcript, and the
		 * reminder has to be identifiable once the plan is finished — including
		 * from the CLI dialog, where the agent is still streaming and a prompt
		 * would be refused outright. */
		pi.sendMessage(
			{ customType: "plan-execution-context", content: executionMessage(), display: false },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	};

	const finishExecution = (ctx?: ExtensionContext) => {
		state.phase = "off";
		const steps = state.steps;
		commit(ctx);
		pi.sendMessage(
			{
				customType: "plan-mode-complete",
				content: `**Plan complete** ✓ — ${steps.length} steps\n\n${steps.map((step) => `${step.status === "done" ? "☑" : "☐"} ${step.label}`).join("\n")}`,
				display: true,
			},
			{ triggerTurn: false },
		);
	};

	/* ── the tool that writes the plan ──────────────────────────────── */

	pi.registerTool({
		name: "create_plan",
		label: "Create plan",
		description:
			"Hand the user a reviewable implementation plan. Call it once the research is done and before any change. The steps become the build order, so make them concrete, verifiable, and specific about the files they touch.",
		promptSnippet: "create_plan — write the implementation plan for the user to approve",
		promptGuidelines: [
			"Use create_plan when a request needs research before changes, or when the user asked for a plan; do not describe the plan only in prose.",
			"create_plan steps are executed in order by another turn — keep each step independently verifiable and name the files it touches.",
		],
		parameters: Type.Object({
			title: Type.String({ description: "Short name for the plan, e.g. 'Auth refresh path'" }),
			steps: Type.Array(
				Type.Object({
					label: Type.String({ description: "Imperative one-liner, e.g. 'Add the refresh route'" }),
					detail: Type.Optional(Type.String({ description: "Files and specifics for this step" })),
				}),
				{ description: "Ordered implementation steps" },
			),
			body: Type.Optional(
				Type.String({ description: "Optional notes: risks, alternatives, what was ruled out" }),
			),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const input = params as { title?: string; steps?: unknown; body?: string };
			const title = String(input.title ?? "Plan").slice(0, 120);
			const steps = stepsFrom(input.steps as Array<{ label?: unknown; detail?: unknown }>);
			if (!steps.length) {
				return {
					content: [{ type: "text", text: "create_plan needs at least one step." }],
					details: {},
					isError: true,
				};
			}
			const body =
				typeof input.body === "string" && input.body.trim() ? input.body.trim().slice(0, 4000) : undefined;
			const model = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
			let path: string | undefined;
			let failure: string | undefined;
			try {
				path = await writePlanFile(ctx?.cwd ?? process.cwd(), title, steps, body, model);
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}
			/* the plan is what the user is about to approve, so it is state before
			 * it is a file: a plan whose file could not be written is still
			 * reviewable, still buildable, and still counted */
			const entered = state.phase === "off" || state.phase === "executing";
			state.phase = "review";
			state.title = title;
			state.path = path;
			state.body = body?.slice(0, NOTES_STATE_LIMIT);
			state.steps = steps;
			if (ctx?.model) state.parentModel = { provider: ctx.model.provider, id: ctx.model.id };
			/* the gate closes here even when the model wrote a plan without being
			 * asked to: review means an unapproved plan, and an unapproved plan
			 * must not be half-implemented */
			enterReadOnly();
			commit(ctx);
			if (entered) {
				try {
					ctx?.ui.notify("A plan is ready — read-only until you approve it.", "info");
				} catch {
					/* a headless run has nobody to tell */
				}
			}
			return {
				content: [
					{
						type: "text",
						text: path
							? `Plan written to ${path}. ${steps.length} steps, waiting for the user to start the build.`
							: `The plan could not be written to disk (${failure}), so it lives in plan mode's state alone. ${steps.length} steps, waiting for the user to start the build.`,
					},
				],
				details: { path, title, steps: steps.length, error: failure },
			};
		},
	});

	/* ── the command surface ────────────────────────────────────────── */

	pi.registerCommand("plan", {
		description: "Plan mode: research read-only, then build the approved plan",
		handler: async (args, ctx) => {
			const text = String(args ?? "").trim();
			const [word, ...rest] = text.split(/\s+/);
			const note = rest.join(" ").trim();

			switch ((word ?? "").toLowerCase()) {
				case "":
					if (state.phase === "off") {
						enterPlanning(ctx);
						ctx.ui.notify("Plan mode on — read-only until the plan is approved.", "info");
					} else {
						cancel(ctx);
					}
					return;

				case "status": {
					const lines = state.steps.map(
						(step, index) => `${index + 1}. ${step.status === "done" ? "✓" : step.status === "running" ? "◐" : "○"} ${step.label}`,
					);
					ctx.ui.notify(
						`Plan mode: ${state.phase}${state.path ? `\n${state.path}` : ""}${lines.length ? `\n\n${lines.join("\n")}` : ""}`,
						"info",
					);
					return;
				}

				case "build":
				case "approve":
				case "execute": {
					if (state.phase === "off" || !state.steps.length) {
						ctx.ui.notify("Nothing to build — plan mode has no written plan.", "warning");
						return;
					}
					if (ctx.isIdle?.() === false) {
						ctx.ui.notify("The agent is still working. Build once it settles.", "warning");
						return;
					}
					startExecution(ctx);
					return;
				}

				case "refine": {
					enterPlanning(ctx, { keepPlan: true });
					pi.sendUserMessage(refineReminder(note));
					return;
				}

				case "cancel":
				case "off":
					cancel(ctx);
					return;

				case "steps": {
					if (!state.steps.length) {
						ctx.ui.notify("No steps yet — the plan has not been written.", "info");
						return;
					}
					ctx.ui.notify(
						state.steps.map((step, index) => `${index + 1}. ${step.status} ${step.label}`).join("\n"),
						"info",
					);
					return;
				}

				case "done": {
					const index = Number.parseInt(note, 10);
					const step = state.steps[index - 1];
					if (!step) {
						ctx.ui.notify("Usage: /plan done <step number>", "warning");
						return;
					}
					step.status = "done";
					commit(ctx);
					return;
				}

				default:
					ctx.ui.notify("Plan mode: /plan · /plan status · /plan build · /plan refine <note> · /plan cancel", "info");
			}
		},
	});

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	pi.registerShortcut("ctrl+alt+p", {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			if (state.phase === "off") enterPlanning(ctx);
			else cancel(ctx);
		},
	});

	/* ── gating and instructions ────────────────────────────────────── */

	pi.on("tool_call", async (event) => {
		if (state.phase !== "planning" && state.phase !== "review") return;
		if (!isWriteTool(event.toolName)) return;
		return { block: true, reason: blockReason(event.toolName, state.phase) };
	});

	pi.on("before_agent_start", async () => {
		if (state.phase === "planning") {
			return { message: { customType: "plan-mode-context", content: planningReminder(), display: false } };
		}
		if (state.phase === "review") {
			return { message: { customType: "plan-review-context", content: reviewReminder(), display: false } };
		}
		if (state.phase === "executing" && state.steps.length) {
			return {
				message: {
					customType: "plan-execution-context",
					content: executionMessage(),
					display: false,
				},
			};
		}
	});

	/* A reminder belongs to the phase that produced it. Once plan mode has moved
	 * on, its instructions leave the context instead of being quoted back at the
	 * model for the rest of the session — and they never survive a plan that has
	 * finished. Reminders this extension sent are identified by their custom
	 * type; the ones written as user messages (a refine note's instruction, and
	 * the build kickoff in logs written before it became a custom message) are
	 * identified by the marker they open with. */
	pi.on("context", async (event) => {
		const kept = event.messages.filter((message) => {
			const record = message as { customType?: string; role?: string; content?: unknown };
			const owner = record.customType ? REMINDERS[record.customType] : undefined;
			if (owner) return owner === state.phase;
			if (record.role !== "user") return true;
			const phase = reminderPhase(messageText(record.content));
			return phase === undefined || phase === state.phase;
		});
		if (kept.length === event.messages.length) return;
		return { messages: kept };
	});

	/* ── progress ───────────────────────────────────────────────────── */

	/* the build reports progress through todo_write; mirror it so the plan's own
	 * step list stays truthful, in the dock and in the footer alike */
	pi.on("tool_result", async (event, ctx) => {
		if (state.phase !== "executing") return;
		if (event.toolName !== "todo_write") return;
		const items = (event.input as { items?: unknown } | undefined)?.items;
		if (!Array.isArray(items)) return;
		const byLabel = new Map(state.steps.map((step) => [matchKey(step.label), step]));
		let changed = false;
		for (const item of items) {
			const record = item as { label?: unknown; status?: unknown };
			const key = matchKey(String(record.label ?? ""));
			const next = todoStatus(record.status);
			const step = key ? byLabel.get(key) : undefined;
			if (!step || !next || step.status === next) continue;
			step.status = next;
			changed = true;
		}
		if (changed) commit(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (state.phase === "executing" && state.steps.length) {
			if (remaining().length === 0) {
				finishExecution(ctx);
				return;
			}
			/* A run that ends with a failed step and nothing running is a stalled
			 * build: the plan stays open, so say so rather than letting the panel
			 * sit on a step the agent has already given up on. */
			const failed = state.steps.filter((step) => step.status === "failed");
			if (failed.length && !state.steps.some((step) => step.status === "running")) {
				try {
					if (ctx.hasUI) {
						ctx.ui.notify(
							`Plan stalled: ${failed.map((step) => step.label).join(", ")} failed. Tell the agent how to continue, or /plan done <n> to accept the step.`,
							"warning",
						);
					}
				} catch {
					/* ignore */
				}
			}
			return;
		}
		if (state.phase !== "review") return;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		/* terminals get the dialog pi ships with; a window renders its own card,
		 * so blocking here would only stall the session for the GUI */
		const choice = await ctx.ui.select("Plan ready — what next?", [
			"Build it (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);
		if (choice?.startsWith("Build")) {
			startExecution(ctx);
		} else if (choice === "Refine the plan") {
			const note = await ctx.ui.input("What should change?", "");
			enterPlanning(ctx, { keepPlan: true });
			pi.sendUserMessage(refineReminder(note));
		}
	});

	/* ── resume ─────────────────────────────────────────────────────── */

	/**
	 * The plan this branch of the log is carrying.
	 *
	 * `getEntries()` mixes every branch of the session file together, so the only
	 * honest answer to "which plan is current" walks up from the leaf. A branch
	 * with no plan entry of its own has no plan — not the plan of the branch the
	 * user just left.
	 */
	const planFromLog = (ctx: ExtensionContext): PlanState | null => {
		let restored: PlanState | null = null;
		try {
			for (const entry of ctx.sessionManager.getBranch()) {
				const record = entry as { type?: string; customType?: string; data?: unknown };
				if (record.type !== "custom" || record.customType !== STATE_ENTRY) continue;
				restored = normalizeState(record.data) ?? restored;
			}
		} catch {
			/* an unreadable log leaves plan mode off rather than guessing */
		}
		return restored;
	};

	/**
	 * Put the live runtime in the shape `next` calls for, then adopt it.
	 *
	 * The order matters both ways: entering read-only records the tool list of
	 * *this* runtime (the log's copy is from another one), and leaving it has to
	 * put those tools back from the state that is about to be replaced.
	 */
	const adopt = (next: PlanState) => {
		if (next.phase === "planning" || next.phase === "review") {
			state = next;
			enterReadOnly();
			return;
		}
		leaveReadOnly();
		state = next;
	};

	pi.on("session_start", async (_event, ctx) => {
		remember(ctx);
		const restored = planFromLog(ctx);
		/* the flag opens a session in plan mode; a plan already in the log wins,
		 * because resuming must not quietly re-open a plan that is finished */
		const startPlanned = pi.getFlag("plan") === true && (!restored || restored.phase === "off");
		adopt(
			startPlanned
				? { ...EMPTY_PLAN, phase: "planning", updatedAt: Date.now() }
				: (restored ?? { ...EMPTY_PLAN }),
		);

		/* the window subscribes when it is ready, which is after the extension's
		 * own publish — so it pings the bus and asks for the state again. The
		 * subscription dies with the runtime, so this is one per session. */
		try {
			unsubscribed?.();
			unsubscribed = pi.events.on(BUS_PING, () => publish());
		} catch {
			/* no bus — nothing to answer */
		}

		publish(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		/* a branch switch changes which plan is current — the gate included */
		adopt(planFromLog(ctx) ?? { ...EMPTY_PLAN, updatedAt: Date.now() });
		publish(ctx);
	});

	pi.on("session_shutdown", async () => {
		try {
			unsubscribed?.();
		} catch {
			/* ignore */
		}
		unsubscribed = undefined;
		thinkingRaised = false;
	});
}
