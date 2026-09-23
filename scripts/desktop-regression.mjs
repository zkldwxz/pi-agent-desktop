// Run with: npx electron scripts/desktop-regression.mjs
// Real SDK + Electron host lifecycle; no provider calls and no real user config.
import { app } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = await mkdtemp(join(tmpdir(), "desktop-regression-"));
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
const cwd = join(sandbox, "project");
await mkdir(cwd, { recursive: true });
await cp(join(root, "resources/extensions/plan-mode"), join(sandbox, "agent/extensions/plan-mode"), { recursive: true });
await cp(join(root, "resources/extensions/agent-team"), join(sandbox, "agent/extensions/agent-team"), { recursive: true });
const jiti = createJiti(import.meta.url, { nativeModules: ["electron"], alias: { electron: "electron/main" } });
let host;
let count = 0;
function check(label, fn) { fn(); count++; console.log(`PASS ${label}`); }
try {
  const { PiHost } = await jiti.import(join(root, "src/main/pi-host.ts"));
  const { writeConfig, readConfig } = await jiti.import(join(root, "src/main/install.ts"));
  await writeConfig({ capabilities: { browser: false, todos: true }, onboardingDone: true });
  await Promise.all([
    writeConfig({ terminal: { preferred: "cmd" } }),
    writeConfig({ ultra: { "test/model": { mode: "coexist", picked: true } } }),
    writeConfig({ agents: { maxConcurrent: 2, wakeOnCompletion: false } }),
  ]);
  const config = await readConfig();
  check("concurrent config updates preserve unrelated fields", () => {
    assert.equal(config.terminal.preferred, "cmd");
    assert.equal(config.ultra["test/model"].picked, true);
    assert.equal(config.agents.maxConcurrent, 2);
  });
  host = new PiHost(cwd);
  await host.start();
  check("real SDK loaded plan and team extensions", () => {
    assert(host.toolNames().includes("create_plan"));
    assert(host.toolNames().includes("spawn_agent"));
    assert(host.toolNames().includes("web_search"));
    assert(host.toolNames().includes("web_fetch"));
    assert(host.toolNames().includes("grep"));
    assert(host.runtime.session.getActiveToolNames().includes("web_search"));
    assert(host.runtime.session.getActiveToolNames().includes("web_fetch"));
    assert(host.snapshot().commands.some((item) => item.name === "plan"));
  });
  check("team interrupt bus survives session binding", () => assert(host.teamBus));
  let interrupts = 0;
  const originalEmit = host.teamBus.emit;
  host.teamBus.emit = (channel, data) => {
    if (channel === "agent-team:interrupt-all") interrupts++;
    return originalEmit(channel, data);
  };
  await host.abort();
  check("stop reaches fleet", () => assert.equal(interrupts, 1));
  const catalog = host.runtime.session.getActiveToolNames().slice().sort().join(",");
  await host.planAction({ action: "toggle" });
  check("PlanMode enters planning without touching the tool catalog", () => {
    assert.equal(host.snapshot().plan.phase, "planning");
    assert.equal(host.runtime.session.getActiveToolNames().slice().sort().join(","), catalog);
    assert(host.toolNames().includes("write"));
  });
  const session = host.runtime.session;
  const bus = host.teamBus;
  /* the head of every request — the system prompt and the tool schemas — has to
   * survive a plan phase, or the provider re-reads the whole conversation */
  const headBefore = { prompt: session.systemPrompt, tools: session.getAllTools().map((tool) => `${tool.name}:${tool.description}`) };
  check("the agent-tools extension owns bash/read/grep in a real session", () => {
    const bash = session.getAllTools().find((tool) => tool.name === "bash");
    const read = session.getAllTools().find((tool) => tool.name === "read");
    const grep = session.getAllTools().find((tool) => tool.name === "grep");
    assert.match(bash.description, /cleaned of colour/);
    assert.match(read.description, /truncated to 24KB/);
    assert.match(grep.description, /truncated to 100 matches or 16KB/);
  });
  await host.updateSettings({ terminal: { preferred: "auto" } });
  check("terminal preferences do not reload active extensions", () => {
    assert.equal(host.runtime.session, session);
    assert.equal(host.teamBus, bus);
    assert.equal(host.snapshot().plan.phase, "planning");
  });
  await host.reload();
  check("reload restores plan gating with the same catalog", () => {
    assert.equal(host.snapshot().plan.phase, "planning");
    assert.equal(host.runtime.session.getActiveToolNames().slice().sort().join(","), catalog);
  });
  await host.planAction({ action: "cancel" });
  check("cancel reopens the gate and leaves the catalog alone", () => {
    assert.equal(host.snapshot().plan.phase, "off");
    assert.equal(host.runtime.session.getActiveToolNames().slice().sort().join(","), catalog);
    assert(host.toolNames().includes("write"));
  });
  check("plan mode left the requests' cached head byte-stable", () => {
    assert.equal(host.runtime.session.systemPrompt, headBefore.prompt);
    assert.deepEqual(
      host.runtime.session.getAllTools().map((tool) => `${tool.name}:${tool.description}`),
      headBefore.tools,
    );
  });
  await host.newSession();
  check("new session retains working fleet bus and clears plan", () => {
    assert(host.teamBus);
    assert.equal(host.snapshot().plan.phase, "off");
  });
  await assert.rejects(host.planAction({ action: "build", model: { provider: "missing", id: "missing" } }), /No plan/);
  count++; console.log("PASS invalid build is rejected before model change");

  const { discoverTerminalShells } = await jiti.import(join(root, "src/main/shells.ts"));
  const started = Date.now();
  const pendingShells = discoverTerminalShells();
  check("shell discovery returns asynchronously", () => assert(pendingShells instanceof Promise));
  const shells = await pendingShells;
  check("shell discovery returns usable entries", () => assert(shells.some((shell) => shell.available)));
  console.log(`INFO shell discovery: ${Date.now() - started}ms; ${shells.map((shell) => shell.name).join(", ")}`);
  const { PtyHost } = await jiti.import(join(root, "src/main/pty.ts"));
  let terminalExited;
  const exitPromise = new Promise((resolve) => { terminalExited = resolve; });
  const terminals = new PtyHost(() => {}, () => terminalExited());
  const shell = shells.find((item) => item.kind === "cmd") ?? shells[0];
  const terminal = terminals.spawn(cwd, shell);
  try {
    check("real PTY starts and can be listed by workspace", () => {
      assert(!("error" in terminal), terminal.error);
      assert.equal(terminals.list(cwd)[0]?.id, terminal.id);
    });
    terminals.write(terminal.id, "exit\r");
    await exitPromise;
  } finally { terminals.dispose(); }
  const { registerUltraPolicy } = await jiti.import(join(root, "src/main/ultra-extension.ts"));
  let beforeStart;
  let ultra = true;
  let active = ["spawn_agent"];
  registerUltraPolicy({ on: (_name, fn) => { beforeStart = fn; }, getActiveTools: () => active }, {
    isUltra: () => ultra, maxAgents: () => 2,
  });
  const granted = await beforeStart({ systemPrompt: "base" });
  check("Ultra grant injected with active delegation tools", () => assert(granted.systemPrompt.includes("2 sub-agent slots")));
  ultra = false;
  assert.equal(await beforeStart({ systemPrompt: "base" }), undefined);
  ultra = true; active = [];
  assert.equal(await beforeStart({ systemPrompt: "base" }), undefined);
  count++; console.log("PASS Ultra revoked when disabled or delegation tools inactive");
  console.log(`${count} desktop regression checks passed (offline)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await host?.dispose();
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(console.error);
  app.exit(process.exitCode || 0);
}
