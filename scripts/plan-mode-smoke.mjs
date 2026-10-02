/**
 * plan-mode smoke test — drives the real plugin headless, no desktop needed.
 *
 *   node scripts/plan-mode-smoke.mjs
 *
 * jiti-loads `resources/extensions/plan-mode/index.ts` against a stub
 * ExtensionAPI — the surface the extension actually touches — and drives the
 * real command handlers, the real create_plan tool and the real event handlers.
 * Nothing is mocked inside the plugin: the assertions below are about the state
 * machine, not about a second implementation of it.
 *
 * What it covers, in the order the phases run:
 *
 *   gating      /plan closes the read-only gate without touching the tool
 *               catalog (the catalog is part of the cached request prefix);
 *               a *restarted* runtime that resumes a review plan closes it
 *               again from the log; a branch with no plan of its own reopens it
 *   create_plan in plan mode, outside it (a plan on screen is always
 *               read-only), and when no root of the plan file is writable
 *   build       the kickoff carries each step's detail, the plan file's path
 *               and the plan's notes, opens the gate, and does not leave a
 *               user-shaped bubble in the transcript
 *   residue     reminders of a finished phase leave the model context
 *   progress    todo_write labels match the plan's steps across punctuation and
 *               case; a failed step stalls the build and says so; all done
 *               finishes it
 *   thinking    the level plan mode raised comes back down, a level the user
 *               moved during planning does not
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/* `PLAN_MODE_EXT` points the harness at another copy of the plugin — used to
 * prove the checks fail against the behaviours they were written for */
const pluginDir = process.env.PLAN_MODE_EXT ?? join(root, "resources", "extensions", "plan-mode");
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "glob", "todo_write", "spawn_agent", "create_plan"];

const checks = [];
const check = (label, ok, detail = "") => {
	checks.push({ label, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ── one mounted extension: a fresh runtime over a shared session log ── */

const workRoot = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "plan-mode-smoke-"));
let dirSeq = 0;

function mount({ branch = [], cwd = null, activeTools = DEFAULT_TOOLS } = {}) {
	const dir = cwd ?? join(workRoot, `work-${++dirSeq}`);
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		/* a test that hands the harness an unwritable cwd still gets a working
		 * runtime: the plugin only ever passes the path on to the file writer */
	}

	const tools = new Map();
	const commands = new Map();
	const handlers = new Map();
	const bus = new Map();
	const notifications = [];
	const sent = [];
	const published = [];
	let active = [...activeTools];
	let thinking = "medium";

	const pi = {
		on: (event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: (name, options) => commands.set(name, options),
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => false,
		getActiveTools: () => [...active],
		setActiveTools: (names) => {
			active = [...names];
		},
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level) => {
			thinking = level;
		},
		appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
		sendMessage: (message, options) => sent.push({ ...message, options, kind: "custom" }),
		sendUserMessage: (content, options) => sent.push({ role: "user", content, options, kind: "user" }),
		getCommands: () => [],
		events: {
			emit: (channel, data) => {
				if (channel === "plan-mode:state") published.push(JSON.parse(JSON.stringify(data ?? null)));
				for (const listener of bus.get(channel) ?? []) listener(data);
			},
			on: (channel, listener) => {
				const list = bus.get(channel) ?? [];
				list.push(listener);
				bus.set(channel, list);
				return () => {
					bus.set(channel, (bus.get(channel) ?? []).filter((fn) => fn !== listener));
				};
			},
		},
	};

	const makeCtx = (overrides = {}) => ({
		ui: {
			setStatus: () => {},
			setWidget: () => {},
			notify: (message, kind) => notifications.push({ message, kind }),
			select: async () => undefined,
			input: async () => undefined,
		},
		mode: "tui",
		hasUI: true,
		cwd: dir,
		sessionManager: { getBranch: () => branch, getEntries: () => branch },
		model: { provider: "stub", id: "stub-model" },
		isIdle: () => true,
		signal: undefined,
		...overrides,
	});

	const fire = async (event, payload = {}, ctx = makeCtx()) => {
		const results = [];
		for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, ctx));
		return results;
	};

	const call = (name, params, ctx = makeCtx()) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`no tool ${name}`);
		return tool.execute(`call-${Math.random().toString(36).slice(2, 8)}`, params, undefined, undefined, ctx);
	};

	const command = (line, ctx = makeCtx()) => {
		const [name, ...rest] = line.trim().replace(/^\//, "").split(/\s+/);
		const handler = commands.get(name);
		if (!handler) throw new Error(`no command ${name}`);
		return handler.handler(rest.join(" "), ctx);
	};

	return {
		dir,
		branch,
		notifications,
		sent,
		published,
		get active() {
			return active;
		},
		get thinking() {
			return thinking;
		},
		setThinking: (level) => {
			thinking = level;
		},
		state: () => published.at(-1) ?? null,
		pi,
		makeCtx,
		fire,
		call,
		command,
		text: (result) => (result?.content ?? []).map((block) => block.text ?? "").join("\n"),
	};
}

