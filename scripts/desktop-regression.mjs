// Run with: npx electron scripts/desktop-regression.mjs
// Real SDK + Electron host lifecycle; no provider calls and no real user config.
import { app } from "electron";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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

  /* The update channel is the hottest path in the shell — it fires on every host
   * event and the transcript is the largest thing riding on it — so the delta
   * protocol is checked here rather than eyeballed in a dev log. Placed before
   * the PTY section, which cannot run where Electron has no controlling terminal. */
  const updates = [];
  host.onChange((payload) => updates.push(payload));
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  /* `emit()` coalesces — a call landing inside the 16ms window of one already
     scheduled is dropped — so "I called emit, therefore the next update is mine"
     is simply false on a host that also emits for background work. Wait for
     quiet, then emit and read back the update that actually arrives. Without
     this the assertion runs against some unrelated event and passes or fails
     depending on scheduling, which is exactly how it flaked twice. */
  const quiesce = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const seen = updates.length;
      await sleep(50);
      if (updates.length === seen) return;
    }
  };
  const emitAndCapture = async () => {
    await quiesce();
    const before = updates.length;
    host.emit();
    for (let attempt = 0; attempt < 40 && updates.length === before; attempt += 1) await sleep(20);
    return updates.at(-1);
  };
  const live = host.runtime.session;
  const streaming = {
    role: "assistant",
    content: [{ type: "text", text: "delta probe" }],
    timestamp: new Date().toISOString(),
  };

  check("getState answers with a whole transcript, never a delta", () => {
    assert(Array.isArray(host.messages()));
  });

  const previousStream = live.state.streamingMessage;
  live.state.streamingMessage = streaming;
  const tick = await emitAndCapture();
  check("a streaming tick sends only the message that moved", () => {
    assert.equal(tick.messages, undefined, "the settled prefix must not be re-sent");
    assert.equal(tick.tail.messages.length, 1);
    assert.equal(tick.tail.at, host.messages().length - 1);
    assert.match(JSON.stringify(tick.tail.messages[0]), /delta probe/);
  });

  live.state.streamingMessage = previousStream;
  live.messages.push(streaming);
  const replaced = await emitAndCapture();
  check("a finished turn replaces the transcript once, in full", () => {
    assert(Array.isArray(replaced.messages), "expected a full message list");
    assert.equal(replaced.tail, undefined);
    assert.equal(replaced.messages.at(-1).role, "assistant");
  });

  const quiet = await emitAndCapture();
  check("the settled transcript is not re-sent after a full replacement", () => {
    assert.equal(quiet.messages, undefined);
    assert.equal(quiet.tail, undefined);
  });

  /* A run command must appear once. The activity table used to keep finished
   * entries after the turn settled, and the next streaming turn swept them up
   * as fresh rows — the ghost `ls -la` the user reported in new messages. */
  const { buildTurns, buildToolRun, groupRuns, liveStatusLabel, toolDetailLines } = await jiti.import(
    join(root, "src/renderer/src/lib/agent-view.ts"),
  );
  const chatMessage = (role, text, extra = {}) => ({
    key: `${role}-${Math.random().toString(36).slice(2)}`,
    role,
    timestamp: Date.now(),
    text,
    blocks: [],
    ...extra,
  });
  const ghostTurns = buildTurns(
    [
      chatMessage("user", "list the folder"),
      chatMessage("assistant", "", {
        blocks: [{ type: "toolCall", id: "ghost-1", name: "bash", arguments: { command: "ls -la" } }],
      }),
      chatMessage("toolResult", "total 0", { toolName: "bash", toolCallId: "ghost-1" }),
      chatMessage("user", "a follow-up question"),
    ],
    [{ toolCallId: "ghost-1", toolName: "bash", args: { command: "ls -la" }, status: "done", resultText: "total 0", startedAt: Date.now() }],
  );
  check("a settled tool call does not leak into the next turn", () => {
    assert.equal(ghostTurns.length, 2);
    assert.equal(ghostTurns[1].toolRuns.length, 0, "the stale activity must not re-attach");
    assert.equal(ghostTurns[0].toolRuns.length, 1);
  });

  /* A live call used to append a generic `running…` child row under a row that
   * already said what it was doing — the verb, the spinner and the command chip
   * are the status. What must survive is the settled outcome, or opening a call
   * that produced no output presents an empty box. */
  const liveBash = buildToolRun("bash", { command: "npm run typecheck" }, undefined, undefined, "running", "run-1");
  check("a live call reads as its own command", () => {
    assert.equal(liveBash.status, "running");
    assert.match(liveBash.chip, /npm run typecheck/);
  });
  check("a live call with no output has no child row to show", () => {
    assert.deepEqual(toolDetailLines(liveBash), []);
  });
  check("a settled call with no output still carries its outcome", () => {
    assert.equal(toolDetailLines({ ...liveBash, status: "done" }).length, 1);
    assert.equal(toolDetailLines({ ...liveBash, status: "error" }).length, 1);
  });
  check("a long command is truncated, not spilled into the row", () => {
    const long = buildToolRun("bash", { command: `echo ${"x".repeat(300)}` }, undefined, undefined, "running", "run-2");
    assert.ok(long.chip.length <= 64, `chip was ${long.chip.length} chars`);
  });
  check("a live command group names the call it is on", () => {
    const groups = groupRuns([
      buildToolRun("bash", { command: "npm test" }, "ok", undefined, "done", "g-1"),
      buildToolRun("bash", { command: "npm run typecheck" }, undefined, undefined, "running", "g-2"),
    ]);
    assert.equal(groups.length, 1, "consecutive commands stay one group");
    assert.equal(groups[0].commands, 2);
    assert.equal(groups[0].running, true);
    assert.match(groups[0].label, /npm run typecheck/);
    assert.doesNotMatch(groups[0].label, /running/i);
  });
  check("a settled command group falls back to its tally", () => {
    const groups = groupRuns([
      buildToolRun("bash", { command: "npm test" }, "ok", undefined, "done", "g-1"),
      buildToolRun("bash", { command: "npm run typecheck" }, "ok", undefined, "done", "g-2"),
    ]);
    assert.equal(groups[0].running, false);
    assert.equal(groups[0].commands, 2);
    assert.match(groups[0].label, /2/);
    assert.doesNotMatch(groups[0].label, /npm run/);
  });

  /* The working line under a turn covers one thing only: the pause after a
   * result lands and before the model speaks again. It used to name the running
   * tool too, which printed the command a second time directly under the row
   * that already showed it. */
  const toolTurn = (runs, streaming = true) => ({
    key: "t",
    userIndex: 0,
    timestamp: 0,
    fullText: "",
    toolRuns: runs,
    items: [{ kind: "tools", key: "i", runs, at: 0 }],
    lead: "",
    endedAt: 0,
    sources: [],
    followUps: [],
    streaming,
    notes: [],
  });
  check("a running tool is not repeated by the working line", () => {
    assert.equal(liveStatusLabel(toolTurn([liveBash]), true), null);
  });
  check("the pause after a result still says the model is working", () => {
    const settled = { ...liveBash, status: "done" };
    assert.equal(typeof liveStatusLabel(toolTurn([settled]), true), "string");
  });
  check("a settled turn shows no working line at all", () => {
    assert.equal(liveStatusLabel(toolTurn([liveBash], false), false), null);
  });
  /* Plan mode plans in one task and builds in the next. The build carries no
   * user prompt — approving a plan is a button, not a sentence — so the seam is
   * the custom message the extension sends, and the transcript has to cut the
   * task there. Before this, the whole build landed inside the planning turn:
   * one card holding both the research and the work. */
  const planBuildTurns = buildTurns(
    [
      chatMessage("user", "research this, then tell me what to change"),
      chatMessage("assistant", "", {
        blocks: [{ type: "toolCall", id: "plan-1", name: "create_plan", arguments: { title: "Switch the endpoint" } }],
      }),
      chatMessage("toolResult", "Plan written.", { toolName: "create_plan", toolCallId: "plan-1" }),
      chatMessage("custom", "**Building the plan — Switch the endpoint** (1 steps)", {
        customType: "plan-mode-build",
      }),
      chatMessage("assistant", "", {
        blocks: [{ type: "toolCall", id: "build-1", name: "edit", arguments: { file_path: "src/config.ts" } }],
      }),
      chatMessage("toolResult", "ok", { toolName: "edit", toolCallId: "build-1" }),
    ],
    [],
  );
  check("the build is a task of its own, not more of the plan's turn", () => {
    assert.equal(planBuildTurns.length, 2, `expected 2 tasks, got ${planBuildTurns.length}`);
    assert.equal(planBuildTurns[0].toolRuns.length, 1, "the plan's turn keeps the planning call");
    assert.equal(planBuildTurns[1].toolRuns.length, 1, "the build's turn carries the build's call");
  });
  check("the build's task opens with the boundary, not a prompt", () => {
    assert.match(planBuildTurns[1].boundary ?? "", /Building the plan/);
    assert.equal(planBuildTurns[1].prompt, undefined, "a boundary must not pose as a user prompt");
  });
  check("the boundary does not shift fork addresses", () => {
    /* it is not a prompt, so the prompt index space the transcript addresses for
     * fork/rewind has to read exactly as it did before the seam existed */
    assert.equal(planBuildTurns[0].userIndex, 0);
    assert.equal(planBuildTurns[1].userIndex, 0, "the build inherits the prompt it was approved from");
  });

  check("a settled turn leaves no live activity for the next turn to inherit", () => {
    host.onEvent({ type: "tool_execution_start", toolCallId: "ghost-2", toolName: "bash", args: { command: "echo hi" } });
    host.onEvent({ type: "tool_execution_end", toolCallId: "ghost-2", isError: false, result: {} });
    assert.equal(host.toolActivity().length, 1);
    host.onEvent({ type: "agent_settled" });
    assert.deepEqual(host.toolActivity(), []);
  });

  /* Editing a sent prompt rewinds the conversation in place instead of stacking
   * a new turn on top of the old one, so the prompt list the indices address has
   * to follow the branch being shown — the session file is append-only and keeps
   * every abandoned turn forever. */
  const store = live.sessionManager;
  const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  const firstId = store.appendMessage(user("first prompt"));
  store.appendMessage({ role: "assistant", content: [{ type: "text", text: "first answer" }], timestamp: Date.now() });
  store.appendMessage(user("second prompt"));
  store.appendMessage({ role: "assistant", content: [{ type: "text", text: "second answer" }], timestamp: Date.now() });

  check("prompt targets follow the active branch in order", () => {
    assert.deepEqual(
      host.promptTargets().map((target) => target.text),
      ["first prompt", "second prompt"],
    );
    assert.equal(host.promptTargets()[0].entryId, firstId);
  });

  const rewound = await host.rewindTo(1);
  check("rewinding hands back the full prompt text, not the preview", () => {
    assert.equal(rewound.cancelled, false);
    assert.equal(rewound.text, "second prompt");
  });
  check("rewinding steps the conversation back to before that prompt", () => {
    assert.deepEqual(
      host.promptTargets().map((target) => target.text),
      ["first prompt"],
      "the rewound prompt left the active branch");
    assert.equal(
      host.messages().filter((message) => message.role === "assistant").length,
      1,
      "the answer that followed it went with it",
    );
  });
  check("the abandoned prompt is still in the file, so a rewind is undoable", () => {
    assert.equal(
      live.getUserMessagesForForking().length,
      2,
      "getEntries() still sees both — which is why the index list must not use it",
    );
  });

  /* Home is the canonical no-project workspace. The host accepts the legacy
   * `~` selector but exposes the absolute path everywhere else, so filesystem
   * tools and the sidebar never have to reason about two cwd identities. */
  await host.setCwd("~");
  check("host exposes the canonical Home directory", () => {
    assert.equal(host.getCwd(), homedir());
    assert.equal(host.snapshot().cwd, homedir());
    assert.equal(host.snapshot().homeDir, homedir());
  });
  await host.newSession();
  check("Home can create a fresh empty session", () => {
    assert.equal(host.snapshot().cwd, homedir());
    assert.equal(host.messages().length, 0);
  });
  await host.setCwd(cwd);
  check("switching back from Home restores the project cwd", () => assert.equal(host.getCwd(), cwd));

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
