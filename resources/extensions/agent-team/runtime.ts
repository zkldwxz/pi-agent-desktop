/**
 * The sub-agent runtime: who is running, when they settle, and who was told.
 *
 * Each spawn creates a real pi AgentSession in this process — its own context
 * window, an in-memory session, the model and thinking level inherited from
 * the parent at spawn time — and its own loader, built from the host's own
 * tool factories and nothing from disk: `noExtensions` keeps every path plugin
 * out, so a sub-agent cannot reach the team tools (no nesting) or any other
 * plugin, while the factories the host names run exactly as they do in the
 * parent. One loader per session, never shared: the loader owns the loaded
 * Extension objects and the single ExtensionRuntime that each bound session
 * rewrites, so a shared loader would let two sub-agents overwrite each other's
 * session-bound actions.
 *
 * Delivery protocol (the part Codex solves with mailboxes and wait_agent):
 * a settled record is *delivered* exactly once, either to a pending
 * wait_agent call or — when the parent is idle and wake-on-completion is on —
 * as a wake message that starts a new turn. Records that settle while the
 * parent is mid-turn and nobody waits stay undelivered until a wait_agent
 * call takes them or the parent goes idle. list_agents shows statuses
 * regardless of delivery.
 *
 * Invariants, each of which was once a bug:
 * - the concurrency cap counts *reservations*, not just live records: spawn is
 *   async from its first line, so two spawns in the same tick must not both
 *   see a free slot;
 * - one settle feeds exactly one waiter; every other waiter keeps waiting for
 *   the next settle rather than being handed the same result;
 * - a record settles exactly once, and a run that unwinds after the fact does
 *   not rewrite a status the root was already told;
 * - nothing is delivered and no hook fires after dispose(): the session that
 *   spawned the fleet is gone, and a wake would restart it.
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	type AgentSession,
	type ExtensionContext,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { subagentRole } from "./prompts.ts";
import { truncate, type FleetAgent, type FleetAgentStatus, type FleetState } from "./state.ts";

type ModelLike = NonNullable<ExtensionContext["model"]>;
type ThinkingLevelLike = NonNullable<ExtensionContext["thinkingLevel"]>;

/**
 * One inline extension, in the exact shape the loader's `extensionFactories`
 * option takes. The host supplies these (see `getExtensionFactories`); the
 * same named factories run in the parent session, so a sub-agent's tool
 * surface matches the parent's apart from the team tools it must not have.
 */
export interface NamedExtensionFactory {
	name: string;
	factory: ExtensionFactory;
}

export interface SpawnInput {
	taskName: string;
	message: string;
	cwd: string;
	agentDir: string;
	model?: ModelLike;
	thinkingLevel?: ThinkingLevelLike;
	/** how many agents may run at once (the root's own slot excluded) */
	maxConcurrent: number;
}

/**
 * The one SDK call `spawn` makes: build a session for a sub-agent.
 *
 * Injectable (see `RegistryOptions`) so the offline regression tests can drive
 * a scripted session instead of a live model. The production default below is
 * the real `createAgentSession`.
 */
export type SessionFactory = (options: {
	cwd: string;
	agentDir: string;
	model?: ModelLike;
	thinkingLevel?: ThinkingLevelLike;
	resourceLoader: DefaultResourceLoader;
}) => Promise<{ session: AgentSession }>;

/** A settle always reaches `onSettled`; `hadWaiters` says whether a pending
 *  wait_agent already consumed it (then no wake message is needed). */
export interface RegistryHooks {
	onStateChange(): void;
	onSettled(record: FleetAgent, info: { hadWaiters: boolean }): void;
}

export interface RegistryOptions {
	/** test seam; omit to use createAgentSession */
	createSession?: SessionFactory;
	/** the inline extensions a sub-agent session must load, asked once per
	 *  spawn. Omit and sub-agents run with no extensions beyond the built-in
	 *  tools — which is the right answer in a host that never registers any. */
	getExtensionFactories?: () => NamedExtensionFactory[];
	/** how long an interrupted run may take to unwind before the record is
	 *  settled anyway (tests shorten it) */
	abortGraceMs?: number;
}

interface Record extends FleetAgent {
	session: AgentSession;
	unsubscribe?: () => void;
	interruptRequested: boolean;
	delivered: boolean;
	/** set by settle() — the one flag a double settle checks; status and
	 * endedAt are written before the call on the normal path, so they cannot
	 * guard it */
	settled: boolean;
	error?: string;
	lastStatsAt: number;
}

/** Keep the fleet bounded: pruned records dispose their sessions. */
const MAX_RECORDS = 12;
/** If abort() does not settle the run within this, force the status. */
const ABORT_GRACE_MS = 2000;

