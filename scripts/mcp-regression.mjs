/**
 * mcp regression — `mcp.json` reading and writing, driven headless.
 *
 *   node scripts/mcp-regression.mjs
 *
 * jiti-loads the real `src/main/mcp.ts` against a sandbox agent directory and
 * project, so what is asserted is the shipped file handling, not a second
 * implementation of it:
 *
 *   read      both files, a project entry replacing a global one by name,
 *             invalid entries reported instead of failing the whole config,
 *             pi's own validation rules, exposure aliases, namespace clashes
 *   write     add, patch, remove; other servers, other top-level keys and keys
 *             the form does not model (oauth) are all left alone
 *   refuse    a file that is not JSON, or a config pi would not load, is never
 *             written — the file stays byte-identical
 *   shape     defaults are dropped rather than written, and the file keeps the
 *             indentation it had (tabs included)
 *   display   the pure MCP row model (`src/shared/mcp-tool.ts`): friendly
 *             server/tool names, JSON/text/image/resource/error sections, and
 *             the bounded, memoised parse a long result must not repeat
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = await mkdtemp(join(tmpdir(), "mcp-regression-"));
const agentDir = join(sandbox, "agent");
const cwd = join(sandbox, "project");
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, ".pi"), { recursive: true });

const jiti = createJiti(import.meta.url);
const { mcpFile, readMcpConfig, writeMcpServer, patchMcpServer, removeMcpServer } = await jiti.import(
  join(root, "src/main/mcp.ts"),
);
const {
  MCP_LINE_LIMIT,
  mcpActionLabel,
  mcpCallDisplay,
  mcpResultSections,
  mcpServerLabel,
  mcpToolIdentity,
  parseMcpToolName,
} = await jiti.import(join(root, "src/shared/mcp-tool.ts"));

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

/** The file's text, asserting first that writing it produced a file at all. */
function text(path) {
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}
const doc = (path) => JSON.parse(text(path));

const globalFile = mcpFile(cwd, agentDir, "global");
const projectFile = mcpFile(cwd, agentDir, "project");
assert.equal(globalFile, join(agentDir, "mcp.json"));
assert.equal(projectFile, join(cwd, ".pi", "mcp.json"));

check("an absent file reads as an empty, codemode-enabled config", () => {
  const view = readMcpConfig(cwd, agentDir);
  assert.deepEqual(view.servers, []);
  assert.deepEqual(view.errors, []);
  assert.equal(view.autoEnableCodemode, true);
});

check("a stdio server is written and read back", () => {
  const view = writeMcpServer(cwd, agentDir, "global", "filesystem", {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    enabled: true,
    exposure: "codemode",
  });
  const entry = view.servers.find((server) => server.name === "filesystem");
  assert.ok(entry, "the server is listed");
  assert.equal(entry.scope, "global");
  assert.equal(entry.config.command, "npx");
  assert.deepEqual(entry.config.args, ["-y", "@modelcontextprotocol/server-filesystem", "."]);
  assert.equal(entry.enabled, true);
  assert.equal(entry.exposure, "codemode");
});

check("keys that only mean the default are not written", () => {
  const entry = doc(globalFile).mcpServers.filesystem;
  assert.equal("enabled" in entry, false, "enabled: true is the default");
  assert.equal("exposure" in entry, false, "exposure: codemode is the default");
});

check("an http server keeps the oauth block the form does not model", () => {
  writeMcpServer(cwd, agentDir, "global", "sentry", {
    type: "http",
    url: "https://mcp.sentry.dev/mcp",
    oauth: { clientName: "pi-desktop" },
  });
  assert.equal(doc(globalFile).mcpServers.sentry.oauth.clientName, "pi-desktop");

  /* editing the url keeps the oauth block */
  writeMcpServer(cwd, agentDir, "global", "sentry", {
    type: "http",
    url: "https://mcp.sentry.dev/v2/mcp",
    oauth: { clientName: "pi-desktop" },
  });
  const again = doc(globalFile).mcpServers.sentry;
  assert.equal(again.url, "https://mcp.sentry.dev/v2/mcp");
  assert.equal(again.oauth.clientName, "pi-desktop");
});

