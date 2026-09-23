/**
 * Write gating.
 *
 * Plan mode is read-only, and the `tool_call` hook below is the *only* lock that
 * enforces it. The mode used to take the write tools out of the active set as
 * well, and that is deliberately gone: the tool catalog is part of the request
 * prefix, so adding or removing a tool mid-session invalidates the cached
 * conversation for every provider that caches — Anthropic says so outright
 * ("Never add or remove tools mid-session", *Prompt caching is everything*), and
 * every comparable agent (Claude Code, ZCode, DSH, Grok Build) keeps the catalog
 * fixed and expresses plan mode through tools, reminders or hooks instead of a
 * tool-set swap. A refusal costs one round trip; a cache miss costs the whole
 * session. That trade is the reason this file is now only about refusals.
 *
 * Shell commands are deliberately not classified. Guessing whether a bash line
 * mutates the tree is a losing game, and a wrong verdict either blocks real
 * research or waves a write through; the honest guard is the instruction plus
 * the fact that the plan file is the only file the mode is *for*. A user who
 * needs shell locked down can turn it off in pi's own tool settings. The same
 * reasoning keeps `spawn_agent` out of this list: a research sub-agent is a
 * legitimate planning move, and its own session inherits the default tool set.
 */

/** Tools that change files. Everything else stays available while planning. */
const WRITE_TOOLS = new Set([
	"edit",
	"write",
	"multi_edit",
	"multiedit",
	"replace",
	"insert",
	"str_replace",
	"apply_patch",
	"patch",
	"notebook_edit",
	"undo_last_change",
]);

export function isWriteTool(name: string): boolean {
	return WRITE_TOOLS.has(name.toLowerCase());
}

/** What the model is told when its write is refused — one sentence per phase. */
export function blockReason(name: string, phase: "planning" | "review"): string {
	if (phase === "review") {
		return `Plan mode: the plan is written and waiting for the user to approve it, so ${name} is refused. Do not retry it — the build starts from their decision, not from this turn.`;
	}
	return `Plan mode: ${name} is refused while the plan is being written. Put the change in the plan with create_plan instead — the user approves it, then writes are allowed again.`;
}
