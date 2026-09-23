/**
 * agent-team regression tests — offline: no model, no provider, no network.
 *
 * `agent-team-smoke.mjs` proves the machinery works end to end. This file pins
 * the delivery and teardown rules that were wrong in review, each with a test
 * that fails on the old code:
 *
 *  1. spawn reserves its slot and its name *before* its first await, so two
 *     spawns in the same tick cannot both pass the concurrency check;
 *  2. a spawn still building its session when the team shuts down is refused,
 *     and the session it did create is disposed rather than run;
 *  3. one settle feeds one waiter — a second wait_agent keeps waiting for the
 *     next settle instead of being handed the same result;
 *  4. an already-aborted (or aborted mid-wait) signal returns "aborted" at
 *     once and leaves no waiter behind to eat a later settle;
 *  5. interrupt() arms its grace timer before abort(): a session whose abort()
 *     never resolves still settles as interrupted, frees the slot, and is not
 *     rewritten when the run finally unwinds;
 *  6. the delivered text is the whole answer (the 800-character preview stays
 *     a preview), and list()/bus payloads carry no AgentSession, no closures
 *     and no result payload;
 *  7. an idle root is woken exactly once, with the full result;
 *  8. a turn the user stopped (agent_end with stopReason "aborted") never
 *     wakes — the successful result is delivered on the next idle instead;
 *  9. an interrupted agent never wakes the root, though wait_agent can still
 *     collect its record;
 * 10. session_shutdown delivers nothing — not from the settles it causes, not
 *     from a run that unwinds afterwards — and refuses new spawns;
 * 11. a cancelled wait_agent does not consume the result it will never report.
 *
 * Two seams make that possible offline: a sandbox agent dir
 * (PI_CODING_AGENT_DIR) and the extension's scripted `createSession` option,
 * which replaces the SDK session with a FakeSession this file drives.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(root, "resources", "extensions", "agent-team");

/* ── the sandbox: its own agent dir, so the real one is untouched ── */
const sandbox = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "agent-team-regression-"));
const agentDir = join(sandbox, "agent");
mkdirSync(agentDir, { recursive: true });
/* wakeOnCompletion: true is what the wake scenarios need, and maxConcurrent: 2
   leaves room for them; the registry-level tests pass their own limits */
writeFileSync(join(agentDir, "desktop.json"), JSON.stringify({ agents: { maxConcurrent: 2, wakeOnCompletion: true } }));
process.env.PI_CODING_AGENT_DIR = agentDir;

/* ── assertions ─────────────────────────────────────────── */