const defaultSessionFactory: SessionFactory = async (options) => {
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir: options.agentDir,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		/* no `tools` list: inherit the configured default tool set —
		 * with noExtensions there are no team tools to inherit */
		sessionManager: SessionManager.inMemory(options.cwd),
		resourceLoader: options.resourceLoader,
	});
	/* A sub-agent session gets the same extension lifecycle as any other:
	 * the SDK binds extensions from the mode that owns the session (print,
	 * rpc, interactive) and a sub-agent has no mode of its own, so it binds
	 * itself. Without this the factories' tools still register — the session
	 * builds its tool registry at construction — but their `session_start`
	 * handlers would never run. "print" is the no-UI mode: the runner gets the
	 * no-op UI context, which is what a windowless sub-agent has. */
	await session.bindExtensions({ mode: "print" });
	return { session };
};

/** A settled record nobody has been told about yet. */
function isUndelivered(record: Record): boolean {
	return record.status !== "running" && !record.delivered;
}

export function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			const item = block as { type?: string; text?: string };
			return item?.type === "text" && typeof item.text === "string" ? item.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

/** The sub-agent's last assistant prose — its final answer. */
function finalAnswer(session: AgentSession): string {
	const messages = session.messages as unknown as { role?: string; content?: unknown }[];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = textFromContent(message.content).trim();
		if (text) return text;
	}
	return "";
}

export class SubagentRegistry {
	private records: Record[] = [];
	private waiters: Array<(outcome: FleetAgent | "aborted") => void> = [];
	/** task_names whose spawn is still building its session — the slots and
	 *  names a concurrent spawn must not be allowed to reuse */
	private readonly pending = new Set<string>();
	private readonly createSession: SessionFactory;
	private readonly getExtensionFactories: () => NamedExtensionFactory[];
	private readonly abortGraceMs: number;
	private disposed = false;

	constructor(private readonly hooks: RegistryHooks, options: RegistryOptions = {}) {
		this.createSession = options.createSession ?? defaultSessionFactory;
		this.getExtensionFactories = options.getExtensionFactories ?? (() => []);
		this.abortGraceMs = options.abortGraceMs ?? ABORT_GRACE_MS;
	}

	runningCount(): number {
		return this.records.filter((record) => record.status === "running").length;
	}

	/** Running agents plus spawns that have reserved a slot but are still
	 *  building their session — what the concurrency cap is checked against. */
	activeCount(): number {
		return this.runningCount() + this.pending.size;
	}

	list(): FleetState {
		return {
			agents: this.records.map((record) => this.view(record)),
			updatedAt: Date.now(),
		};
	}

	find(name: string): Record | undefined {
		return this.records.find((record) => record.name === name);
	}

	/** Settled records no wait_agent call has reported yet. */
	undelivered(): FleetAgent[] {
		return this.records.filter(isUndelivered).map((record) => this.view(record, true));
	}