const jiti = createJiti(import.meta.url);
const factory = await jiti.import(join(pluginDir, "index.ts"), { default: true });

/** Mount the plugin — a fresh runtime over the log (and cwd) it is given. */
function boot(options = {}) {
	const harness = mount(options);
	factory(harness.pi);
	return harness;
}

/**
 * What the context hook left behind. A handler that filters nothing returns
 * nothing, which means every message was kept.
 */
async function keptMessages(harness, messages) {
	const results = await harness.fire("context", { type: "context", messages });
	return results[0]?.messages ?? messages;
}

/* ═══ 1. entering plan mode closes the gate without touching the catalog ═══ */

const session = boot();
const catalog = [...session.active];
await session.fire("session_start", { type: "session_start", reason: "startup" });
check("session_start publishes off", session.state()?.phase === "off");
await session.command("/plan");
check(
	"/plan leaves the tool catalog alone (cache-stable request prefix)",
	session.active.join(",") === catalog.join(","),
	session.active.join(","),
);
check("the write tools stay listed while planning", session.active.includes("edit") && session.active.includes("write"));
check("planning raises thinking to xhigh", session.thinking === "xhigh", session.thinking);
check("state published as planning", session.state()?.phase === "planning");

/* the lock: a write call is refused while the mode is on */
const blocked = await session.fire("tool_call", { type: "tool_call", toolCallId: "t1", toolName: "edit", input: {} });
check("tool_call blocks edit while planning", blocked[0]?.block === true, String(blocked[0]?.reason ?? "").slice(0, 90));
check(
	"the refusal points at create_plan",
	/create_plan/.test(String(blocked[0]?.reason ?? "")),
	String(blocked[0]?.reason ?? "").slice(0, 110),
);
const allowed = await session.fire("tool_call", { type: "tool_call", toolCallId: "t2", toolName: "read", input: {} });
check("tool_call lets read through", allowed[0] === undefined);

/* ═══ 2. create_plan in plan mode writes the file and enters review ═══ */

const plan = await session.call("create_plan", {
	title: "Refresh path",
	body: "Ruled out a proxy hop; the refresh route handles rotation.",
	steps: [
		{ label: "Add the refresh route", detail: "src/auth/refresh.ts" },
		{ label: "Cover it with a test", detail: "test/auth.test.ts" },
	],
});
const planText = session.text(plan);
check("create_plan reports the file", /Plan written to .*refresh-path\.md/.test(planText), planText.slice(0, 120));
const planPath = session.state()?.path;
check("create_plan moves to review", session.state()?.phase === "review");
check("plan file exists on disk", Boolean(planPath) && existsSync(planPath), String(planPath));
const planBody = planPath && existsSync(planPath) ? readFileSync(planPath, "utf8") : "";
check("plan file carries step detail", planBody.includes("src/auth/refresh.ts"), planBody.slice(0, 80));
check("plan file carries notes", planBody.includes("Ruled out a proxy hop"));

/* ═══ 3. a restarted runtime closes the gate from the log, not from its own memory ═══ */

const resumed = boot({ branch: session.branch, cwd: session.dir });
const resumedCatalog = [...resumed.active];
await resumed.fire("session_start", { type: "session_start", reason: "resume" });
check("resume restores the review phase", resumed.state()?.phase === "review", String(resumed.state()?.phase));
check("resume leaves the catalog alone", resumed.active.join(",") === resumedCatalog.join(","), resumed.active.join(","));
const resumedWrite = await resumed.fire("tool_call", { type: "tool_call", toolCallId: "r1", toolName: "write", input: {} });
check("resume refuses a write again", resumedWrite[0]?.block === true, String(resumedWrite[0]?.reason ?? "").slice(0, 90));
check("resume keeps the plan path", resumed.state()?.path === planPath);
check("resume keeps the plan steps", resumed.state()?.steps?.length === 2);
check("resume keeps the notes", resumed.state()?.body?.includes("Ruled out a proxy hop") === true);

