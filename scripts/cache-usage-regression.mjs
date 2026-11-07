/**
 * cache-usage regression — the cache rate in one place, and the request prefix
 * that must not move.
 *
 *   node scripts/cache-usage-regression.mjs
 *
 * Two subjects, both about what the provider is charged for:
 *
 *   the rate    `cacheRead / (input + cacheRead + cacheWrite)`, asserted at the
 *               level of the shared helper, the session scanner and the
 *               serialized message the turn footer reads — one number, several
 *               consumers
 *   the prefix  plan mode must not touch the tool catalog or the system prompt
 *               (both are part of the cached prefix), and plan reminders must
 *               be a pure function of state: byte-identical across turns.
 *               Reminders are checked the same way — unchanged state,
 *               unchanged bytes.
 *
 * The scanner runs against a synthetic agent directory, so no real session log
 * is read or written. `node scripts/plan-mode-smoke.mjs` covers the full plan
 * state machine; this file pins the cache-facing invariants only.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = await mkdtemp(join(tmpdir(), "cache-usage-"));
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
const cwd = join(sandbox, "project");
await mkdir(cwd, { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@shared": join(root, "src/shared") } });
let count = 0;
async function check(label, fn) {
  await fn();
  count += 1;
  console.log(`PASS ${label}`);
}

/** input / cacheRead / cacheWrite behind every reading below */
const USAGE = { input: 200, cacheRead: 600, cacheWrite: 200 };
const EXPECTED_RATE = 600 / (200 + 600 + 200); // 0.6
const OLD_RATE = 600 / (200 + 600); // 0.75 — what the denominator used to be