check("a project entry replaces a global one of the same name", () => {
  writeMcpServer(cwd, agentDir, "project", "sentry", { type: "http", url: "https://project.example/mcp" });
  const view = readMcpConfig(cwd, agentDir);
  const entries = view.servers.filter((server) => server.name === "sentry");
  assert.equal(entries.length, 1, "one entry, not two");
  assert.equal(entries[0].scope, "project");
  assert.equal(entries[0].config.url, "https://project.example/mcp");
  /* the global file is untouched */
  assert.equal(doc(globalFile).mcpServers.sentry.url, "https://mcp.sentry.dev/v2/mcp");
});

check("enable, disable and exposure patches land in the defining file", () => {
  const off = patchMcpServer(cwd, agentDir, "global", "filesystem", { enabled: false });
  assert.equal(off.servers.find((server) => server.name === "filesystem").enabled, false);
  assert.equal(doc(globalFile).mcpServers.filesystem.enabled, false);

  const back = patchMcpServer(cwd, agentDir, "global", "filesystem", { enabled: true, exposure: "direct" });
  const entry = back.servers.find((server) => server.name === "filesystem");
  assert.equal(entry.enabled, true);
  assert.equal(entry.exposure, "direct");
  const raw = doc(globalFile).mcpServers.filesystem;
  assert.equal("enabled" in raw, false, "enabling removes the key again");
  assert.equal(raw.exposure, "direct");

  const codemode = patchMcpServer(cwd, agentDir, "global", "filesystem", { exposure: "codemode" });
  assert.equal(codemode.servers.find((server) => server.name === "filesystem").exposure, "codemode");
  assert.equal("exposure" in doc(globalFile).mcpServers.filesystem, false);
});

await checkAsync("other top-level keys and other servers survive every write", async () => {
  const current = doc(globalFile);
  current.autoEnableCodemode = false;
  current.somethingElse = { kept: true };
  await writeFile(globalFile, `${JSON.stringify(current, null, 4)}\n`, "utf8");

  writeMcpServer(cwd, agentDir, "global", "later", { type: "stdio", command: "uvx", args: ["later-mcp"] });
  const written = doc(globalFile);
  assert.equal(written.autoEnableCodemode, false, "the auto-enable switch is kept");
  assert.deepEqual(written.somethingElse, { kept: true });
  assert.ok(written.mcpServers.filesystem, "the earlier server is still there");
  assert.equal(readMcpConfig(cwd, agentDir).autoEnableCodemode, false);

  /* the file's own indentation is kept, not reset to two spaces */
  assert.match(text(globalFile), /\n {4}"mcpServers"/);
});

check("removing a server leaves the rest alone", () => {
  const view = removeMcpServer(cwd, agentDir, "global", "later");
  assert.equal(view.servers.some((server) => server.name === "later"), false);
  assert.ok(view.servers.some((server) => server.name === "filesystem"));
  assert.equal("later" in doc(globalFile).mcpServers, false);
});

check("an unusable name is refused, not written", () => {
  assert.throws(() => writeMcpServer(cwd, agentDir, "global", "bad name!", { type: "stdio", command: "x" }), /letters, digits/);
  assert.equal("bad name!" in doc(globalFile).mcpServers, false);
});

await checkAsync("invalid entries are reported and the good ones still load", async () => {
  const current = doc(globalFile);
  current.mcpServers.broken = { description: "neither command nor url" };
  current.mcpServers["not a name"] = { command: "x" };
  await writeFile(globalFile, `${JSON.stringify(current, null, 2)}\n`, "utf8");

  const view = readMcpConfig(cwd, agentDir);
  assert.ok(view.servers.some((server) => server.name === "filesystem"), "the valid server loads");
  assert.equal(view.servers.some((server) => server.name === "broken"), false);
  assert.equal(view.errors.length, 2, `two problems reported, got ${view.errors.length}`);
});