/* a branch switch onto a branch that never had a plan is not the old plan */
resumed.branch.length = 0;
await resumed.fire("session_tree", { type: "session_tree", newLeafId: null, oldLeafId: "x" });
check("branch without a plan goes off", resumed.state()?.phase === "off", String(resumed.state()?.phase));
const branchWrite = await resumed.fire("tool_call", { type: "tool_call", toolCallId: "r2", toolName: "edit", input: {} });
check("branch without a plan lets writes through", branchWrite[0] === undefined);

/* ═══ 4. create_plan without plan mode still closes the gate ═══ */

const stray = boot();
await stray.fire("session_start", { type: "session_start", reason: "startup" });
const strayPlan = await stray.call("create_plan", {
	title: "Stray plan",
	body: "Notes for a plan nobody asked to be in plan mode for.",
	steps: [{ label: "Do the thing", detail: "src/thing.ts" }],
});
check("stray create_plan enters review", stray.state()?.phase === "review", String(stray.state()?.phase));
check("stray create_plan leaves the catalog alone", stray.active.join(",") === catalog.join(","), stray.active.join(","));
check(
	"stray create_plan tells the user why",
	stray.notifications.some((entry) => /read-only until you approve/.test(entry.message)),
	JSON.stringify(stray.notifications),
);
const strayStopped = await stray.fire("tool_call", { type: "tool_call", toolCallId: "s1", toolName: "write", input: {} });
check(
	"review refuses a write with the approval wording",
	/review|approve|approval|waiting/i.test(String(strayStopped[0]?.reason ?? "")),
	String(strayStopped[0]?.reason ?? "").slice(0, 110),
);

/* the build opens the gate and carries the plan with it */
await stray.command("/plan build");
check("build leaves the catalog alone", stray.active.join(",") === catalog.join(","), stray.active.join(","));
const builtWrite = await stray.fire("tool_call", { type: "tool_call", toolCallId: "s2", toolName: "write", input: {} });
check("build lets writes through", builtWrite[0] === undefined);
check("build returns thinking to medium", stray.thinking === "medium", stray.thinking);
check("build enters executing", stray.state()?.phase === "executing");
const kickoff = stray.sent.filter((message) => message.customType === "plan-execution-context").at(-1);
check("kickoff is a custom message, not a user prompt", kickoff?.kind === "custom", String(kickoff?.kind));
check("no user-shaped build prompt in the transcript", !stray.sent.some((message) => message.kind === "user"));
check("kickoff triggers the turn", kickoff?.options?.triggerTurn === true);
check("kickoff carries the step detail", /src\/thing\.ts/.test(String(kickoff?.content ?? "")));
check("kickoff carries the plan path", String(kickoff?.content ?? "").includes(stray.state()?.path ?? "%%"));
check("kickoff carries the plan notes", /Notes for a plan nobody asked/.test(String(kickoff?.content ?? "")));
/* The build is a second task, and the window needs a seam to cut it on. The
 * boundary has to arrive ahead of the kickoff, carry the type the transcript
 * matches, and stay displayed — a hidden boundary would open the new task with
 * nothing in it. */
const boundaryIndex = stray.sent.findIndex((message) => message.customType === "plan-mode-build");
const kickoffIndex = stray.sent.lastIndexOf(kickoff);
const boundary = boundaryIndex >= 0 ? stray.sent[boundaryIndex] : undefined;
check("the build opens with a task boundary", boundary?.kind === "custom", String(boundary?.kind));
check("the boundary is displayed", boundary?.display === true, String(boundary?.display));
check("the boundary names the plan", /Building the plan.*Stray plan/.test(String(boundary?.content ?? "")), String(boundary?.content ?? "").slice(0, 80));
check("the boundary lands before the kickoff", boundaryIndex >= 0 && boundaryIndex < kickoffIndex, `${boundaryIndex} < ${kickoffIndex}`);
check("the boundary does not start the turn itself", boundary?.options?.triggerTurn !== true, JSON.stringify(boundary?.options));

/* ═══ 5. reminders leave the context with their phase ═══ */