const checks = [];
function check(label, ok, detail = "") {
	checks.push({ label, ok: Boolean(ok) });
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
function shorten(value, max = 120) {
	const line = String(value ?? "").replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max)}…` : line;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The rejection reason, or undefined if the promise resolved. */
async function failure(promise) {
	try {
		await promise;
		return undefined;
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

/** The rejection reason — or an Error saying the call did not fail in time.
 *  Bounded, so a regression that accepts a spawn fails the check instead of
 *  hanging the suite. */
async function refusalWithin(promise, ms = 2000) {
	const outcome = await Promise.race([
		promise.then(
			() => ({ settled: "resolved" }),
			(error) => ({ error }),
		),
		sleep(ms).then(() => ({ settled: "pending" })),
	]);
	if (outcome.error) return outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
	return new Error(outcome.settled === "pending" ? `still pending after ${ms}ms` : "resolved instead of failing");
}

/** The run reaches prompt() as the spawn resolves; bounded all the same. */
function awaitPrompted(session) {
	return valueWithin(session.promptStarted, 2000);
}

/** The resolved value, or undefined on rejection/timeout. */
function valueWithin(promise, ms) {
	return Promise.race([promise.then((value) => ({ value }), () => ({})), sleep(ms).then(() => ({}))]).then(
		(outcome) => outcome.value,
	);
}

async function until(predicate, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (predicate()) return true;
		if (Date.now() > deadline) return false;
		await sleep(10);
	}
}

function gate() {
	let open;
	const promise = new Promise((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

/* ── a scripted AgentSession ────────────────────────────── */

class FakeSession {
	constructor() {
		this.messages = [];
		this.listeners = new Set();
		this.promptText = "";
		this.abortCalls = 0;
		this.disposed = false;
		/** abort() never resolves — the hang the grace timer exists for */
		this.hangAbort = false;
		this.stats = { tokens: { input: 11, output: 22, total: 33 }, cost: 0.0004 };
		this.pending = null;
		this.promptStarted = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	/* the AgentSession surface the runtime uses */
	prompt(text) {
		this.promptText = text;
		return new Promise((resolve, reject) => {
			this.pending = { resolve, reject };
			this.markStarted();
		});
	}

	abort() {
		this.abortCalls += 1;
		return this.hangAbort ? new Promise(() => {}) : Promise.resolve();
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getSessionStats() {
		return this.stats;
	}

	dispose() {
		this.disposed = true;
		this.listeners.clear();
	}

	/* test controls */
	finish(answer) {
		if (answer !== undefined) {
			this.messages.push({ role: "assistant", content: [{ type: "text", text: answer }] });
		}
		const pending = this.pending;
		this.pending = null;
		pending?.resolve();
	}

	fail(message) {
		const pending = this.pending;
		this.pending = null;
		pending?.reject(new Error(message));
	}
}

/** Sessions and the scripted factory, shared by both harness styles. */
function makeFleet() {
	const sessions = [];
	const factoryCalls = [];
	let blocked = null;
	return {
		sessions,
		factoryCalls,
		async createSession(options) {
			factoryCalls.push(options);
			if (blocked) await blocked.promise;
			const session = new FakeSession();
			sessions.push(session);
			return { session };
		},
		/** hold the next factory call until unblock() */
		block() {
			blocked = gate();
		},
		unblock() {
			blocked?.open();
			blocked = null;
		},
	};
}

function makeRegistry(options = {}) {
	const fleet = makeFleet();
	const settled = [];
	const registry = new SubagentRegistry(
		{
			onStateChange: () => {},
			onSettled: (agent, info) => settled.push({ agent, info }),
		},
		{ createSession: fleet.createSession, abortGraceMs: 150, ...options },
	);
	return { registry, fleet, settled };
}

const spawnInput = (taskName, extra = {}) => ({
	taskName,
	message: `task for ${taskName}`,
	cwd: process.cwd(),
	agentDir,
	maxConcurrent: 2,
	...extra,
});

/* ── a stub ExtensionAPI, as pi hands one to a plugin ───── */

function makeStub() {
	const tools = new Map();
	const handlers = new Map();
	const sent = [];
	const bus = [];
	const pi = {
		on: (event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: (tool) => tools.set(tool.name, tool),
		getAllTools: () => [...tools.keys()].map((name) => ({ name })),
		events: { emit: (channel, data) => bus.push({ channel, data }), on: () => () => {} },
		sendMessage: (message, options) => sent.push({ message, options }),
		getCommands: () => [],
	};
	const ctx = {
		cwd: process.cwd(),
		model: undefined,
		thinkingLevel: undefined,
		isIdle: () => true,
		signal: undefined,
		mode: "print",
		hasUI: false,
	};
	const text = (result) => result?.content?.map((block) => block.text ?? "").join("\n") ?? "";
	return {
		pi,
		sent,
		bus,
		text,
		callTool: (name, params, signal) =>
			tools.get(name).execute(`call-${Math.random().toString(36).slice(2, 8)}`, params, signal, undefined, ctx),
		fire: async (event, payload) => {
			for (const handler of handlers.get(event) ?? []) await handler(payload);
		},
	};
}

/* ── load the plugin the way pi's jiti loader does ──────── */

const jiti = createJiti(import.meta.url);
const runtimeModule = await jiti.import(join(EXTENSION, "runtime.ts"));
const SubagentRegistry = runtimeModule.SubagentRegistry;
const startTeam = await jiti.import(join(EXTENSION, "index.ts"), { default: true });

/** One fresh extension instance: its own stub host and its own scripted fleet. */
function makeTeam(options = {}) {
	const stub = makeStub();
	const fleet = makeFleet();
	startTeam(stub.pi, { createSession: fleet.createSession, abortGraceMs: 150, ...options });
	return { ...stub, ...fleet };
}

/* ── 1. reservations, not just live records ────────────── */

console.log("\n# slot and name reservations");
{
	const { registry, fleet } = makeRegistry();

	fleet.block();
	const first = registry.spawn(spawnInput("first", { maxConcurrent: 1 }));
	const slotError = await refusalWithin(registry.spawn(spawnInput("second", { maxConcurrent: 1 })));
	check(
		"a spawn in flight holds its slot",
		/All 1 sub-agent slot/.test(slotError?.message ?? "") && /busy/.test(slotError?.message ?? ""),
		shorten(slotError?.message),
	);

	const nameError = await refusalWithin(registry.spawn(spawnInput("first")));
	check("a spawn in flight holds its name", /already exists/.test(nameError?.message ?? ""), shorten(nameError?.message));

	fleet.unblock();
	const spawned = await first;
	check("the reservation releases once the spawn lands", spawned.name === "first" && registry.runningCount() === 1);
	check("only the accepted spawn got a session", fleet.sessions.length === 1, `${fleet.sessions.length} session(s)`);
	check("the spawn view carries no session handle", !("session" in spawned) && !("unsubscribe" in spawned), Object.keys(spawned).join(","));

	fleet.sessions[0].finish("done");
	await until(() => registry.runningCount() === 0);
	check("a settled record frees its slot", registry.activeCount() === 0);
	check("a completed record is deliverable", registry.undelivered().length === 1);
}

/* ── 2. shutdown refuses a spawn that is still building ── */

console.log("\n# pending spawn vs. shutdown");
{
	const { registry, fleet } = makeRegistry();
	fleet.block();
	const late = registry.spawn(spawnInput("late"));
	await until(() => fleet.factoryCalls.length === 1);
	await registry.dispose();
	fleet.unblock();

	const error = await failure(late);
	check("a spawn caught by shutdown is refused", /shutting down/i.test(error?.message ?? ""), shorten(error?.message));
	check("the session it built is disposed, not run", fleet.sessions[0]?.disposed === true);
	check("no record survives shutdown", registry.list().agents.length === 0 && registry.activeCount() === 0);

	const refused = await failure(registry.spawn(spawnInput("after")));
	check("spawn after shutdown is refused", /shutting down/i.test(refused?.message ?? ""), shorten(refused?.message));
}

/* ── 3. one settle, one waiter ─────────────────────────── */

console.log("\n# waiter fan-out");
{
	const { registry, fleet, settled } = makeRegistry();

	const firstWait = registry.waitNext(5000, undefined);
	const secondWait = registry.waitNext(5000, undefined);

	await registry.spawn(spawnInput("one"));
	await awaitPrompted(fleet.sessions[0]);
	fleet.sessions[0].finish("answer one");

	const first = await valueWithin(firstWait, 1000);
	check("the first waiter gets the settle", first?.name === "one" && first?.status === "completed", shorten(first?.result));

	const secondEarly = await valueWithin(secondWait, 150);
	check("the second waiter does not get the same result", secondEarly === undefined);
	check("the first settle is not counted as wake material", settled[0]?.info.hadWaiters === true);

	await registry.spawn(spawnInput("two"));
	await awaitPrompted(fleet.sessions[1]);
	fleet.sessions[1].finish("answer two");

	const second = await valueWithin(secondWait, 1000);
	check("the second waiter gets the next settle", second?.name === "two", shorten(second?.result));
	check("both settles reached a waiter", settled.length === 2 && settled[1]?.info.hadWaiters === true);
}

/* ── 4. aborted signals ────────────────────────────────── */

console.log("\n# cancel-safe waiting");
{
	const { registry, fleet, settled } = makeRegistry();

	const preAborted = await valueWithin(registry.waitNext(5000, AbortSignal.abort()), 1000);
	check("an already-aborted signal returns at once", preAborted === "aborted", String(preAborted));

	const controller = new AbortController();
	const midWait = registry.waitNext(5000, controller.signal);
	controller.abort();
	check("an abort mid-wait returns at once", (await valueWithin(midWait, 500)) === "aborted");

	await registry.spawn(spawnInput("solo"));
	await awaitPrompted(fleet.sessions[0]);
	fleet.sessions[0].finish("solo answer");
	await until(() => registry.undelivered().length === 1);
	check("a cancelled waiter does not consume a later settle", settled[0]?.info.hadWaiters === false);
	check("the later settle stays undelivered for the tools", registry.undelivered().length === 1);
}

/* ── 5. interrupt: grace timer before a possibly-hanging abort ── */

console.log("\n# interrupt vs. a run that will not unwind");
{
	const { registry, fleet } = makeRegistry({ abortGraceMs: 120 });
	await registry.spawn(spawnInput("stuck"));
	const session = fleet.sessions[0];
	await awaitPrompted(session);
	session.hangAbort = true;

	const waiter = registry.waitNext(5000, undefined);
	const started = Date.now();
	const previous = await registry.interrupt("stuck");
	check(
		"interrupt answers without awaiting the abort",
		previous === "running" && Date.now() - started < 500,
		`${Date.now() - started}ms, abort() calls: ${session.abortCalls}`,
	);

	const settledAgent = await valueWithin(waiter, 2000);
	check(
		"the grace timer settles a hung interrupt",
		settledAgent?.name === "stuck" && settledAgent?.status === "interrupted",
		String(settledAgent?.status),
	);
	check("the slot is free again", registry.activeCount() === 0);

	/* the hung run finally unwinds — too late, and it must stay quiet */
	session.finish("late partial answer");
	await sleep(30);
	check(
		"a late unwind does not rewrite the delivered status",
		registry.list().agents[0]?.status === "interrupted",
		String(registry.list().agents[0]?.status),
	);
	check("interrupting an unknown name says so", (await registry.interrupt("ghost")) === "not_found");
}

/* ── 6. the whole answer, and only the view on the bus ─── */

console.log("\n# result payload");
{
	const { registry, fleet } = makeRegistry();
	await registry.spawn(spawnInput("long"));
	await awaitPrompted(fleet.sessions[0]);
	const answer = `${"x".repeat(3000)}END_MARKER`;
	fleet.sessions[0].finish(answer);
	await until(() => registry.undelivered().length === 1);

	const [undelivered] = registry.undelivered();
	check("the delivered text is the whole answer", undelivered.result === answer, `${undelivered.result?.length ?? 0} chars`);
	check(
		"the summary stays an 800-character preview",
		(undelivered.summary ?? "").length <= 800 && (undelivered.summary ?? "").endsWith("…"),
		`${undelivered.summary?.length ?? 0} chars`,
	);

	const listed = registry.list();
	const view = listed.agents[0];
	check(
		"list() exposes no session, closures or result",
		!("session" in view) &&
			!("unsubscribe" in view) &&
			!("delivered" in view) &&
			!("settled" in view) &&
			!("result" in view),
		Object.keys(view).join(","),
	);
	let serialized = "";
	try {
		serialized = JSON.stringify(listed);
	} catch (error) {
		serialized = `threw: ${error.message}`;
	}
	check(
		"the bus payload serializes and stays a preview",
		serialized.includes("long") && !serialized.includes("END_MARKER"),
		shorten(serialized, 80),
	);

	check("a result is claimed exactly once", Boolean(registry.takeUndelivered()) && registry.takeUndelivered() === undefined);
}

/* ── 7. wake on a settle while the root is idle ────────── */

console.log("\n# wake on completion");
{
	const team = makeTeam();
	const answer = `${"z".repeat(1200)}WAKE_MARKER`;
	const spawned = await team.callTool("spawn_agent", { message: "do the thing", task_name: "wake_case" });
	check("spawn_agent accepted", !spawned?.isError, shorten(team.text(spawned)));

	await awaitPrompted(team.sessions[0]);
	team.sessions[0].finish(answer);
	await until(() => team.sent.length === 1);
	const [wake] = team.sent;
	check(
		"an idle root is woken with the full result",
		team.sent.length === 1 &&
			wake?.options?.triggerTurn === true &&
			String(wake.message.content).includes("WAKE_MARKER") &&
			String(wake.message.content).includes("z".repeat(1200)),
		shorten(wake?.message?.content),
	);
	check("the wake names the agent and its status", /Sub-agent wake_case completed/.test(String(wake?.message?.content)));

	await team.fire("agent_settled");
	check("the wake is not repeated", team.sent.length === 1);
}

/* ── 8. a stopped turn never wakes; the result survives ── */

console.log("\n# stop is not a result");
{
	const team = makeTeam();
	await team.fire("agent_start");
	await team.callTool("spawn_agent", { message: "slow task", task_name: "stop_case" });
	await awaitPrompted(team.sessions[0]);
	team.sessions[0].finish("stop_case result END_STOP");
	await until(() =>
		team.bus.some((entry) => entry.data?.agents?.some((agent) => agent.name === "stop_case" && agent.status === "completed")),
	);
	check("a settle mid-turn does not wake", team.sent.length === 0);

	/* the user stops the turn: the SDK closes an aborted turn with an
	   assistant message carrying stopReason "aborted" */
	await team.fire("agent_end", { messages: [{ role: "assistant", content: [], stopReason: "aborted" }] });
	await team.fire("agent_settled");
	check("a stopped turn does not wake on its results", team.sent.length === 0, `${team.sent.length} wake(s)`);

	/* the next turn ends normally: the stopped turn's result still arrives */
	await team.fire("agent_start");
	await team.fire("agent_end", { messages: [{ role: "assistant", content: [], stopReason: "stop" }] });
	await team.fire("agent_settled");
	await until(() => team.sent.length === 1);
	check(
		"the successful result arrives on the next idle",
		team.sent.length === 1 && /END_STOP/.test(String(team.sent[0]?.message?.content)),
		shorten(team.sent[0]?.message?.content),
	);

	const listed = await team.callTool("list_agents", {});
	check("the stopped agent is still listed", /stop_case: completed/.test(team.text(listed)), shorten(team.text(listed)));

	const leaked = team.bus.some((entry) => entry.data?.agents?.some((agent) => "session" in agent || "unsubscribe" in agent));
	check("the fleet bus payload carries no session handles", !leaked);
}

/* ── 9. interruptions do not wake ──────────────────────── */

console.log("\n# interrupts stay quiet");
{
	const team = makeTeam();
	await team.callTool("spawn_agent", { message: "very slow task", task_name: "int_case" });
	await awaitPrompted(team.sessions[0]);
	team.sessions[0].hangAbort = true;

	const interrupted = await team.callTool("interrupt_agent", { target: "int_case" });
	check(
		"interrupt reports the previous status",
		/interrupted int_case \(was running\)/.test(team.text(interrupted)),
		shorten(team.text(interrupted)),
	);
	await until(() =>
		team.bus.some((entry) => entry.data?.agents?.some((agent) => agent.name === "int_case" && agent.status === "interrupted")),
	);
	await team.fire("agent_settled");
	check("an interrupted agent never wakes the root", team.sent.length === 0, `${team.sent.length} wake(s)`);

	const collected = await team.callTool("wait_agent", { timeout_ms: 10_000 });
	check(
		"wait_agent still collects the interrupted record",
		/int_case interrupted/.test(team.text(collected)),
		shorten(team.text(collected)),
	);
}

/* ── 10. shutdown delivers nothing and refuses work ────── */

console.log("\n# shutdown");
{
	const team = makeTeam();
	await team.callTool("spawn_agent", { message: "hanging task", task_name: "shut_case" });
	const session = team.sessions[0];
	await awaitPrompted(session);
	session.hangAbort = true;

	await team.fire("session_shutdown");
	check("shutdown disposes the sub-agent session", session.disposed === true);
	check("shutdown itself wakes nothing", team.sent.length === 0);

	await team.fire("agent_settled");
	check("a settle after teardown wakes nothing", team.sent.length === 0);

	session.fail("late failure");
	await sleep(40);
	check("a run unwinding after teardown wakes nothing", team.sent.length === 0, `${team.sent.length} wake(s)`);

	const refused = await team.callTool("spawn_agent", { message: "new task", task_name: "after_shutdown" });
	check(
		"spawn after shutdown is refused",
		Boolean(refused?.isError) && /shutting down/i.test(team.text(refused)),
		shorten(team.text(refused)),
	);
}

/* ── 11. cancelled waits do not eat results ────────────── */

console.log("\n# cancelled wait_agent");
{
	const team = makeTeam();
	await team.fire("agent_start");
	await team.callTool("spawn_agent", { message: "long answer task", task_name: "full_case" });
	await awaitPrompted(team.sessions[0]);
	team.sessions[0].finish(`${"a".repeat(1500)}FULL_MARKER`);
	await sleep(60);

	const cancelled = await team.callTool("wait_agent", { timeout_ms: 10_000 }, AbortSignal.abort());
	check("a cancelled wait_agent reports cancellation", /cancelled/.test(team.text(cancelled)), shorten(team.text(cancelled)));

	const waited = await team.callTool("wait_agent", { timeout_ms: 10_000 });
	const body = team.text(waited);
	check("wait_agent returns the whole answer", body.includes("FULL_MARKER") && body.includes("a".repeat(1500)), `${body.length} chars`);
}

/* ── done ──────────────────────────────────────────────── */

console.log("\n# uncollected result capacity");
{
	const { registry, fleet } = makeRegistry();
	for (let i = 0; i < 12; i++) {
		await registry.spawn(spawnInput(`retained_${i}`));
		fleet.sessions[i].finish(`result ${i}`);
		await until(() => registry.runningCount() === 0);
	}
	const error = await failure(registry.spawn(spawnInput("overflow")));
	check("uncollected results apply backpressure instead of being dropped", /Collect pending results/.test(error?.message ?? ""));
	check("all twelve undelivered results are retained", registry.undelivered().length === 12);
	registry.takeUndelivered();
	await registry.spawn(spawnInput("after_collection"));
	check("collecting a result allows another spawn", registry.runningCount() === 1);
	check("pruning preserves remaining undelivered records", registry.undelivered().length === 11);
	await registry.dispose();
}
rmSync(sandbox, { recursive: true, force: true });
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (offline regression)`);
process.exit(failed.length ? 1 : 0);
