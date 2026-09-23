/**
 * Agent team, as a pi extension.
 *
 * Gives the model Codex-V2-style delegation tools — spawn_agent, wait_agent,
 * list_agents, interrupt_agent — backed by real in-process sub-agent sessions
 * (see runtime.ts). Works anywhere pi loads extensions: the CLI draws the
 * fleet in its status line, the desktop mirrors it over the event bus
 * (`agent-team:fleet`) into a panel, and sends interrupts back the same way
 * (`agent-team:interrupt` / `agent-team:interrupt-all`).
 *
 * The tools are registered unconditionally, exactly like Codex V2: the
 * *policy* (delegate proactively vs. only on explicit request) is not a gate
 * here — the spawn_agent description carries the explicit-request clause, and
 * an active Ultra grant from the host's ultra extension is what overrides it.
 *
 * Delivery protocol: a settled sub-agent is reported to the model exactly
 * once — to a pending wait_agent, or (when the parent is idle and
 * wake-on-completion is on) as a wake message that starts a new turn. A stop
 * is not a result: after the user ends a turn, settled records wait quietly
 * for the next wait_agent call or the next idle drain instead of restarting
 * the turn that was just stopped, and nothing at all is delivered after
 * session_shutdown.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SubagentRegistry, type NamedExtensionFactory, type RegistryOptions } from "./runtime.ts";
import { registerTeamTools } from "./tools.ts";
import { statusLine, widgetLines, type FleetAgent, type FleetState } from "./state.ts";

const BUS_STATE = "agent-team:fleet";
const BUS_PING = "agent-team:ping";
const BUS_INTERRUPT = "agent-team:interrupt";
const BUS_INTERRUPT_ALL = "agent-team:interrupt-all";
/* Ask the host which inline extensions a sub-agent session must load. The
 * payload is filled in by whoever hosts the session (the desktop registers a
 * listener for it); an unfilled payload means sub-agents run with no
 * extensions at all, which is what a plain CLI wants. */
const BUS_CONFIGURE_TOOLS = "agent-team:configure-tools";

/** Where the desktop keeps fleet settings; the CLI shares the file. */
const DEFAULT_MAX_CONCURRENT = 3;

interface TeamConfig {
	maxConcurrent: number;
	wakeOnCompletion: boolean;
}

function readConfig(): TeamConfig {
	const defaults: TeamConfig = { maxConcurrent: DEFAULT_MAX_CONCURRENT, wakeOnCompletion: true };
	try {
		const raw = readFileSync(join(getAgentDir(), "desktop.json"), "utf8");
		const parsed = JSON.parse(raw) as { agents?: { maxConcurrent?: unknown; wakeOnCompletion?: unknown } };
		const block = parsed?.agents ?? {};
		return {
			maxConcurrent:
				typeof block.maxConcurrent === "number" && block.maxConcurrent >= 1 && block.maxConcurrent <= 32
					? Math.round(block.maxConcurrent)
					: defaults.maxConcurrent,
			wakeOnCompletion: typeof block.wakeOnCompletion === "boolean" ? block.wakeOnCompletion : defaults.wakeOnCompletion,
		};
	} catch {
		return defaults;
	}
}

/** The message the parent session's `agent_end` delivers for a stopped turn. */
interface TurnEndMessage {
	role?: string;
	stopReason?: string;
}

/** The `agent-team:configure-tools` payload: an empty list the host fills. */
interface ConfigureToolsRequest {
	factories: NamedExtensionFactory[];
}

/**
 * Which inline extensions a sub-agent session loads.
 *
 * The host answers synchronously on the shared bus — the desktop's listener
 * appends the two factories the parent session runs, and nothing else. The
 * bus is per session, so a listener is only ever the one hosting this session:
 * a CLI (or a test with no listener) leaves the list empty and sub-agents run
 * on the built-in tools alone. Asked per spawn rather than cached, so the
 * answer follows the host's current state.
 */
function requestExtensionFactories(pi: ExtensionAPI): NamedExtensionFactory[] {
	const request: ConfigureToolsRequest = { factories: [] };
	try {
		pi.events.emit(BUS_CONFIGURE_TOOLS, request);
	} catch {
		/* no bus: a sub-agent without extensions is still a working sub-agent */
	}
	return Array.isArray(request.factories) ? request.factories : [];
}