await checkAsync("a file that is not JSON is reported once, and reads as empty", async () => {
  await writeFile(projectFile, "{ not json", "utf8");
  const view = readMcpConfig(cwd, agentDir);
  /* the global file is still carrying the two bad entries the check above left
     in it, so this asserts on the project file's own error rather than a total */
  assert.ok(
    view.errors.some((line) => line.includes("project")),
    "the broken project file is reported",
  );
  assert.ok(view.servers.some((server) => server.name === "filesystem"), "the global file still loads");
});

/* ── write safety: a broken file is never overwritten ──────────────────────
 *
 * These checks get their own sandbox: the fixtures above leave the shared one
 * with the bad entries a broken file would abort on. */
const safety = await mkdtemp(join(tmpdir(), "mcp-safety-"));
const safetyAgent = join(safety, "agent");
const safetyCwd = join(safety, "project");
const safetyFile = join(safetyCwd, ".pi", "mcp.json");
await mkdir(safetyAgent, { recursive: true });
await mkdir(join(safetyCwd, ".pi"), { recursive: true });
const safetyText = () => readFileSync(safetyFile, "utf8");

await checkAsync("a file that is not JSON is read as an error and never overwritten", async () => {
  const broken = '{ "mcpServers": { "echo": { "command": "node" } },\n';
  await writeFile(safetyFile, broken, "utf8");

  assert.throws(() => writeMcpServer(safetyCwd, safetyAgent, "project", "echo2", { type: "stdio", command: "x" }), /not valid JSON/);
  assert.throws(() => patchMcpServer(safetyCwd, safetyAgent, "project", "echo", { enabled: false }), /not valid JSON/);
  assert.throws(() => removeMcpServer(safetyCwd, safetyAgent, "project", "echo"), /not valid JSON/);
  assert.equal(safetyText(), broken, "the file is byte-identical after every refused edit");

  /* reading still degrades to "no servers" plus an error, so the screen opens */
  const view = readMcpConfig(safetyCwd, safetyAgent);
  assert.deepEqual(view.servers, []);
  assert.ok(view.errors.some((line) => line.includes("mcp.json")), view.errors.join("; "));
});

await checkAsync("a file whose shape is wrong is refused too", async () => {
  for (const fixture of ['{"mcpServers": []}\n', "[]\n", '"text"\n']) {
    await writeFile(safetyFile, fixture, "utf8");
    assert.throws(
      () => writeMcpServer(safetyCwd, safetyAgent, "project", "echo", { type: "stdio", command: "x" }),
      /before saving/,
      `refused for ${fixture.trim()}`,
    );
    assert.equal(safetyText(), fixture, "the file is untouched");
  }
});

await checkAsync("entries pi would refuse are refused before they reach the file", async () => {
  await writeFile(safetyFile, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, "utf8");
  const refused = [
    [{ type: "stdio", command: "x", args: "-y" }, /args must be an array of strings/],
    [{ type: "stdio", command: "x", env: { A: 1 } }, /env must map names to strings/],
    [{ type: "stdio", command: "x", cwd: 3 }, /cwd must be a string/],
    [{ type: "stdio", command: "x", enabled: "yes" }, /enabled must be a boolean/],
    [{ type: "stdio", command: "x", timeout: 0 }, /timeout must be a positive number/],
    [{ type: "stdio", command: "x", exposure: "always" }, /exposure must be one of/],
    [{ type: "stdio", command: "x", toolExposure: { read: "always" } }, /toolExposure "read" must be one of/],
    [{ type: "sse", url: "https://example.com/mcp" }, /legacy SSE/],
    [{ url: "ftp://example.com/mcp" }, /http or https/],
    [{ url: "https://example.com/mcp", headers: { A: 1 } }, /headers must map names to strings/],
    [{ url: "http://example.com/mcp", auth: { provider: "x" } }, /auth requires an https URL/],
    [{ url: "https://example.com/mcp", oauth: { callbackUrl: "https://example.com/callback" } }, /oauth.callbackUrl/],
    [{ description: "no transport" }, /needs either "command"/],
  ];
  for (const [config, pattern] of refused) {
    assert.throws(() => writeMcpServer(safetyCwd, safetyAgent, "project", "echo", config), pattern, JSON.stringify(config));
  }
  assert.deepEqual(doc(safetyFile).mcpServers, {}, "nothing was written");
});

