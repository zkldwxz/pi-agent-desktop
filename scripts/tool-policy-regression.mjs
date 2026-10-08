/**
 * tool-policy regression — the agent-tools extension, driven headless.
 *
 *   node scripts/tool-policy-regression.mjs
 *
 * jiti-loads `src/main/agent-tools/extension.ts` against a stub ExtensionAPI
 * and runs the *real* pi tool definitions underneath it, so what is asserted is
 * the shipped budget, not a second implementation of it:
 *
 *   registration  the three built-ins are overridden by name, keeping pi's
 *                 schemas, renderers and prompt metadata
 *   cleaning      colour, carriage returns and control bytes never reach the
 *                 model; NO_COLOR/TERM/FORCE_COLOR reach the command
 *   budget        bash keeps head+tail and names a file with the full output;
 *                 read continues with an offset it computed; grep keeps pi's
 *                 notices and says what the desktop's budget cut
 *   semantics     images pass through read untouched, file bytes are never
 *                 stripped, grep context lines survive, cancellation and
 *                 failure stay pi's
 *   no cache      running, reading and searching twice does the work twice
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = await mkdtemp(join(tmpdir(), "tool-policy-"));
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
const cwd = join(sandbox, "project");
await writeFile(join(sandbox, ".keep"), "");
const jiti = createJiti(import.meta.url);

let count = 0;
function check(label, fn) {
  fn();
  count += 1;
  console.log(`PASS ${label}`);
}
async function checkAsync(label, fn) {
  await fn();
  count += 1;
  console.log(`PASS ${label}`);
}

const { mkdir } = await import("node:fs/promises");
await mkdir(cwd, { recursive: true });
const { createReadToolDefinition } = await import("@earendil-works/pi-coding-agent");

/** The ExtensionAPI surface the tools extension actually touches. */
const tools = new Map();
const api = {
  registerTool: (definition) => tools.set(definition.name, definition),
  on: () => {},
  getActiveTools: () => [...tools.keys()],
};

const { registerAgentTools } = await jiti.import(join(root, "src/main/agent-tools/extension.ts"));
registerAgentTools(api);

/** One agent-session context, as pi hands it to a tool. */
const ctx = {
  cwd,
  model: undefined,
  thinkingLevel: undefined,
  sessionManager: { getSessionId: () => "tool-policy-test", getSessionFile: () => undefined },
};

