/**
 * agent-team ⇄ host integration — real SDK sessions, no model, no network.
 *
 * `agent-team-regression.mjs` pins the registry's delivery rules against
 * scripted sessions. This file drives the real thing: the shipped plugin, the
 * app's own sub-agent provisioning listener, the app's own tool factories, and
 * DefaultResourceLoader / AgentSession / createAgentSession / EventBus from
 * the SDK.
 *
 * What it is here to prove:
 *
 *  1. the bus handshake — the plugin asks `agent-team:configure-tools` once per
 *     spawn on the session's own bus, and the listener the app loads fills the
 *     request with the factories the app's main session runs;
 *  2. the sub-agent's tool surface — the same factories as the parent session
 *     and only those: no path plugin (the sandbox installs a fixture one that
 *     a parent-shaped loader does load) and no team tools (no nesting);
 *  3. session isolation — one loader, one extension runtime and one factory
 *     instance per sub-agent, so a second spawn cannot take over the first
 *     session's bound actions;
 *  4. the production session factory binds extensions, so every sub-agent
 *     session sees `session_start` exactly once;
 *  5. a host with no listener (the CLI) leaves sub-agents on the built-in
 *     tools alone.
 *
 * Sandbox: its own `PI_CODING_AGENT_DIR`, so the real agent dir is untouched
 * and no credential or model is read.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(root, "resources", "extensions", "agent-team");

/* ── the sandbox ───────────────────────────────────────── */

const sandbox = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "agent-team-integration-"));
const agentDir = join(sandbox, "agent");
const fixture = join(agentDir, "extensions", "path-fixture");
mkdirSync(fixture, { recursive: true });
/* A path plugin with no imports, so it loads from the sandbox exactly like the
   app's real plugins load from `~/.pi/agent/extensions/`. It stands in for
   agent-team itself: its tool is the marker of "this session loaded plugins
   from disk". */
writeFileSync(
	join(fixture, "index.ts"),
	`export default function pathFixture(pi) {
	pi.registerTool({
		name: "path_fixture_tool",
		label: "Path fixture",
		description: "Registered by a plugin loaded from the agent dir.",
		parameters: { type: "object", properties: {} },
		async execute() {
			return { content: [{ type: "text", text: "path fixture ran" }] };
		},
	});
}
`,
);
/* wakeOnCompletion is off so every result is collected by wait_agent, and the
   cap leaves room for the isolation case's two concurrent sub-agents */
writeFileSync(join(agentDir, "desktop.json"), JSON.stringify({ agents: { maxConcurrent: 4, wakeOnCompletion: false } }));
process.env.PI_CODING_AGENT_DIR = agentDir;

/* ── assertions ────────────────────────────────────────── */