try {
  /* ── the rate, defined once ─────────────────────────────────────── */

  const { cacheHitRate, freshPromptTokens, promptTokens } = await jiti.import(
    join(root, "src/shared/cache-usage.ts"),
  );

  await check("cache rate is cacheRead / (input + cacheRead + cacheWrite)", () => {
    assert.equal(cacheHitRate(USAGE), EXPECTED_RATE);
    assert.notEqual(cacheHitRate(USAGE), OLD_RATE, "cache writes are part of the denominator");
    assert.equal(promptTokens(USAGE), 1000);
    assert.equal(freshPromptTokens(USAGE), 400, "fresh means input plus the write premium");
  });

  await check("a partial usage reads its missing half as zero", () => {
    assert.equal(cacheHitRate({ input: 10, cacheRead: 10 }), 0.5);
    assert.equal(cacheHitRate({}), 0, "no prompt, no rate");
    assert.equal(cacheHitRate({ cacheRead: 0, input: 0, cacheWrite: 0 }), 0);
  });

  /* ── the scanner behind the usage page ─────────────────────────── */

  const { collectUsage } = await jiti.import(join(root, "src/main/usage.ts"));
  const sessionDir = join(sandbox, "agent", "sessions", "proj");
  await mkdir(sessionDir, { recursive: true });
  const entry = (index, usage) =>
    JSON.stringify({
      type: "message",
      id: `m${index}`,
      timestamp: `2026-09-22T0${index}:00:00.000Z`,
      message: { role: "assistant", provider: "stub", model: "stub-model", usage },
    });
  await writeFile(
    join(sessionDir, "session.jsonl"),
    [
      entry(1, { ...USAGE, output: 50, totalTokens: 1050, cost: { total: 0.01 } }),
      JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "model_change", provider: "stub", modelId: "stub-model" }),
    ].join("\n"),
    "utf-8",
  );

  const stats = await collectUsage();
  await check("the scanner reports the unified rate everywhere", () => {
    assert.equal(stats.totals.input, 200);
    assert.equal(stats.totals.cacheRead, 600);
    assert.equal(stats.totals.cacheWrite, 200);
    assert.equal(stats.cache.hitRate, EXPECTED_RATE);
    assert.equal(stats.models[0].cacheRate, EXPECTED_RATE);
    assert.equal(stats.providers[0].cacheRate, EXPECTED_RATE);
    assert.equal(stats.cacheByChannel[0].cacheHitRate, EXPECTED_RATE);
    assert.equal(stats.deviations[0].cacheRate, EXPECTED_RATE);
    assert.equal(stats.days[0].cacheWrite, 200, "the daily row carries the write half");
    assert.notEqual(stats.cache.hitRate, OLD_RATE, "the old denominator would have said 75%");
  });

  /* ── the message the turn footer reads ─────────────────────────── */

  const { serializeMessage } = await jiti.import(join(root, "src/main/serialize.ts"));
  await check("a serialized turn carries the write half to the footer", () => {
    const chat = serializeMessage(
      {
        role: "assistant",
        provider: "stub",
        model: "stub-model",
        content: [{ type: "text", text: "done" }],
        usage: { ...USAGE, output: 50, totalTokens: 1050 },
      },
      0,
    );
    assert.equal(chat.usage.cacheWrite, 200);
    assert.equal(cacheHitRate(chat.usage), EXPECTED_RATE, "footer and usage page agree");
  });

  /* ── the request prefix: plan mode must not move it ─────────────── */

  const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "create_plan", "todo_write"];

  const planMode = (await jiti.import(join(root, "resources/extensions/plan-mode/index.ts"))).default;

  /** One loaded plan-mode instance, with the ExtensionAPI surface it touches. */
  const mountPlan = ({ branch = [], refuseToolSetWrites = false } = {}) => {
    const handlers = new Map();
    const tools = new Map();
    const commands = new Map();
    const catalogWrites = [];
    let thinking = "medium";
    const ctx = {
      ui: {
        setStatus: () => {},
        setWidget: () => {},
        notify: () => {},
        select: async () => undefined,
        input: async () => undefined,
      },
      mode: "tui",
      hasUI: true,
      cwd,
      sessionManager: { getBranch: () => branch, getEntries: () => branch },
      model: { provider: "stub", id: "stub-model" },
      isIdle: () => true,
      signal: undefined,
    };
    planMode({
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (name, options) => commands.set(name, options),
      registerShortcut: () => {},
      registerFlag: () => {},
      getFlag: () => false,
      getActiveTools: () => [...DEFAULT_TOOLS],
      setActiveTools: (names) => {
        catalogWrites.push([...names]);
        if (refuseToolSetWrites) throw new Error("plan mode must not change the active tool set");
      },
      getThinkingLevel: () => thinking,
      setThinkingLevel: (level) => {
        thinking = level;
      },
      appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
      sendMessage: () => {},
      sendUserMessage: () => {},
      getCommands: () => [],
      events: { emit: () => {}, on: () => () => {} },
    });
    return {
      ctx,
      tools,
      catalogWrites,
      fire: async (event, payload = {}) => {
        const results = [];
        for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, ctx));
        return results;
      },
      call: (name, params) => tools.get(name).execute(`call-${name}`, params, undefined, undefined, ctx),
      command: (line) => {
        const [name, ...rest] = line.replace(/^\//, "").split(/\s+/);
        return commands.get(name).handler(rest.join(" "), ctx);
      },
    };
  };

  const session = mountPlan({ refuseToolSetWrites: true });
  await session.fire("session_start", { type: "session_start", reason: "startup" });

  await check("plan mode never writes the active tool set", async () => {
    await session.command("/plan");
    await session.call("create_plan", { title: "Prefix", steps: [{ label: "Do it" }] });
    await session.command("/plan build");
    await session.command("/plan cancel");
    assert.deepEqual(session.catalogWrites, [], "setActiveTools would invalidate the whole cached conversation");
    assert.deepEqual([...session.tools.keys()], ["create_plan"], "the catalog is what the host built");
  });

  await check("a resumed plan closes the gate from the log without a catalog change", async () => {
    /* an entry shaped like the ones older sessions wrote, `toolsBefore` and all:
     * the phase is what matters, the rest is ignored rather than migrated */
    const legacy = {
      type: "custom",
      customType: "plan-mode",
      data: {
        phase: "review",
        steps: [{ id: "step-1", label: "Old plan", status: "pending" }],
        toolsBefore: ["edit", "write"],
        updatedAt: 1,
      },
    };
    const resumed = mountPlan({ branch: [legacy] });
    await resumed.fire("session_start", { type: "session_start", reason: "resume" });
    assert.deepEqual(resumed.catalogWrites, [], "no catalog change on resume either");
    const refused = await resumed.fire("tool_call", { type: "tool_call", toolCallId: "t", toolName: "edit", input: {} });
    assert.equal(refused[0]?.block, true, "the review plan still refuses writes");
  });

  await check("a plan reminder is byte-stable while its state is", async () => {
    await session.command("/plan");
    const first = (await session.fire("before_agent_start", { prompt: "next" }))[0];
    assert.ok(first?.message?.content, "a reminder is injected while planning");
    assert.equal(/\d{4}-\d{2}-\d{2}T/.test(first.message.content), false, "no timestamps in the reminder");
    const again = (await session.fire("before_agent_start", { prompt: "next" }))[0];
    assert.equal(again.message.content, first.message.content, "unchanged state, unchanged reminder");
  });

  console.log(`${count} cache-usage checks passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
