import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Ultra's one real behaviour, as a pi extension: flip the delegation policy.
 *
 * Codex defines Ultra in the model catalog — a distinct reasoning effort that
 * also swaps a `<multi_agent_mode>` developer message from "do not delegate
 * unless asked" to "delegate whenever it would help" (codex-rs/prompts/src/
 * model_messages/multi_agent.rs, analysis doc §2.3). pi has no ultra level,
 * so the desktop aliases Ultra to Max on the wire and buys the difference
 * with the mechanism both share: the system prompt.
 *
 * The grant text below is Codex's proactive message, adapted only where our
 * runtime differs (no nesting, revocation by prompt rebuild instead of a
 * world-state diff). The default rule the grant suspends is the explicit
 * clause carried in the spawn_agent tool description — the same place Codex
 * keeps it, so no second gate is invented here.
 *
 * Revocation: Codex diffs the mode section and, when Ultra turns off, sends
 * an explicit "no longer applies" message. pi rebuilds the system prompt for
 * every prompt from the base + whatever `before_agent_start` returns, so the
 * grant is withdrawn the moment the handler stops appending it — absence is
 * the revocation, and the conversation never carries a stale grant forward.
 */

export interface UltraPolicyOptions {
  /** whether the session is running at Ultra (Max on the wire + picked), not merely at Max */
  isUltra: () => boolean;
  /** how many sub-agent slots the agent-team plugin is configured for */
  maxAgents: () => number;
}

const proactiveGrant = (slots: number): string =>
  [
    "<multi_agent_mode>",
    "Proactive multi-agent delegation is active. Any earlier instruction",
    "requiring an explicit user request before spawning sub-agents no longer",
    "applies — including the default rule in the spawn_agent description.",
    "User requests override this hint.",
    "",
    "If at any point you can parallelize work by delegating a task to another",
    "agent, you should do so using spawn_agent when it could save time or",
    "improve quality — for example: hand an exploration to a sub-agent and",
    "inspect the environment yourself while it runs, or delegate a review",
    "while a long command finishes.",
    "",
    `There are ${slots} sub-agent slots. All agents share the same directory;`,
    "edits made by one agent are immediately visible to the others.",
    "spawn_agent returns immediately — keep working instead of waiting, then",
    "collect results with wait_agent using long timeouts (minutes), and",
    "interrupt_agent on a wrong direction. Prefer a few large delegations over",
    "many small ones.",
    "",
    "This grant is present only while Ultra depth is active. When it is",
    "absent from the system prompt, the default rule applies again: do not",
    "spawn sub-agents unless the user or applicable AGENTS.md/skill",
    "instructions explicitly ask for them.",
    "</multi_agent_mode>",
  ].join("\n");

export function registerUltraPolicy(pi: ExtensionAPI, options: UltraPolicyOptions): void {
  pi.on("before_agent_start", async (event) => {
    if (!options.isUltra()) return undefined;
    /* promise the model nothing it cannot do: the strong grant is only
     * injected when the delegation tools are actually on the table */
    const teamReady = pi.getActiveTools().includes("spawn_agent");
    if (!teamReady) return undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${proactiveGrant(options.maxAgents())}` };
  });
}