const checks = [];
function check(label, ok, detail = "") {
	checks.push({ label, ok: Boolean(ok) });
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
function shorten(value, max = 140) {
	const line = String(value ?? "").replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max)}…` : line;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (predicate()) return true;
		if (Date.now() > deadline) return false;
		await sleep(10);
	}
}

/* ── the pieces under test, loaded the way the app loads them ── */

const jiti = createJiti(import.meta.url);
const startTeam = await jiti.import(join(EXTENSION, "index.ts"), { default: true });
const { registerSubagentTools } = await jiti.import(join(root, "src", "main", "subagent-tools-extension.ts"));
const { registerWebTools } = await jiti.import(join(root, "src", "main", "web", "extension.ts"));
const { registerAgentTools } = await jiti.import(join(root, "src", "main", "agent-tools", "extension.ts"));
const sdk = await import("@earendil-works/pi-coding-agent");

/* what pi-host.ts hands to the loader and to the provisioning listener */
const SESSION_TOOLS = [
	{ name: "pi-desktop-web", factory: registerWebTools },
	{ name: "pi-desktop-agent-tools", factory: registerAgentTools },
];
/* the two strings that cross the plugin boundary — the app side is
   `src/main/subagent-tools-extension.ts` */
const BUS_CONFIGURE_TOOLS = "agent-team:configure-tools";
const TEAM_TOOLS = ["spawn_agent", "wait_agent", "list_agents", "interrupt_agent"];
const BUILT_IN_TOOLS = ["read", "bash", "edit", "write"];

/** The app's bus, for the one case that has no session of its own. */
function makeBus() {
	const channels = new Map();
	return {
		emit(channel, data) {
			for (const handler of [...(channels.get(channel) ?? [])]) handler(data);
		},
		on(channel, handler) {
			const list = channels.get(channel) ?? [];
			list.push(handler);
			channels.set(channel, list);
			return () => {
				const index = list.indexOf(handler);
				if (index >= 0) list.splice(index, 1);
			};
		},
	};
}

/**
 * A main session, loaded the way `pi-host.ts` loads one: path plugins allowed,
 * the app's factories inline, and the provisioning listener among them. The
 * `factories` array is the answer that listener gives, so a caller that mutates
 * it between spawns is changing the host's answer.
 */
async function mainSession(factories = SESSION_TOOLS) {
	const captured = { bus: null };
	const loader = new sdk.DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: [
			...SESSION_TOOLS,
			{
				name: "pi-desktop-subagent-tools",
				factory: (pi) => {
					captured.bus = pi.events;
					registerSubagentTools(pi, factories);
				},
			},
		],
	});
	await loader.reload();
	const session = (
		await sdk.createAgentSession({
			cwd: process.cwd(),
			agentDir,
			sessionManager: sdk.SessionManager.inMemory(process.cwd()),
			resourceLoader: loader,
		})
	).session;
	return { loader, session, bus: captured.bus };
}

/** A parent session's ExtensionAPI stub — just the surface the plugin touches. */
function makeParent(bus) {
	const tools = new Map();
	const handlers = new Map();
	const sent = [];
	const pi = {
		on: (event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: (tool) => tools.set(tool.name, tool),
		getAllTools: () => [...tools.keys()].map((name) => ({ name })),
		events: bus,
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
	return {
		pi,
		tools,
		sent,
		text: (result) => result?.content?.map((block) => block.text ?? "").join("\n") ?? "",
		callTool: (name, params, signal) =>
			tools.get(name).execute(`call-${Math.random().toString(36).slice(2, 8)}`, params, signal, undefined, ctx),
	};
}

/**
 * A session factory that builds the real thing and hands it back, so the tests
 * can inspect what the registry configured. It mirrors the production factory
 * except that it does not bind extensions — which is what case 4 checks the
 * production factory for.
 */
function makeProbe() {
	const loaders = [];
	const sessions = [];
	return {
		loaders,
		sessions,
		async createSession(options) {
			loaders.push(options.resourceLoader);
			const { session } = await sdk.createAgentSession({
				cwd: options.cwd,
				agentDir: options.agentDir,
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				sessionManager: sdk.SessionManager.inMemory(options.cwd),
				resourceLoader: options.resourceLoader,
			});
			sessions.push(session);
			return { session };
		},
	};
}

/** The agent-team plugin, hosted by one parent session on one bus. */
function makeTeam(bus, options = {}) {
	const parent = makeParent(bus);
	startTeam(parent.pi, options);
	return parent;
}

const spawn = (team, taskName, message = `task for ${taskName}`) =>
	team.callTool("spawn_agent", { message, task_name: taskName });

const names = (session) => session.getAllTools().map((tool) => tool.name);
const loaderPaths = (loader) => loader?.getExtensions().extensions.map((extension) => extension.path) ?? [];
/** Both separators, because the loader resolves plugin paths for the host OS. */
const isFixture = (path) => path.replace(/\\/g, "/").endsWith("path-fixture/index.ts");
const tail = (path) => path.replace(/\\/g, "/").split("/").slice(-2).join("/");

/* ── 1. the handshake, and what it puts in the sub-agent ── */

console.log("\n# the host's answer reaches the sub-agent");
const probe = makeProbe();
{
	const host = await mainSession();
	let asks = 0;
	host.bus.on(BUS_CONFIGURE_TOOLS, () => {
		asks += 1;
	});
	const team = makeTeam(host.bus, { createSession: probe.createSession });

	const parentPaths = loaderPaths(host.loader);
	check(
		"the main session loads the provisioning listener with the app's factories",
		parentPaths.includes("<inline:pi-desktop-web>") &&
			parentPaths.includes("<inline:pi-desktop-agent-tools>") &&
			parentPaths.includes("<inline:pi-desktop-subagent-tools>"),
		parentPaths.map(tail).join(","),
	);
	const parentTools = names(host.session);
	check(
		"the fixture path plugin is what a parent-shaped loader loads",
		parentPaths.some(isFixture) && parentTools.includes("path_fixture_tool"),
		parentPaths.map(tail).join(","),
	);

	const spawned = await spawn(team, "solo_case");
	check("spawn_agent accepted", !spawned?.isError, shorten(team.text(spawned)));
	check("the plugin has the team tools the sub-agent must not get", TEAM_TOOLS.every((name) => team.tools.has(name)));
	check("the host is asked exactly once per spawn", asks === 1, `${asks} ask(s)`);

	const loader = probe.loaders[0];
	const paths = loaderPaths(loader);
	check(
		"the sub-agent's loader holds the host's two factories, by name",
		paths.join(",") === "<inline:pi-desktop-web>,<inline:pi-desktop-agent-tools>",
		paths.join(",") || "none",
	);
	check("the sub-agent's loader loads no path plugin", !paths.some(isFixture), paths.join(",") || "none");
	check(
		"the sub-agent's system prompt carries the sub-agent role",
		(loader?.getAppendSystemPrompt() ?? []).some((text) => text.includes("[AGENT TEAM — sub-agent]")),
		shorten((loader?.getAppendSystemPrompt() ?? []).join(" "), 80),
	);

	const session = probe.sessions[0];
	if (!session) {
		check("the sub-agent's tool surface", false, "no session was created");
	} else {
		const subTools = names(session);
		check(
			"the sub-agent's tools are the parent's tools, minus everything from disk",
			subTools.includes("web_search") &&
				subTools.includes("web_fetch") &&
				parentTools.filter((name) => !subTools.includes(name)).join(",") === "path_fixture_tool",
			`sub-agent: ${subTools.join(",")}`,
		);
		check(
			"the sub-agent has none of the team tools (no nesting)",
			TEAM_TOOLS.every((name) => !subTools.includes(name)),
			subTools.filter((name) => TEAM_TOOLS.includes(name)).join(",") || "none",
		);
		const source = session.getAllTools().find((tool) => tool.name === "web_search")?.sourceInfo?.path;
		check("an inherited tool still names the host's factory as its source", source === "<inline:pi-desktop-web>", String(source));
		const bashSource = session.getAllTools().find((tool) => tool.name === "bash")?.sourceInfo?.path;
		check(
			"the app's own built-in overrides are the ones that run in the sub-agent",
			bashSource === "<inline:pi-desktop-agent-tools>",
			String(bashSource),
		);
	}
	host.session.dispose();
}

/* ── 2. isolation: one loader, one runtime, one factory instance ── */

console.log("\n# two sub-agents never share a session's state");
const isolation = makeProbe();
{
	const extra = {
		name: "pi-desktop-extra",
		factory: (pi) => {
			pi.registerTool({
				name: "extra_probe_tool",
				label: "Extra probe",
				description: "Only the second sub-agent's factory list registers this.",
				parameters: { type: "object", properties: {} },
				async execute() {
					return { content: [{ type: "text", text: "extra" }] };
				},
			});
		},
	};
	/* one listener, consulting its list per request — the app's shape */
	const hostFactories = [...SESSION_TOOLS];
	const host = await mainSession(hostFactories);
	let asks = 0;
	host.bus.on(BUS_CONFIGURE_TOOLS, () => {
		asks += 1;
	});
	const team = makeTeam(host.bus, { createSession: isolation.createSession });

	await spawn(team, "first_case");
	const first = isolation.loaders[0];
	const firstTools = isolation.sessions[0] ? names(isolation.sessions[0]) : [];

	/* the host's answer changes between spawns */
	hostFactories.push(extra);
	await spawn(team, "second_case");
	const second = isolation.loaders[1];
	const secondTools = isolation.sessions[1] ? names(isolation.sessions[1]) : [];

	check("each spawn gets its own loader", Boolean(first) && Boolean(second) && first !== second);
	check("the sub-agents' loaders are not the parent session's loader", first !== host.loader && second !== host.loader);
	check("each loader has its own extension runtime", first?.getExtensions().runtime !== second?.getExtensions().runtime);
	check(
		"each loader has its own factory instances",
		first?.getExtensions().extensions[0] !== second?.getExtensions().extensions[0],
	);
	check("the host's changed answer reached the second spawn", secondTools.includes("extra_probe_tool"), secondTools.join(","));
	check(
		"the first session keeps its own tool registry",
		!firstTools.includes("extra_probe_tool") && firstTools.includes("web_search"),
		firstTools.join(","),
	);
	check("the host is asked once per spawn, both times", asks === 2, `${asks} ask(s)`);
	host.session.dispose();
}

/* ── 3. a host with no listener (the CLI) ──────────────── */

console.log("\n# no host on the bus");
const bare = makeProbe();
{
	const team = makeTeam(makeBus(), { createSession: bare.createSession });
	await spawn(team, "cli_case");
	check(
		"with no host answer the loader holds no extensions",
		loaderPaths(bare.loaders[0]).length === 0,
		loaderPaths(bare.loaders[0]).join(",") || "none",
	);
	const tools = bare.sessions[0] ? names(bare.sessions[0]) : [];
	check(
		"and the session runs on the built-in tools",
		BUILT_IN_TOOLS.every((name) => tools.includes(name)) &&
			!tools.includes("web_search") &&
			!tools.includes("path_fixture_tool"),
		tools.join(","),
	);
}

/* ── 4. the production factory drives and binds a real session ── */

console.log("\n# the production session factory");
{
	const started = [];
	const watched = {
		name: "pi-desktop-watch",
		factory: (pi) => {
			const record = { pi, starts: 0 };
			started.push(record);
			pi.on("session_start", async () => {
				record.starts += 1;
			});
		},
	};
	const host = await mainSession([...SESSION_TOOLS, watched]);
	/* no createSession override: the registry runs the SDK path the app runs */
	const team = makeTeam(host.bus);

	const spawned = await spawn(team, "real_one");
	check("spawn_agent accepted on the real path", !spawned?.isError, shorten(team.text(spawned)));
	await until(() => started.length === 1);
	check("the real SDK session loaded the host's factories", started.length === 1, `${started.length} factory instance(s)`);
	check(
		"bindExtensions ran for the sub-agent session",
		started[0]?.starts === 1,
		`session_start fired ${started[0]?.starts ?? 0} time(s)`,
	);
	const bound = started[0]?.pi.getAllTools?.().map((tool) => tool.name) ?? [];
	check(
		"the bound session exposes the inherited tools and no team tools",
		bound.includes("web_search") && TEAM_TOOLS.every((name) => !bound.includes(name)),
		bound.join(","),
	);

	/* the sandbox has no model, so the run itself settles as errored — which is
	   a full pass through spawn → run → settle → wait delivery on the real path */
	const waited = await team.callTool("wait_agent", { timeout_ms: 15_000 });
	check(
		"the real session's run settles and is delivered",
		/real_one (errored|completed)/.test(team.text(waited)),
		shorten(team.text(waited)),
	);
	check(
		"the session's tools are unchanged by the settled run",
		(started[0]?.pi.getAllTools?.().map((tool) => tool.name) ?? []).includes("web_search"),
	);
	host.session.dispose();
}

/* ── done ──────────────────────────────────────────────── */

rmSync(sandbox, { recursive: true, force: true });
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (host integration)`);
process.exit(failed.length ? 1 : 0);
