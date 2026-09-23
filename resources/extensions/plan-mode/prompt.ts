/**
 * What the model is told, and when.
 *
 * The reminders are injected as hidden messages (`display: false`) rather than
 * concatenated onto the user's prompt: the transcript keeps the sentence the
 * user actually typed, the instructions ride along for the model, and the
 * system prompt itself stays byte-stable so the cached prefix survives.
 *
 * Every reminder opens with a marker, and the marker names the phase it belongs
 * to. The `context` hook reads them back to drop a finished phase's
 * instructions — a reminder outlives neither its phase nor the plan.
 */

import type { PlanPhase } from "./state.ts";

export function planningReminder(): string {
	return `[PLAN MODE — read only]
You are in plan mode. Research first, then write the plan; do not change the working tree.

- Read, search and inspect freely. Write calls are refused while the mode is on, so an edit will simply fail.
- Use create_plan when the research is done. Its steps are the implementation order: concrete, verifiable, naming the files each one touches. Keep them few enough to finish.
- If the request is ambiguous, ask before planning — a wrong plan is more expensive than a question.
- Do not ask for approval in prose. create_plan is the request for approval; the user answers it by starting the build.
- After create_plan, say nothing else of substance: the plan is on screen, and the user decides.`;
}

export function reviewReminder(): string {
	return `[PLAN READY — waiting for the build]
The plan is written and on the user's screen; they have not approved it yet.

- Write calls stay refused until the build starts, so do not attempt the work.
- Answer questions about the plan. If they want it changed, rewrite it with create_plan.
- Do not call create_plan again unprompted: the plan on screen is the one being reviewed.`;
}

export function executionReminder(input: {
	/** the remaining steps, already numbered, each carrying its own detail */
	remaining: string;
	doneCount: number;
	total: number;
	/** the plan file, so a one-line step is never the last word */
	path?: string;
	/** the plan's own notes, trimmed by the caller */
	notes?: string;
}): string {
	const lines = [
		`[PLAN APPROVED — build it]`,
		`Execute the approved plan. ${input.doneCount} of ${input.total} steps are already done.`,
	];
	if (input.path) {
		lines.push(`The plan file is ${input.path} — read it when a step needs more than its one-liner.`);
	}
	lines.push("", "Remaining steps, in order:", input.remaining);
	if (input.notes) {
		lines.push("", "Notes from the plan:", input.notes);
	}
	lines.push(
		"",
		"Keep the task list honest with todo_write: mark the step you are on as in_progress, mark it completed only once it is verified, and use the plan's step wording as the item label so progress lines up.",
	);
	return lines.join("\n");
}

export function refineReminder(note: string | undefined): string {
	const ask = note?.trim();
	return `[PLAN MODE — revising]
Stay read-only. The user reviewed the plan and wants changes.
${ask ? `\nTheir note:\n${ask}\n` : "\nThey asked to refine it without leaving a note — ask what should change, then rewrite the plan with create_plan.\n"}
Rewrite the plan with create_plan once the shape is clear.`;
}

/**
 * The phase a reminder's marker belongs to, or `undefined` when the text is
 * not a plan-mode reminder at all.
 *
 * Only user-shaped messages need this — `sendMessage` reminders are identified
 * by `customType`. It covers the legacy shape too: builds started before the
 * reminder moved off `sendUserMessage` left `[PLAN APPROVED` user messages in
 * old session logs, and those have to be cleaned up like any other.
 */
export function reminderPhase(text: string): PlanPhase | undefined {
	if (text.includes("[PLAN MODE")) return "planning";
	if (text.includes("[PLAN READY")) return "review";
	if (text.includes("[PLAN APPROVED")) return "executing";
	return undefined;
}