const executing = await keptMessages(stray, [
	{ role: "custom", customType: "plan-mode-context", content: "[PLAN MODE — read only]" },
	{ role: "custom", customType: "plan-review-context", content: "[PLAN READY — waiting for the build]" },
	{ role: "custom", customType: "plan-execution-context", content: "[PLAN APPROVED — ...]" },
	{ role: "user", content: "[PLAN APPROVED — full tool access restored]\nExecute the approved plan." },
	{ role: "user", content: "and then what?" },
]);
check(
	"executing drops the earlier phases' reminders",
	executing.length === 3 &&
		executing[0].customType === "plan-execution-context" &&
		executing[2].content === "and then what?",
	JSON.stringify(executing.map((message) => message.customType ?? message.content)),
);

/* ═══ 6. progress: labels, failure, completion ═══ */

const progress = boot();
await progress.fire("session_start", { type: "session_start", reason: "startup" });
await progress.command("/plan");
await progress.call("create_plan", {
	title: "Progress run",
	steps: [
		{ label: "Add the refresh route", detail: "src/auth/refresh.ts" },
		{ label: "Cover it with a test", detail: "test/auth.test.ts" },
	],
});
await progress.command("/plan build");
const todoEvent = (items) => ({
	type: "tool_result",
	toolCallId: "todo-1",
	toolName: "todo_write",
	input: { items },
	content: [{ type: "text", text: "ok" }],
	isError: false,
});
await progress.fire("tool_result", todoEvent([{ label: "Add the refresh route.", status: "completed" }]));
let steps = progress.state()?.steps ?? [];
check(
	"todo label matches across punctuation",
	steps[0]?.status === "done",
	JSON.stringify(steps.map((step) => `${step.label}=${step.status}`)),
);
await progress.fire("tool_result", todoEvent([{ label: "COVER IT WITH A TEST", status: "in_progress" }]));
steps = progress.state()?.steps ?? [];
check("todo label matches across case", steps[1]?.status === "running", JSON.stringify(steps.map((s) => s.status)));
await progress.fire("tool_result", todoEvent([{ label: "Cover it with a test", status: "failed" }]));
steps = progress.state()?.steps ?? [];
check("todo failure is mirrored", steps[1]?.status === "failed", JSON.stringify(steps.map((s) => s.status)));

const stalledNotifications = progress.notifications.length;
await progress.fire("agent_end", { type: "agent_end", messages: [] });
check("a failed step keeps the plan open", progress.state()?.phase === "executing", String(progress.state()?.phase));
check(
	"a stalled build tells the user",
	progress.notifications.length > stalledNotifications &&
		/stalled/i.test(progress.notifications.at(-1)?.message ?? ""),
	JSON.stringify(progress.notifications.at(-1)),
);
check(
	"no completion message while a step failed",
	!progress.sent.some((message) => message.customType === "plan-mode-complete"),
);

/* the retry lands and the plan finishes itself */
await progress.fire("tool_result", todoEvent([{ label: "Cover it with a test", status: "completed" }]));
check("both steps done in state", (progress.state()?.steps ?? []).every((step) => step.status === "done"));
await progress.fire("agent_end", { type: "agent_end", messages: [] });
check("all done ends the plan", progress.state()?.phase === "off", String(progress.state()?.phase));
check(
	"completion is announced",
	progress.sent.some((message) => message.customType === "plan-mode-complete"),
);
const settled = await keptMessages(progress, [
	{ role: "user", content: "[PLAN APPROVED — full tool access restored]\nExecute the approved plan." },
	{ role: "custom", customType: "plan-execution-context", content: "[PLAN APPROVED — ...]" },
	{ role: "user", content: "thanks" },
]);
check(
	"finished plan leaves no reminder behind",
	settled.length === 1 && settled[0].content === "thanks",
	JSON.stringify(settled.map((message) => message.customType ?? message.content)),
);

/* ═══ 7. the thinking level plan mode raised is the one it lowers ═══ */

const thinkingCase = boot();
await thinkingCase.fire("session_start", { type: "session_start", reason: "startup" });
await thinkingCase.command("/plan");
thinkingCase.setThinking("high"); /* the user moves it while planning */
await thinkingCase.call("create_plan", { title: "Keep my level", steps: [{ label: "Ship it" }] });
await thinkingCase.command("/plan build");
check("a level the user moved during planning survives the build", thinkingCase.thinking === "high", thinkingCase.thinking);

const quietCase = boot();
await quietCase.fire("session_start", { type: "session_start", reason: "startup" });
await quietCase.command("/plan");
check("planning raised the level again", quietCase.thinking === "xhigh", quietCase.thinking);
await quietCase.call("create_plan", { title: "Lower me", steps: [{ label: "Ship it" }] });
await quietCase.command("/plan build");
check("an untouched level comes back down", quietCase.thinking === "medium", quietCase.thinking);