export default function agentTeam(pi: ExtensionAPI, options: RegistryOptions = {}): void {
	const config = readConfig();
	let ctxRef: ExtensionContext | undefined;
	/* the parent's turn state — a wake only makes sense when it is idle */
	let mainStreaming = false;
	/* the turn that just ended was stopped by the user (or by the host's own
	 * abort), so its sub-agent results must not start a new one */
	let turnStopped = false;
	/* session_shutdown ran: the parent turn is gone, so nothing may be woken */
	let shuttingDown = false;
	let unsubscribed: (() => void) | undefined;

	const remember = (ctx?: ExtensionContext): ExtensionContext | undefined => {
		if (ctx) ctxRef = ctx;
		return ctxRef;
	};

	const drawSurface = (ctx: ExtensionContext | undefined, state: FleetState) => {
		if (!ctx) return;
		try {
			const line = statusLine(state);
			if (line) ctx.ui.setStatus("agent-team", line);
			else ctx.ui.setStatus("agent-team", "");
			ctx.ui.setWidget("agent-team", widgetLines(state));
		} catch {
			/* headless runs have no chrome */
		}
	};

	const publish = (ctx?: ExtensionContext) => {
		const state = registry.list();
		drawSurface(remember(ctx), state);
		try {
			pi.events.emit(BUS_STATE, state);
		} catch {
			/* a stale runtime throws; nothing to mirror then */
		}
	};

	/** Start a turn for one settled agent. False when the runtime is closed. */
	const sendWake = (agent: FleetAgent): boolean => {
		if (shuttingDown) return false;
		try {
			pi.sendMessage(
				{
					customType: "agent-team-result",
					content: `Sub-agent ${agent.name} ${agent.status}:\n${agent.result ?? agent.summary ?? "(no answer)"}`,
					display: true,
				},
				{ triggerTurn: true },
			);
			return true;
		} catch {
			/* a runtime that cannot take messages still has the wait path */
			return false;
		}
	};

	/** Hand every settled-but-undelivered result to the model, once each.
	 *  Interrupted agents are skipped: an interrupt is something the root
	 *  asked for (or the user stopped), not a result it should be woken by. */
	const drainUndelivered = () => {
		if (shuttingDown || !config.wakeOnCompletion) return;
		for (const agent of registry.undelivered()) {
			if (agent.status === "interrupted") continue;
			if (!sendWake(agent)) return;
			registry.markDelivered([agent.name]);
		}
	};

	const registry = new SubagentRegistry(
		{
			onStateChange: () => publish(),
			onSettled: (agent, info) => {
				if (info.hadWaiters || shuttingDown) return; /* the waiting tool call already reported it */
				/* an interrupted agent is not a result the root asked to see:
				 * waking here would restart a turn that was just stopped. It
				 * stays undelivered for the next wait_agent or idle drain. */
				if (agent.status === "interrupted") return;
				/* wake-on-completion off, mid-turn, a stopped turn, or a wake that
				 * could not be sent: the record stays undelivered for the next
				 * wait_agent (which returns it immediately) */
				if (config.wakeOnCompletion && !mainStreaming && !turnStopped && sendWake(agent)) {
					registry.markDelivered([agent.name]);
				}
			},
		},
		{
			...options,
			/* injected by a host that already knows its factories (tests), asked
			 * over the bus otherwise (the desktop) */
			getExtensionFactories: options.getExtensionFactories ?? (() => requestExtensionFactories(pi)),
		},
	);

	registerTeamTools(pi, { registry, maxConcurrent: config.maxConcurrent });

	pi.on("agent_start", async () => {
		mainStreaming = true;
		turnStopped = false;
	});
	pi.on("agent_end", async (event) => {
		/* the SDK ends an aborted turn with an assistant message carrying
		 * stopReason "aborted" — that is how a stop is recognized */
		turnStopped = event.messages.some((message) => message.role === "assistant" && message.stopReason === "aborted");
	});
	pi.on("agent_settled", async () => {
		mainStreaming = false;
		/* the turn ended without collecting some results — now that the agent
		 * is idle is the moment a wake can actually start a turn. Not after a
		 * stop, though: then the results wait for the next turn. */
		if (!turnStopped) drainUndelivered();
	});

	pi.on("session_start", async (_event, ctx) => {
		remember(ctx);
		mainStreaming = false;
		turnStopped = false;
		try {
			unsubscribed?.();
		} catch {
			/* ignore */
		}
		const off: Array<() => void> = [];
		try {
			off.push(pi.events.on(BUS_PING, () => publish()));
			off.push(
				pi.events.on(BUS_INTERRUPT, (data) => {
					const name = (data as { name?: unknown })?.name;
					if (typeof name === "string" && name) void registry.interrupt(name);
				}),
			);
			off.push(pi.events.on(BUS_INTERRUPT_ALL, () => void registry.interruptAll()));
			unsubscribed = () => off.forEach((unsubscribe) => unsubscribe());
		} catch {
			/* no bus — the desktop cannot interrupt, the tools still can */
		}
		publish(ctx);
	});

	pi.on("session_shutdown", async () => {
		/* set before disposing: disposing aborts every run, and those late
		 * settles must not send a wake into a session that is closing */
		shuttingDown = true;
		try {
			unsubscribed?.();
		} catch {
			/* ignore */
		}
		unsubscribed = undefined;
		/* switching sessions must not leave the old conversation's team
		 * running in the background */
		void registry.dispose();
	});
}
