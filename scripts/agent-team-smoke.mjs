/**
 * agent-team smoke test — drives the real plugin headless, no desktop needed.
 *
 * Two modes:
 *
 *   node scripts/agent-team-smoke.mjs          sandbox (offline, no provider):
 *       jiti-loads the extension, registers the tools against a stub pi,
 *       checks task_name validation, slot rejection (maxConcurrent: 1 from a
 *       sandbox desktop.json), a spawn→errored settle (no model configured in
 *       the sandbox, which is itself a settle path), and interrupt's
 *       not-found / not-running branches.
 *
 *   node scripts/agent-team-smoke.mjs --live   real agent dir (uses whatever
 *       model/auth pi has configured; costs one tiny prompt):
 *       spawn→wait→completed, and spawn→interrupt→settled.
 *
 * The point is the machinery, verified against the same files the app ships:
 * jiti resolution, tool registration, the registry's delivery protocol, and
 * real AgentSession lifecycle.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");
const PLAN = { name: "", steps: [], updatedAt: 0 };

/* ── the sandbox: its own agent dir, so the real one is untouched ── */
let sandbox = null;
if (!live) {
  sandbox = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "agent-team-smoke-"));
  const agentDir = join(sandbox, "agent");
  mkdirSync(agentDir, { recursive: true });
  /* maxConcurrent: 1 is what the slot-rejection step depends on */
  writeFileSync(join(agentDir, "desktop.json"), JSON.stringify({ agents: { maxConcurrent: 1, wakeOnCompletion: false } }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
}
/* live mode runs against the user's real agent dir: the real maxConcurrent
   applies (not the sandbox's 1), so the slot check is skipped there */

/* ── a stub ExtensionAPI: just the surface index.ts touches ── */
const tools = new Map();
const events = { emit: () => {}, on: () => () => {} };
/* the wake channel: a real runtime queues these into the parent's context;
   the stub records them so the test can assert the delivery happened */
const sentMessages = [];
const stubPi = {
  on: () => {},
  registerTool: (tool) => tools.set(tool.name, tool),
  getAllTools: () => [...tools.keys()].map((name) => ({ name })),
  events,
  sendMessage: (message) => sentMessages.push(message),
  getCommands: () => [],
};
const stubCtx = {
  cwd: process.cwd(),
  model: undefined,
  thinkingLevel: undefined,
  isIdle: () => true,
  signal: undefined,
  mode: "print",
  hasUI: false,
};

const call = async (name, params) => tools.get(name)?.execute(`call-${Math.random().toString(36).slice(2, 8)}`, params, undefined, undefined, stubCtx);
const text = (result) => result?.content?.map((block) => block.text ?? "").join("\n") ?? "";

const checks = [];
const check = (label, ok, detail = "") => {
  checks.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ── load the plugin exactly the way pi would ── */
const jiti = createJiti(import.meta.url);
const mod = await jiti.import(join(root, "resources", "extensions", "agent-team", "index.ts"), { default: true });
mod(stubPi);

for (const name of ["spawn_agent", "wait_agent", "list_agents", "interrupt_agent"]) {
  check(`tool registered: ${name}`, tools.has(name));
}

/* task_name validation — Codex's lowercase/digits/underscores rule */
const bad = await call("spawn_agent", { message: "do something", task_name: "Bad-Name" });
check("task_name rejected", Boolean(bad?.isError), text(bad).slice(0, 80));

/* happy spawn — in the sandbox this settles as errored (no model), which is
   still a full pass through spawn → run → settle → wait delivery */
const spawned = await call("spawn_agent", {
  message: "Reply with the single word: ok. Do nothing else.",
  task_name: "smoke_one",
});
check("spawn accepted", !spawned?.isError, text(spawned).slice(0, 100));

/* slot rejection — the sandbox config allows exactly one */
if (!live) {
  const second = await call("spawn_agent", { message: "another task", task_name: "smoke_two" });
  check("slot rejection", Boolean(second?.isError) && /slot/i.test(text(second)), text(second).slice(0, 90));
}

/* wait collects the settle — in live mode the wake channel is the other
   lawful delivery (the user's real config defaults wakeOnCompletion: true,
   which consumes the record before wait sees it) */
const waited = await call("wait_agent", { timeout_ms: 20_000 });
const waitedText = text(waited);
const woken = sentMessages.find((message) => /smoke_one/.test(String(message?.content ?? "")));
if (live) {
  check(
    "settle delivered (wait or wake)",
    !waited?.isError && (/smoke_one (completed|errored)/.test(waitedText) || woken),
    woken ? `wake: ${String(woken.content).slice(0, 100)}` : waitedText.slice(0, 120),
  );
  check("answer contains ok", /ok/i.test(waitedText) || /ok/i.test(String(woken?.content ?? "")), "");
} else {
  check(
    "wait delivered a settle",
    !waited?.isError && /smoke_one (completed|errored)/.test(waitedText),
    waitedText.slice(0, 120),
  );
}

/* list shows the record */
const listed = await call("list_agents", {});
check("list shows smoke_one", /smoke_one/.test(text(listed)), text(listed).slice(0, 160));
if (live) {
  check(
    "wake delivered or list shows completion",
    Boolean(woken) || /smoke_one: (completed|errored)/.test(text(listed)),
    text(listed).slice(0, 160),
  );
}

/* interrupt branches */
const missing = await call("interrupt_agent", { target: "no_such_agent" });
check("interrupt not-found errors", Boolean(missing?.isError));
const settled = await call("interrupt_agent", { target: "smoke_one" });
check("interrupt on settled reports status", !settled?.isError && /already/.test(text(settled)), text(settled).slice(0, 80));

/* live interrupt path: a slow task, interrupted mid-run */
if (live) {
  await call("spawn_agent", {
    message: "Write the numbers 1 through 300, one per line. Take your time; do not summarize.",
    task_name: "smoke_slow",
  });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const interrupted = await call("interrupt_agent", { target: "smoke_slow" });
  check("interrupt accepted", !interrupted?.isError, text(interrupted).slice(0, 80));
  /* the settle may arrive as a wait result or as a wake message — both are
     lawful deliveries under the user's real config */
  const after = await call("wait_agent", { timeout_ms: 20_000 });
  const slowWoken = sentMessages.find((message) => /smoke_slow/.test(String(message?.content ?? "")));
  check(
    "interrupted agent settled",
    /smoke_slow (interrupted|completed|errored)/.test(text(after)) || Boolean(slowWoken),
    slowWoken ? `wake: ${String(slowWoken.content).slice(0, 100)}` : text(after).slice(0, 120),
  );
  const finalList = await call("list_agents", {});
  check(
    "interrupted status visible in list",
    /smoke_slow: (interrupted|completed|errored)/.test(text(finalList)),
    text(finalList).slice(0, 200),
  );
}

if (sandbox) rmSync(sandbox, { recursive: true, force: true });

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${live ? " (live)" : " (sandbox)"}`);
process.exit(failed.length ? 1 : 0);