function run(name, params, { signal, onUpdate } = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool ${name} was not registered`);
  return tool.execute(`${name}-call`, params, signal, onUpdate, ctx);
}

const ESC = "\u001b[";
const bytes = (value) => Buffer.byteLength(value, "utf-8");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

try {
  check("registers bash/read/grep over the built-ins", () => {
    assert.deepEqual([...tools.keys()].sort(), ["bash", "grep", "read"]);
    assert.equal(tools.get("bash").executionMode, "sequential");
    assert.equal(tools.get("read").executionMode, "parallel");
    assert.equal(tools.get("grep").executionMode, "parallel");
    for (const name of ["bash", "read", "grep"]) {
      const tool = tools.get(name);
      assert.ok(tool.parameters, `${name} keeps pi's parameter schema`);
      assert.ok(tool.promptSnippet, `${name} keeps a prompt snippet`);
      assert.match(tool.description, /KB/, `${name} states its budget`);
      assert.equal(typeof tool.renderCall, "function", `${name} inherits pi's renderer`);
      assert.equal(typeof tool.renderResult, "function", `${name} inherits pi's renderer`);
    }
  });

  await checkAsync("bash: project shell settings are preserved", async () => {
    const project = join(sandbox, "configured-project");
    await mkdir(join(project, ".pi"), { recursive: true });
    await writeFile(join(project, ".pi/settings.json"), JSON.stringify({ shellCommandPrefix: "export TOOL_POLICY_PREFIX=preserved" }));
    const { createAgentBashTool } = await jiti.import(join(root, "src/main/agent-tools/bash.ts"));
    const configured = createAgentBashTool(project);
    const result = await configured.execute("configured", { command: 'printf "%s" "$TOOL_POLICY_PREFIX"' }, undefined, undefined, { ...ctx, cwd: project });
    assert.equal(result.content[0].text, "preserved");
    const badProject = join(sandbox, "bad-shell-project");
    await mkdir(join(badProject, ".pi"), { recursive: true });
    await writeFile(join(badProject, ".pi/settings.json"), JSON.stringify({ shellPath: join(badProject, "missing-shell") }));
    await assert.rejects(configured.execute("bad-shell", { command: "printf should-not-run" }, undefined, undefined, { ...ctx, cwd: badProject }));
  });

  /* ── bash ─────────────────────────────────────────────────────────── */

  await checkAsync("bash: colour and control bytes never reach the model", async () => {
    const result = await run("bash", {
      command: `printf '\\033[31mRED\\033[0m and \\033]8;;http://x\\033\\\\link\\033]8;;\\033\\\\ done\\n'; printf 'a\\rb\\rc\\n'; printf 'x\\001y\\n'`,
    });
    const text = result.content.map((block) => block.text).join("");
    assert(!text.includes(ESC), "no ANSI escape reaches the model");
    assert.match(text, /RED and link done/);
    assert.match(text, /\nc\n/, "carriage-return frames collapse to the last frame");
    assert.match(text, /\nxy\n/, "control characters are dropped");
  });

  await checkAsync("bash: the command is told not to colour its output", async () => {
    const result = await run("bash", {
      command: `printf '%s|%s|%s\\n' "$NO_COLOR" "$TERM" "$FORCE_COLOR"`,
    });
    assert.match(result.content[0].text, /1\|dumb\|0/);
  });

  await checkAsync("bash: pi's own truncation is cut from the end, and the file has it all", async () => {
    const result = await run("bash", {
      command: `for i in $(seq 1 400); do printf 'line %04d %s\\n' "$i" "$(printf 'y%.0s' $(seq 1 200))"; done`,
    });
    const text = result.content[0].text;
    assert.match(text, /line 0400/, "the last line survives");
    assert.ok(!text.includes("line 0001"), "a tail slice is not presented as having a head");
    assert.match(text, /Showing the last 20\.0KB of /);
    assert.ok(bytes(text) <= 20 * 1024 + 600, `budget is respected (${bytes(text)} bytes)`);
    const path = result.details?.fullOutputPath;
    assert.ok(path && existsSync(path), "the full output is on disk");
    const full = await readFile(path, "utf-8");
    assert.match(full, /line 0001/, "the file holds the beginning pi had to drop");
    assert.match(full, /line 0400/, "and the end");
    assert.match(text, new RegExp(path.replace(/[\\]/g, "\\\\")), "the notice names the file");
    assert.equal(result.details.truncation.truncated, true);
  });

  await checkAsync("bash: under pi's limit the middle is dropped, head and tail survive", async () => {
    const result = await run("bash", {
      command: `for i in $(seq 1 150); do printf 'line %04d %s\\n' "$i" "$(printf 'y%.0s' $(seq 1 200))"; done`,
    });
    const text = result.content[0].text;
    assert.ok(text.startsWith("line 0001"), "the head survives");
    assert.match(text, /omitted/, "the middle is marked as omitted");
    assert.match(text, /line 0150/, "the tail survives");
    assert.match(text, /Showing the first 6\.0KB and last 14\.0KB of /);
    assert.ok(bytes(text) <= 20 * 1024 + 600, `budget is respected (${bytes(text)} bytes)`);
    const path = result.details?.fullOutputPath;
    assert.ok(path && existsSync(path), "the full output is on disk");
    assert.match(await readFile(path, "utf-8"), /line 0150/);
  });

  await checkAsync("bash: the full output file is cleaned, not raw", async () => {
    const result = await run("bash", {
      command: `printf '\\033[32m%s\\033[0m\\n' "$(printf 'z%.0s' $(seq 1 30000))"`,
    });
    const path = result.details?.fullOutputPath;
    assert.ok(path && existsSync(path), "the spill file exists");
    const full = await readFile(path, "utf-8");
    assert(!full.includes(ESC), "the spill file carries no ANSI either");
    assert.ok(bytes(full) >= 30000);
  });

  /* pi 1.0 turned a non-zero exit from a thrown error into an error result, so
     what used to be asserted on the exception is asserted on `isError` and the
     result's own text — the desktop's cleaning and budget apply either way. */
  await checkAsync("bash: a failure is an error result, with a bounded cleaned message", async () => {
    const failed = await run("bash", { command: "printf 'boom\\n'; exit 3" });
    assert.equal(failed.isError, true, "a non-zero exit is flagged on the result");
    assert.match(failed.content[0].text, /boom/);
    assert.match(failed.content[0].text, /Command exited with code 3/);

    const noisy = await run("bash", {
      command: `printf '\\033[31m%s\\033[0m\\n' "$(printf 'q%.0s' $(seq 1 40000))"; exit 1`,
    });
    assert.equal(noisy.isError, true, "the truncated failure is still an error");
    const noisyText = noisy.content[0].text;
    assert(!noisyText.includes(ESC), "the failure message is cleaned");
    assert.ok(bytes(noisyText) <= 20 * 1024 + 600, `the failure message is bounded (${bytes(noisyText)})`);
    const failurePath = noisy.details?.fullOutputPath;
    assert.ok(failurePath && existsSync(failurePath), "truncated failure has a full-output file");
    assert.match(await readFile(failurePath, "utf8"), /q{40000}/);
  });

  await checkAsync("bash: an aborted call stops the command instead of waiting for it", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = run("bash", { command: "sleep 30" }, { signal: controller.signal });
    pending.catch(() => {});
    await sleep(400);
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.ok(Date.now() - started < 10_000, "the call did not wait for the command");
      assert.match(error.message, /aborted/i);
      return true;
    });
  });

  await checkAsync("bash: no result cache — the second call runs the command again", async () => {
    const first = await run("bash", { command: "echo x >> counter.txt; wc -l < counter.txt" });
    const second = await run("bash", { command: "echo x >> counter.txt; wc -l < counter.txt" });
    assert.equal(first.content[0].text.trim(), "1");
    assert.equal(second.content[0].text.trim(), "2");
  });

  /* ── read ─────────────────────────────────────────────────────────── */

  const bigFile = join(cwd, "big.txt");
  await writeFile(
    bigFile,
    `${Array.from({ length: 3000 }, (_, index) => `line ${String(index + 1).padStart(4, "0")} ${"v".repeat(60)}`).join("\n")}\n`,
    "utf-8",
  );

  await checkAsync("read: a small file is returned byte-identical", async () => {
    const small = join(cwd, "small.txt");
    await writeFile(small, "alpha\nbeta\n", "utf-8");
    const result = await run("read", { path: small });
    assert.equal(result.content[0].text, "alpha\nbeta\n");
  });

  await checkAsync("read: file bytes are not rewritten (ANSI in a file is content)", async () => {
    const raw = join(cwd, "raw.log");
    await writeFile(raw, `${ESC}31mred${ESC}0m\n`, "utf-8");
    const result = await run("read", { path: raw });
    assert.equal(result.content[0].text, `${ESC}31mred${ESC}0m\n`);
  });

  await checkAsync("read: the budget is respected and the offset continues to the end", async () => {
    const seen = [];
    let offset;
    for (let guard = 0; guard < 40; guard += 1) {
      const result = await run("read", { path: bigFile, ...(offset ? { offset } : {}) });
      const text = result.content[0].text;
      assert.ok(bytes(text) <= 24 * 1024 + 200, `budget respected (${bytes(text)} bytes)`);
      const lines = text.split("\n").filter((line) => line.startsWith("line "));
      seen.push(...lines.map((line) => line.slice(5, 9)));
      const next = /Continue with offset=(\d+)/.exec(text);
      if (!next) break;
      offset = Number(next[1]);
    }
    assert.equal(seen[0], "0001", "reading starts at the top");
    assert.equal(seen[seen.length - 1], "3000", "continuing reaches the last line");
    assert.equal(seen.length, 3000, "every line is reachable");
  });

  await checkAsync("read: an image takes pi's own image path, unchanged", async () => {
    /* 4×4 opaque PNG */
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR42mP8z8Dwn4GBgYGJgYGBgQEAHAAD/wF0XwAAAABJRU5ErkJggg==",
      "base64",
    );
    const path = join(cwd, "dot.png");
    await writeFile(path, png);
    const result = await run("read", { path });
    /* Whether this machine can decode the image or not, the result the model
     * gets is the one pi produced: the wrapper adds nothing and removes nothing
     * on this path, which is what keeps attachments and the non-vision note. */
    const builtin = createReadToolDefinition(cwd);
    const reference = await builtin.execute("reference", { path }, undefined, undefined, ctx);
    assert.deepEqual(
      JSON.stringify(result.content),
      JSON.stringify(reference.content),
      "an image read is byte-identical to pi's own",
    );
    assert.match(result.content[0].text, /Read image file/);
  });

  await checkAsync("read: a missing file still fails the way pi fails", async () => {
    await assert.rejects(() => run("read", { path: join(cwd, "nope.txt") }));
  });

  await checkAsync("read: an aborted call does not read", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => run("read", { path: bigFile }, { signal: controller.signal }));
  });

  await checkAsync("read: no result cache — the second read sees the new bytes", async () => {
    const path = join(cwd, "moving.txt");
    await writeFile(path, "first\n", "utf-8");
    assert.equal((await run("read", { path })).content[0].text, "first\n");
    await writeFile(path, "second\n", "utf-8");
    assert.equal((await run("read", { path })).content[0].text, "second\n");
  });

  /* ── grep ─────────────────────────────────────────────────────────── */

  const haystack = join(cwd, "haystack");
  await mkdir(haystack, { recursive: true });
  await writeFile(
    join(haystack, "one.txt"),
    `${Array.from({ length: 400 }, (_, index) => `needle ${String(index + 1).padStart(3, "0")} ${"w".repeat(260)}`).join("\n")}\n`,
    "utf-8",
  );
  await writeFile(join(haystack, "two.txt"), "before\nneedle here\nafter\n", "utf-8");

  await checkAsync("grep: context lines still surround a match", async () => {
    const result = await run("grep", { pattern: "needle here", path: haystack, context: 1 });
    const text = result.content[0].text;
    assert.match(text, /two\.txt:2: needle here/);
    assert.match(text, /two\.txt-1- before/);
    assert.match(text, /two\.txt-3- after/);
  });

  await checkAsync("grep: over budget keeps pi's notices and says what was cut", async () => {
    const result = await run("grep", { pattern: "needle", path: haystack });
    const text = result.content[0].text;
    assert.ok(bytes(text) <= 16 * 1024 + 600, `budget respected (${bytes(text)} bytes)`);
    assert.match(text, /grep budget cut the result after \d+ of \d+ lines/);
    assert.match(text, /Re-run with a narrower pattern/);
    assert.match(text, /100 matches limit reached/, "pi's own notice survives the cut");
    assert.equal(result.details?.truncation?.truncated, true);
    assert.equal(result.details?.matchLimitReached, 100);
  });

  await checkAsync("grep: a search that also hit pi's byte cap still says both", async () => {
    const result = await run("grep", { pattern: "needle", path: haystack, limit: 400 });
    const text = result.content[0].text;
    assert.ok(bytes(text) <= 16 * 1024 + 600, `budget respected (${bytes(text)} bytes)`);
    assert.match(text, /limit reached/, "pi's cap is reported");
    assert.match(text, /grep budget cut the result after \d+ of \d+ lines/);
  });

  await checkAsync("grep: pi's own match-limit notice survives the budget", async () => {
    const result = await run("grep", { pattern: "needle", path: haystack, limit: 20 });
    const text = result.content[0].text;
    assert.match(text, /20 matches limit reached/);
    assert.equal(result.details?.matchLimitReached, 20);
  });

  await checkAsync("grep: no result cache — a changed file changes the result", async () => {
    const path = join(cwd, "moving-search.txt");
    await writeFile(path, "searchable\n", "utf-8");
    assert.match((await run("grep", { pattern: "searchable", path })).content[0].text, /moving-search\.txt/);
    await writeFile(path, "something else\n", "utf-8");
    assert.match((await run("grep", { pattern: "searchable", path })).content[0].text, /No matches found/);
  });

  await checkAsync("grep: an aborted call does not search", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => run("grep", { pattern: "needle", path: haystack }, { signal: controller.signal }));
  });

  /* ── the file manager's mark ──────────────────────────────────────────
   *
   * The toolbar's folder button wears the icon of the application that opens
   * folders: Explorer on Windows, Finder on macOS. Both are read from a file
   * the platform owns, so the paths are checked here rather than trusted — a
   * typo in `/System/Library/CoreServices/...` silently degrades the button to
   * a generic gray glyph, which is exactly the bug this covers.
   *
   * Windows cannot be exercised from here, so its branch is checked for shape;
   * macOS is checked for existence, being the platform this runs on.
   */
  {
    const { readFileSync, existsSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/main/openers.ts", import.meta.url), "utf8");
    await checkAsync("openers: the reveal row resolves to the platform's own file manager", async () => {
      assert.match(source, /if \(process\.platform === "win32"\) return explorerExe\(\);/);
      assert.match(source, /if \(process\.platform === "darwin"\) return finderIcon\(\);/);
    });
    const finder = "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns";
    await checkAsync("openers: the Finder icon path is the real one", async () => {
      assert.ok(source.includes(finder), "the path is spelled as Apple ships it");
      if (process.platform === "darwin") assert.ok(existsSync(finder), `${finder} exists`);
    });
    /* `getFileIcon` answers with the generic application glyph for a `.app` on
     * macOS (verified), so the `.icns` has to be unpacked in-process. Losing
     * that branch is a silent regression back to the gray folder. */
    await checkAsync("openers: a .icns is unpacked, not handed to getFileIcon", async () => {
      assert.match(source, /icnsDataUrl\(source, ICON_WANT_PX\)/);
      assert.match(source, /!== "icns"/);
    });
  }

  console.log(`${count} tool-policy checks passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