	/**
	 * Claim the oldest undelivered result for one caller: the record is marked
	 * delivered as it is handed over, so two wait_agent calls can never report
	 * the same settle.
	 */
	takeUndelivered(): FleetAgent | undefined {
		const record = this.records
			.filter(isUndelivered)
			.sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0))[0];
		if (!record) return undefined;
		record.delivered = true;
		return this.view(record, true);
	}

	/** Mark records as delivered (a wake message sent them). */
	markDelivered(names: string[]): void {
		for (const name of names) {
			const record = this.find(name);
			if (record) record.delivered = true;
		}
	}

	/**
	 * Spawn a sub-agent. Returns once the session exists and the task is
	 * queued — the run itself proceeds in the background.
	 */
	async spawn(input: SpawnInput): Promise<FleetAgent> {
		if (this.disposed) throw new Error("The agent team is shutting down.");
		/* Reserve the slot and the name *before* the first await: both
		 * ensureLoader and createSession are async, so concurrent spawns that
		 * only looked at this.records would all see the same free slot and
		 * overrun the cap. */
		const busy = this.activeCount();
		if (busy >= input.maxConcurrent) {
			throw new Error(
				`All ${input.maxConcurrent} sub-agent slot${input.maxConcurrent === 1 ? " is" : "s are"} busy (${busy} in flight, this spawn included). Wait for an agent to finish with wait_agent, or interrupt one with interrupt_agent.`,
			);
		}
		if (this.records.some((record) => record.name === input.taskName) || this.pending.has(input.taskName)) {
			throw new Error(`A sub-agent named "${input.taskName}" already exists in this session.`);
		}
		const uncollected = this.records.filter((record) => !record.delivered).length;
		if (uncollected + this.pending.size >= Math.max(MAX_RECORDS, input.maxConcurrent)) {
			throw new Error("Collect pending results with wait_agent before spawning more agents.");
		}
		this.pending.add(input.taskName);
		try {
			const loader = await this.createLoader(input.cwd, input.agentDir);
			this.assertLive();
			const { session } = await this.createSession({
				cwd: input.cwd,
				agentDir: input.agentDir,
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				resourceLoader: loader,
			});
			/* the session exists, but the parent may have gone away while it was
			 * being built: never start a task into a disposed team */
			if (this.disposed) {
				try {
					session.dispose();
				} catch {
					/* ignore */
				}
				throw new Error("The agent team is shutting down.");
			}

			const record: Record = {
				name: input.taskName,
				status: "running",
				task: truncate(input.message, 160),
				model: input.model ? `${input.model.provider}/${input.model.id}` : undefined,
				thinkingLevel: input.thinkingLevel,
				spawnedAt: Date.now(),
				session,
				interruptRequested: false,
				delivered: false,
				settled: false,
				lastStatsAt: 0,
			};
			this.records.push(record);
			this.watchStats(record);
			this.hooks.onStateChange();
			this.prune();

			void this.run(record, input.message);
			return this.view(record);
		} finally {
			this.pending.delete(input.taskName);
		}
	}

	/**
	 * Block until the next agent settles. Settles that happened before the
	 * call and were never delivered are returned immediately by the caller
	 * (see `undelivered`) — this promise is only for the *next* one.
	 */
	waitNext(timeoutMs: number, signal: AbortSignal | undefined): Promise<FleetAgent | "timeout" | "aborted"> {
		return new Promise((resolve) => {
			/* a signal that is already aborted never gets its event, so the
			 * waiter would otherwise sit here until the timeout */
			if (signal?.aborted) {
				resolve("aborted");
				return;
			}
			const waiter = (outcome: FleetAgent | "aborted") => {
				cleanup();
				resolve(outcome);
			};
			const timer = setTimeout(() => {
				cleanup();
				resolve("timeout");
			}, timeoutMs);
			const onAbort = () => {
				cleanup();
				resolve("aborted");
			};
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				const index = this.waiters.indexOf(waiter);
				if (index >= 0) this.waiters.splice(index, 1);
			};
			this.waiters.push(waiter);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	/** Interrupt one agent by name. Returns its previous status. */
	async interrupt(name: string): Promise<FleetAgent["status"] | "not_found"> {
		const record = this.find(name);
		if (!record) return "not_found";
		if (record.status !== "running") return record.status;
		record.interruptRequested = true;
		/* arm the backstop *before* asking the session to abort: abort() waits
		 * for the run to go idle, and a run that ignores the abort must still
		 * free its slot and settle any waiter */
		this.armGraceTimer(record);
		/* and do not await the abort itself — its caller is a tool call or a bus
		 * event, and abort() has no upper bound */
		void record.session.abort().catch(() => {
			/* the grace timer settles the record either way */
		});
		this.hooks.onStateChange();
		return "running";
	}

	/** Interrupt every running agent; returns how many. */
	async interruptAll(): Promise<number> {
		const running = this.records.filter((record) => record.status === "running");
		for (const record of running) await this.interrupt(record.name);
		return running.length;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const records = this.records;
		this.records = [];
		/* session.dispose() aborts the run synchronously, which is all the
		 * shutdown needs — awaiting session.abort() here could hang on a run
		 * that never unwinds, leaving the fleet (and the parent) stuck */
		for (const record of records) {
			try {
				record.unsubscribe?.();
			} catch {
				/* ignore */
			}
			try {
				record.session.dispose();
			} catch {
				/* ignore */
			}
		}
		this.waiters.splice(0).forEach((waiter) => waiter("aborted"));
		this.hooks.onStateChange();
	}

	/* ── internals ─────────────────────────────────────────── */

	private assertLive(): void {
		if (this.disposed) throw new Error("The agent team is shutting down.");
	}

	/**
	 * The FleetAgent fields, and only those: a record also holds a live
	 * AgentSession and an unsubscribe closure, and neither may leak into
	 * list() results or the bus payload the desktop mirrors. `result` rides
	 * along only on the delivery paths — it is the full answer, not a preview.
	 */
	private view(record: Record, withResult = false): FleetAgent {
		const agent: FleetAgent = {
			name: record.name,
			status: record.status,
			task: record.task,
			model: record.model,
			thinkingLevel: record.thinkingLevel,
			spawnedAt: record.spawnedAt,
			endedAt: record.endedAt,
			tokens: record.tokens,
			cost: record.cost,
			summary: record.summary,
		};
		if (withResult) agent.result = record.result;
		return agent;
	}

	private async run(record: Record, task: string): Promise<void> {
		let status: FleetAgentStatus;
		let error: string | undefined;
		try {
			await record.session.prompt(task);
			status = record.interruptRequested ? "interrupted" : "completed";
		} catch (thrown) {
			status = record.interruptRequested ? "interrupted" : "errored";
			error = thrown instanceof Error ? thrown.message : String(thrown);
		}
		if (record.settled) {
			/* the abort grace timer settled (and maybe delivered) this record
			 * while the run was still unwinding — the late unwind must not
			 * rewrite a status the root has already seen */
			this.refreshStats(record);
			return;
		}
		record.status = status;
		record.error = error;
		record.endedAt = Date.now();
		const answer = finalAnswer(record.session);
		/* the answer itself is kept whole for delivery; `summary` is the
		 * preview the panel and list_agents show */
		record.result = error ?? (answer || undefined);
		record.summary = error ? truncate(error, 400) : truncate(answer || "(no answer)", 800);
		try {
			record.unsubscribe?.();
		} catch {
			/* ignore */
		}
		this.refreshStats(record);
		this.settle(record, status);
	}

	/** finalize a record and hand it to exactly one waiter */
	private settle(record: Record, status: FleetAgentStatus): void {
		if (record.settled) {
			/* the abort-grace timer may race the run's own settle — first one
			 * through delivers, the second is a no-op */
			return;
		}
		record.settled = true;
		record.status = status;
		record.endedAt = Date.now();
		/* the *first* waiter consumes it; a second concurrent wait_agent must
		 * wait for the next settle instead of reporting the same result */
		const waiter = this.waiters.shift();
		if (waiter) record.delivered = true;
		if (this.disposed) return; /* the parent turn is gone: deliver nothing */
		const view = this.view(record, true);
		waiter?.(view);
		this.hooks.onStateChange();
		this.hooks.onSettled(view, { hadWaiters: Boolean(waiter) });
	}

	/** Settle an interrupted record if its run has not unwound in time. */
	private armGraceTimer(record: Record): void {
		const timer = setTimeout(() => {
			if (record.status === "running") this.settle(record, "interrupted");
		}, this.abortGraceMs);
		/* an unref'd timer must not hold the host process open at exit */
		(timer as unknown as { unref?: () => void }).unref?.();
	}

	private watchStats(record: Record): void {
		try {
			record.unsubscribe = record.session.subscribe((event) => {
				if (event.type !== "message_end") return;
				const now = Date.now();
				if (now - record.lastStatsAt < 1000) return;
				record.lastStatsAt = now;
				this.refreshStats(record);
				this.hooks.onStateChange();
			});
		} catch {
			/* a session that cannot be subscribed to still runs */
		}
	}

	private refreshStats(record: Record): void {
		try {
			const stats = record.session.getSessionStats();
			record.tokens = {
				input: stats.tokens.input,
				output: stats.tokens.output,
				total: stats.tokens.total,
			};
			record.cost = stats.cost;
		} catch {
			/* stats are a courtesy */
		}
	}

	/** drop the oldest settled records (and their sessions) past the cap */
	private prune(): void {
		const settled = this.records.filter((record) => record.status !== "running" && record.delivered);
		const overflow = this.records.length - MAX_RECORDS;
		if (overflow <= 0 || settled.length === 0) return;
		const dropping = settled.slice(0, Math.min(overflow, settled.length));
		this.records = this.records.filter((record) => !dropping.includes(record));
		for (const record of dropping) {
			try {
				record.unsubscribe?.();
			} catch {
				/* ignore */
			}
			try {
				record.session.dispose();
			} catch {
				/* ignore */
			}
		}
	}

	/**
	 * The loader for one sub-agent session.
	 *
	 * Built fresh per spawn and never reused: a loader owns the loaded
	 * Extension objects and the one ExtensionRuntime that every bound session
	 * rewrites (`bindCore` writes `getAllTools`, `sendMessage`,
	 * `refreshTools` … into it), so a shared loader would let the second
	 * sub-agent silently take over the first one's session-bound actions. The
	 * factories themselves are per-session state by construction.
	 *
	 * What it keeps from the previous shared-loader version is the SDK doing
	 * the loading: a standard DefaultResourceLoader, reloaded once, with the
	 * host's factories and the sub-agent role.
	 */
	private async createLoader(cwd: string, agentDir: string): Promise<DefaultResourceLoader> {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			/* path plugins stay out: no team tools (no nesting), no plan mode,
			 * nothing the parent session loaded from disk */
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPrompt: [subagentRole()],
			/* the host's own tool factories — the same ones the parent session
			 * runs, so a sub-agent can do everything the parent can except
			 * delegate further */
			extensionFactories: this.getExtensionFactories(),
		});
		await loader.reload();
		return loader;
	}
}