await checkAsync("pi's exposure alias reads as its current name without rewriting the file", async () => {
  await writeFile(
    safetyFile,
    `${JSON.stringify({ mcpServers: { echo: { command: "node", exposure: "codemode-deferred" } } }, null, 2)}\n`,
    "utf8",
  );
  const view = readMcpConfig(safetyCwd, safetyAgent);
  assert.equal(view.servers.find((server) => server.name === "echo").exposure, "codemode");

  /* editing a sibling server leaves the alias exactly as the user typed it */
  writeMcpServer(safetyCwd, safetyAgent, "project", "other", { type: "stdio", command: "uvx", args: ["other-mcp"] });
  assert.equal(doc(safetyFile).mcpServers.echo.exposure, "codemode-deferred");
});

await checkAsync("retired deferred exposure migrates to codemode on read", async () => {
  /* deferred only worked through tool_search, which is no longer registered —
     pi reads mcp.json directly, so the file itself must be healed */
  await writeFile(
    safetyFile,
    `${JSON.stringify({ mcpServers: { echo: { command: "node", exposure: "deferred", toolExposure: { read: "deferred" } } } }, null, 2)}\n`,
    "utf8",
  );
  const view = readMcpConfig(safetyCwd, safetyAgent);
  assert.equal(view.servers.find((server) => server.name === "echo").exposure, "codemode");
  const written = doc(safetyFile).mcpServers.echo;
  assert.equal(written.exposure, "codemode");
  assert.equal(written.toolExposure.read, "codemode");
});

await checkAsync("names that fold into one namespace are reported, not both loaded", async () => {
  await writeFile(
    safetyFile,
    `${JSON.stringify({ mcpServers: { "a-b": { command: "x" }, a_b: { command: "y" } } }, null, 2)}\n`,
    "utf8",
  );
  const view = readMcpConfig(safetyCwd, safetyAgent);
  assert.deepEqual(view.servers.map((server) => server.name), ["a-b"]);
  assert.equal(view.errors.length, 1);
  assert.match(view.errors[0], /conflicts with "a-b"/);
});

await checkAsync("a tab-indented file keeps its tabs", async () => {
  await writeFile(safetyFile, '{\n\t"mcpServers": {\n\t\t"echo": { "command": "node" }\n\t}\n}\n', "utf8");
  writeMcpServer(safetyCwd, safetyAgent, "project", "other", { type: "stdio", command: "uvx", args: ["other-mcp"] });
  const written = safetyText();
  assert.match(written, /\n\t"mcpServers"/);
  assert.match(written, /\n\t\t"other"/);
  assert.equal(readMcpConfig(safetyCwd, safetyAgent).errors.length, 0);
});

/* ── display: the pure MCP row model ─────────────────────────────────────── */

check("a wire name splits at the separator pi itself uses", () => {
  assert.deepEqual(parseMcpToolName("mcp__filesystem__read_file"), { server: "filesystem", tool: "read_file" });
  assert.deepEqual(parseMcpToolName("mcp__my_server__list"), { server: "my_server", tool: "list" });
  assert.equal(parseMcpToolName("read"), null);
  assert.equal(parseMcpToolName("mcp__server__"), null);
  assert.equal(parseMcpToolName("mcp__"), null);
});

check("result details outrank the sanitised wire name", () => {
  assert.deepEqual(mcpToolIdentity("mcp__a_b__c_d", { server: "a-b", tool: "c.d" }), { server: "a-b", tool: "c.d" });
  assert.deepEqual(mcpToolIdentity("mcp__plain__read"), { server: "plain", tool: "read" });
  assert.equal(mcpToolIdentity("read"), null);
});

