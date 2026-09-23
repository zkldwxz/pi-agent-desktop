/**
 * What the model is told, and when.
 *
 * Every text here is adapted from Codex's multi-agent prompts
 * (codex-rs/prompts/src/model_messages/multi_agent.rs and
 * codex-rs/prompts/src/multi_agent_instructions.rs, as quoted in the analysis
 * doc §2.3–§2.4), trimmed to what this implementation actually provides:
 * no nested spawning, no context forking. The explicit-request clause lives in
 * the spawn_agent tool description — that is Codex's own mechanism for the
 * non-Ultra mode, so no extra hard gate is invented here.
 */

/** Appended to a sub-agent's system prompt. Mirrors Codex's subagent role. */
export function subagentRole(): string {
	return `[AGENT TEAM — sub-agent]
You are an agent in a team coordinated by a root agent. You were spawned to handle one task.

- All agents share the same directory. Edits made by one agent are immediately visible to all other agents.
- Your task message is all the context you have: it arrived without the root agent's conversation, so rely on it and on the repository, not on what the root agent might know.
- You do not have the team tools; you cannot spawn further agents. Do the work yourself.
- Your final assistant message is returned verbatim to the root agent as your result. Make it self-contained: findings, file paths, and what you changed or verified. No preamble, no sign-off.`;
}

/**
 * The spawn tool's description. The second paragraph is Codex's explicit-mode
 * clause verbatim; `slots` and the fire-and-forget note match how our runtime
 * behaves (spawn returns immediately, results arrive via wait_agent).
 */
export function spawnDescription(slots: number): string {
	return `Spawn a sub-agent that runs a task in the background with its own context window, in the same directory.

Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work — unless an active instruction explicitly grants proactive delegation.

The message must be self-contained: the sub-agent does not see this conversation. Include the goal, the relevant paths, and what to report back. The task_name is lowercase letters, digits and underscores.

There ${slots === 1 ? "is 1 concurrency slot" : `are ${slots} concurrency slots`} for sub-agents. The call returns immediately — the sub-agent starts and you get the task_name right away. Continue your own work in the meantime; call wait_agent when you need the result. Prefer a few large delegations over many small ones.`;
}

export const WAIT_DESCRIPTION = `Wait for the next sub-agent to finish (or be interrupted).

Blocks until one sub-agent settles, or until the timeout elapses. Returns which agent settled, its status, and its result; on timeout it returns the agents still running so you can decide what to do next. Results that settled earlier are returned immediately.

Prefer longer waits (minutes) over repeated short waits — busy re-polling wastes turns. While a wait is pending you cannot run other tools in the same batch, so do your own work first, then wait. After the user stops a turn, results are not delivered as wake messages: call wait_agent to collect them.`;

export const LIST_DESCRIPTION =
	"List the sub-agents of this session: name, status, model, token usage and result preview. Completed agents stay listed until pruned.";

export const INTERRUPT_DESCRIPTION =
	"Interrupt a running sub-agent. Its current turn is aborted, its status becomes interrupted, and whatever it produced so far is kept in its record. The slot frees as soon as the run unwinds, and an interrupted agent never wakes you — collect its record with wait_agent. Use it when a task went the wrong way.";

/** Guidance appended to the system prompt's Guidelines section while the
 *  team tools are active — via each tool's promptGuidelines, which pi appends
 *  flat, so every line names its tool. */
export function teamGuidelines(slots: number): string[] {
	return [
		`spawn_agent runs the task in the background in the same directory (${slots} slot${slots === 1 ? "" : "s"}): write a self-contained message, then keep working yourself instead of waiting.`,
		"Use wait_agent with long timeouts to collect results, list_agents to check status, and interrupt_agent to stop a wrong direction.",
	];
}
