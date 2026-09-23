/**
 * The four team tools, parameter-checked against Codex V2
 * (analysis doc §2.6): task_name restricted to lowercase/digits/underscores,
 * wait timeouts clamped to 10s–3600s with a 30s default, spawn is
 * fire-and-forget and returns the task_name, interrupt reports the previous
 * status. The `message` field carries the task (Codex V2 names it message
 * too); there is no fork_turns in v1 — the message must be self-contained.
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SubagentRegistry } from "./runtime.ts";
import type { FleetAgent } from "./state.ts";
import { INTERRUPT_DESCRIPTION, LIST_DESCRIPTION, WAIT_DESCRIPTION, spawnDescription, teamGuidelines } from "./prompts.ts";

const TASK_NAME = /^[a-z][a-z0-9_]*$/;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 3_600_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function clampTimeout(raw: unknown): number {
	const value = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

/** One agent, as the model sees it in list output. */
function agentRow(agent: FleetAgent): string {
	const usage = agent.tokens ? ` (${Math.round(agent.tokens.total / 1000)}k tok)` : "";
	const model = agent.model ? ` on ${agent.model}` : "";
	return `- ${agent.name}: ${agent.status}${model}${usage}`;
}

/** What the root reads when a result is delivered — by wait or by wake. The
 *  full answer, not the 800-character preview the panel shows. */
function deliveredText(agent: FleetAgent): string {
	return `${agent.name} ${agent.status}:\n${agent.result ?? agent.summary ?? "(no answer)"}`;
}

export interface ToolDeps {
	registry: SubagentRegistry;
	maxConcurrent: number;
}

export function registerTeamTools(pi: ExtensionAPI, deps: ToolDeps): void {
	const { registry } = deps;
	const [spawnGuideline, waitGuideline] = teamGuidelines(deps.maxConcurrent);

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn sub-agent",
		description: spawnDescription(deps.maxConcurrent),
		promptSnippet: "spawn_agent — run a task in a background sub-agent",
		promptGuidelines: [spawnGuideline],
		parameters: Type.Object({
			message: Type.String({ description: "Self-contained task for the sub-agent: goal, paths, what to report back" }),
			task_name: Type.String({
				description: "Short lowercase name (letters, digits, underscores) used by wait/list/interrupt",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const input = params as { message?: string; task_name?: string };
			const message = String(input.message ?? "").trim();
			const taskName = String(input.task_name ?? "").trim();
			if (!message) {
				return {
					content: [{ type: "text", text: "spawn_agent needs a message: the self-contained task." }],
					details: {},
					isError: true,
				};
			}
			if (!TASK_NAME.test(taskName) || taskName.length > 64) {
				return {
					content: [{ type: "text", text: `task_name must match ${TASK_NAME.source} and be at most 64 characters.` }],
					details: {},
					isError: true,
				};
			}
			let agent: FleetAgent;
			try {
				agent = await registry.spawn({
					taskName,
					message,
					cwd: ctx.cwd,
					agentDir: getAgentDir(),
					model: ctx.model,
					thinkingLevel: ctx.thinkingLevel,
					maxConcurrent: deps.maxConcurrent,
				});
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: {},
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `spawned ${agent.name}${agent.model ? ` on ${agent.model}` : ""}. It runs in the background; ${deps.maxConcurrent - registry.activeCount()} slot(s) left. Use wait_agent when you need its result.`,
					},
				],
				details: { task_name: agent.name, model: agent.model },
			};
		},
	});

	pi.registerTool({
		name: "wait_agent",
		label: "Wait for sub-agent",
		description: WAIT_DESCRIPTION,
		promptSnippet: "wait_agent — block until the next sub-agent finishes",
		promptGuidelines: [waitGuideline],
		parameters: Type.Object({
			timeout_ms: Type.Optional(
				Type.Number({ description: `Wait at most this long; ${MIN_TIMEOUT_MS / 1000}s–${MAX_TIMEOUT_MS / 60000}min, default 30s` }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const timeoutMs = clampTimeout((params as { timeout_ms?: number }).timeout_ms);
			const cancelled = () => ({
				content: [{ type: "text" as const, text: "wait_agent was cancelled." }],
				details: { timed_out: false, cancelled: true } as Record<string, unknown>,
			});
			/* a cancelled call must not consume a result it will never report */
			if (signal?.aborted) return cancelled();
			/* settles that nobody waited for yet are returned first — waiting
			 * for a *new* one while results are already sitting there would be
			 * busy-waiting by another name. takeUndelivered() claims it, so two
			 * wait_agent calls cannot both report the same settle. */
			const pending = registry.takeUndelivered();
			if (pending) {
				return {
					content: [{ type: "text", text: deliveredText(pending) }],
					details: { agent: pending.name, status: pending.status, timed_out: false } as Record<string, unknown>,
				};
			}
			const outcome = await registry.waitNext(timeoutMs, signal);
			if (outcome === "timeout") {
				const running = registry
					.list()
					.agents.filter((agent) => agent.status === "running")
					.map((agent) => agent.name);
				return {
					content: [
						{
							type: "text",
							text: `timed out after ${timeoutMs / 1000}s${running.length ? `; still running: ${running.join(", ")}` : "; no agents are running"}`,
						},
					],
					details: { timed_out: true, running } as Record<string, unknown>,
				};
			}
			if (outcome === "aborted") return cancelled();
			return {
				content: [{ type: "text", text: deliveredText(outcome) }],
				details: { agent: outcome.name, status: outcome.status, timed_out: false } as Record<string, unknown>,
			};
		},
	});

	pi.registerTool({
		name: "list_agents",
		label: "List sub-agents",
		description: LIST_DESCRIPTION,
		promptSnippet: "list_agents — show every sub-agent and its status",
		parameters: Type.Object({}),
		async execute() {
			const state = registry.list();
			return {
				content: [{ type: "text", text: state.agents.length ? state.agents.map(agentRow).join("\n") : "(no sub-agents)" }],
				details: { count: state.agents.length },
			};
		},
	});

	pi.registerTool({
		name: "interrupt_agent",
		label: "Interrupt sub-agent",
		description: INTERRUPT_DESCRIPTION,
		promptSnippet: "interrupt_agent — abort a running sub-agent",
		parameters: Type.Object({
			target: Type.String({ description: "The task_name of the agent to interrupt, or 'all'" }),
		}),
		async execute(_toolCallId, params) {
			const target = String((params as { target?: string }).target ?? "").trim();
			if (!target) {
				return { content: [{ type: "text", text: "interrupt_agent needs a target." }], details: {}, isError: true };
			}
			if (target === "all") {
				const count = await registry.interruptAll();
				return {
					content: [{ type: "text", text: `interrupted ${count} agent(s).` }],
					details: { interrupted: count } as Record<string, unknown>,
				};
			}
			const previous = await registry.interrupt(target);
			if (previous === "not_found") {
				return { content: [{ type: "text", text: `No sub-agent named "${target}".` }], details: {}, isError: true };
			}
			if (previous !== "running") {
				return {
					content: [{ type: "text", text: `${target} was already ${previous}.` }],
					details: { previous_status: previous } as Record<string, unknown>,
				};
			}
			return {
				content: [{ type: "text", text: `interrupted ${target} (was running).` }],
				details: { previous_status: "running" } as Record<string, unknown>,
			};
		},
	});
}