check("the row names the server and the action, not the wire name", () => {
  assert.equal(mcpServerLabel("filesystem"), "Filesystem");
  assert.equal(mcpServerLabel("plugin:acme:docs_server"), "Docs server");
  assert.equal(mcpActionLabel("firebase_get_environment", "Firebase"), "Get environment");
  assert.equal(mcpActionLabel("read_file", "Filesystem"), "Read file");

  const call = mcpCallDisplay({ toolName: "mcp__firebase__firebase_get_environment", args: {} });
  assert.equal(call.serverLabel, "Firebase");
  assert.equal(call.actionLabel, "Get environment");
  assert.equal(call.chip, "Get environment");
  assert.equal(call.wireName, "mcp__firebase__firebase_get_environment");
  assert.equal(mcpCallDisplay({ toolName: "read" }), null);
});

check("a JSON result is pretty-printed, bounded, and parsed once", () => {
  const big = JSON.stringify({ items: Array.from({ length: 400 }, (_, index) => ({ index })) });
  const sections = mcpResultSections({ resultText: big });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, "json");
  assert.equal(sections[0].lines.length, MCP_LINE_LIMIT);
  assert.ok(sections[0].more > 0, "the hidden line count is reported");
  assert.equal(sections[0].lines[0], "{");
  assert.equal(sections[0].text, JSON.stringify(JSON.parse(big), null, 2), "the clipboard copy is the whole text");

  /* the second render of the same result reuses the parse, not just the shape */
  assert.equal(mcpResultSections({ resultText: big }), sections);
});

check("text, errors, images and resources each become their own section", () => {
  assert.deepEqual(mcpResultSections({ resultText: "hello\nworld" }).map((section) => section.kind), ["text"]);
  assert.deepEqual(mcpResultSections({ resultText: "" }), []);

  const failed = mcpResultSections({ resultText: "boom", isError: true });
  assert.deepEqual(failed.map((section) => section.kind), ["error"]);

  const forwarded = mcpResultSections({
    content: [
      { type: "text", text: '{"ok":true}' },
      { type: "image", mimeType: "image/png", data: "aGk=" },
      {
        type: "resource",
        resource: { uri: "file:///tmp/notes.md", mimeType: "text/markdown", text: "# notes" },
      },
      { type: "resource_link", uri: "file:///tmp/spec.pdf", name: "spec.pdf", mimeType: "application/pdf" },
    ],
  });
  assert.deepEqual(forwarded.map((section) => section.kind), ["json", "image", "resource", "resource"]);
  assert.equal(forwarded[1].src, "data:image/png;base64,aGk=");
  assert.equal(forwarded[2].label, "file:///tmp/notes.md");
  assert.equal(forwarded[2].text, "# notes");
  assert.equal(forwarded[3].uri, "file:///tmp/spec.pdf");
});

check("the call's arguments ride along as bounded JSON, once per object", () => {
  const args = { path: "/x/y.ts" };
  const call = mcpCallDisplay({ toolName: "mcp__s__t", args });
  assert.equal(call.chip, "T · /x/y.ts");
  assert.match(call.args.text, /"path": "\/x\/y\.ts"/);
  assert.equal(call.args.more, 0);
  assert.equal(mcpCallDisplay({ toolName: "mcp__s__t", args }).args, call.args, "the same object is not stringified twice");

  const noArgs = mcpCallDisplay({ toolName: "mcp__s__t", args: {} });
  assert.equal(noArgs.args, undefined);
  assert.equal(noArgs.chip, "T");
});

check("a truncated result points at the file pi saved", () => {
  const call = mcpCallDisplay({
    toolName: "mcp__s__t",
    resultText: "Warning: truncated output\n\n{\"a\":1}\n\n[Full output: /tmp/pi-mcp-abc.txt (read it with offset/limit)]",
    details: { server: "s", tool: "t", fullOutputPath: "/tmp/pi-mcp-abc.txt" },
  });
  assert.equal(call.fullOutputPath, "/tmp/pi-mcp-abc.txt");
  assert.deepEqual(call.sections.map((section) => section.kind), ["text"]);
});

console.log(`\n${count} mcp checks passed`);