/* ═══ 8. a plan nothing can be written for is still a plan ═══ */

const blockedFile = join(workRoot, "not-a-directory");
writeFileSync(blockedFile, "this is a file, so mkdir under it fails\n");
const blockedDir = join(blockedFile, "plans");
const unwritable = boot({ cwd: blockedDir });
await unwritable.fire("session_start", { type: "session_start", reason: "startup" });
const env = {
	USERPROFILE: process.env.USERPROFILE,
	HOME: process.env.HOME,
	TEMP: process.env.TEMP,
	TMP: process.env.TMP,
	TMPDIR: process.env.TMPDIR,
};
try {
	/* every root the writer knows: the cwd, the agent dir, and the temp folder */
	process.env.USERPROFILE = blockedDir;
	process.env.HOME = blockedDir;
	process.env.TEMP = blockedDir;
	process.env.TMP = blockedDir;
	process.env.TMPDIR = blockedDir;
	const failed = await unwritable.call("create_plan", {
		title: "No file for me",
		body: "Kept in state.",
		steps: [{ label: "Survive anyway", detail: "src/survive.ts" }],
	});
	check("write failure is reported", /could not be written to disk/.test(unwritable.text(failed)), unwritable.text(failed).slice(0, 120));
	check("write failure does not claim a session record", !/recorded in the session/.test(unwritable.text(failed)));
	check("write failure still enters review", unwritable.state()?.phase === "review", String(unwritable.state()?.phase));
	check("write failure keeps the steps", unwritable.state()?.steps?.length === 1);
	check("write failure keeps the detail", unwritable.state()?.steps?.[0]?.detail === "src/survive.ts");
	check("write failure keeps the notes", unwritable.state()?.body === "Kept in state.");
	check("write failure leaves no path", !unwritable.state()?.path);
	const failedBuild = await unwritable.fire("tool_call", { type: "tool_call", toolCallId: "f1", toolName: "edit", input: {} });
	check("a plan without a file is still gated", failedBuild[0]?.block === true);
	await unwritable.command("/plan build");
	check("a plan without a file still builds", unwritable.state()?.phase === "executing");
	const unwritableEdit = await unwritable.fire("tool_call", { type: "tool_call", toolCallId: "f2", toolName: "edit", input: {} });
	check("build without a file lets writes through", unwritableEdit[0] === undefined);
} finally {
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

/* ═══ 9. refine keeps the plan, cancel clears it ═══ */

const refine = boot();
await refine.fire("session_start", { type: "session_start", reason: "startup" });
await refine.command("/plan");
await refine.call("create_plan", { title: "Refine me", steps: [{ label: "First cut" }] });
const refinedPath = refine.state()?.path;
await refine.command("/plan refine split step one in two");
check("refine returns to planning", refine.state()?.phase === "planning", String(refine.state()?.phase));
check("refine keeps the plan file", Boolean(refinedPath) && existsSync(refinedPath), String(refinedPath));
check("refine keeps the steps", refine.state()?.steps?.length === 1);
check("refine leaves the catalog alone", refine.active.join(",") === catalog.join(","), refine.active.join(","));
const refineWrite = await refine.fire("tool_call", { type: "tool_call", toolCallId: "f1", toolName: "edit", input: {} });
check("refine refuses writes again", refineWrite[0]?.block === true, String(refineWrite[0]?.reason ?? "").slice(0, 90));
check("refine queued a user-visible note", refine.sent.some((message) => message.kind === "user"), "");
await refine.command("/plan cancel");
check("cancel turns plan mode off", refine.state()?.phase === "off");
const cancelWrite = await refine.fire("tool_call", { type: "tool_call", toolCallId: "f2", toolName: "edit", input: {} });
check("cancel lets writes through", cancelWrite[0] === undefined);
check("cancel leaves the catalog alone", refine.active.join(",") === catalog.join(","), refine.active.join(","));
check("cancel clears the plan steps", (refine.state()?.steps ?? []).length === 0);

/* ═══ 10. the tool holds the line on empty input ═══ */

const empty = await session.call("create_plan", { title: "Nothing", steps: [] });
check("create_plan rejects an empty step list", empty?.isError === true, session.text(empty));

rmSync(workRoot, { recursive: true, force: true });

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (sandbox)`);
if (failed.length) {
	console.log(`failed: ${failed.map((entry) => entry.label).join(" | ")}`);
}
process.exit(failed.length ? 1 : 0);
