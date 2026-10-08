import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, realpath, symlink, rm, readdir, stat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { SshHost, quoteShell } = await jiti.import("../src/main/remote-ssh.ts");
const { WorkspaceStore } = await jiti.import("../src/main/workspaces.ts");
const { PiHost } = await jiti.import("../src/main/pi-host.ts");
const { registerRemoteTools, registerWorkspaceContext } = await jiti.import("../src/main/workspace-tools.ts");
const { remotePath, parseRemotePath } = await jiti.import("../src/shared/workspaces.ts");
const { STATUS_CODE } = utils.sftp;
const directory = await mkdtemp(join(tmpdir(), "pi-remote-test-"));
const metadata = join(directory, "metadata");
const remoteRoot = join(directory, "remote");
await mkdir(join(remoteRoot, "project"), { recursive: true });
await writeFile(join(remoteRoot, "project", "sample.txt"), "first\nsecond\nthird\n");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "pkcs1", format: "pem" } });
const handles = new Map();
let sequence = 0;
const clients = new Set();
const local = (path) => join(remoteRoot, path.replace(/^\//, ""));
const attrs = (info) => ({ mode: info.mode, uid: 0, gid: 0, size: info.size, atime: Math.floor(info.atimeMs / 1000), mtime: Math.floor(info.mtimeMs / 1000) });
const server = new Server({ hostKeys: [privateKey] }, (client) => {
  clients.add(client); client.on("error", () => {}); client.on("close", () => clients.delete(client));
  client.on("authentication", (ctx) => ctx.username === "qa" && ctx.method === "password" && ctx.password === "fixture-password" ? ctx.accept() : ctx.reject());
  client.on("ready", () => client.on("session", (accept) => {
    const session = accept();
    session.on("pty", (accept) => accept());
    session.on("exec", (accept, reject, info) => {
      const stream = accept();
      if (info.command.includes("sleep-test")) { stream.on("signal", () => stream.close()); return; }
      stream.write(info.command.includes("fail-test") ? "remote failure\n" : `REMOTE:${info.command}\n`);
      stream.exit(info.command.includes("fail-test") ? 7 : 0); stream.end();
    });
    session.on("sftp", (accept) => {
      const sftp = accept();
      const fail = (id, error) => sftp.status(id, error?.code === "ENOENT" ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE, error?.message);
      sftp.on("REALPATH", async (id, path) => {
        try {
          const target = await realpath(local(path === "." ? "/" : path));
          const root = await realpath(remoteRoot);
          sftp.name(id, [{ filename: "/" + relative(root, target).split(sep).join("/"), longname: "", attrs: {} }]);
        } catch (error) { fail(id, error); }
      });
      sftp.on("STAT", async (id, path) => { try { sftp.attrs(id, attrs(await stat(local(path)))); } catch (e) { fail(id, e); } });
      sftp.on("LSTAT", async (id, path) => { try { sftp.attrs(id, attrs(await stat(local(path)))); } catch (e) { fail(id, e); } });
      sftp.on("OPENDIR", async (id, path) => { try { const rows = await readdir(local(path)); const key = String(++sequence); handles.set(key, { rows, path }); sftp.handle(id, Buffer.from(key)); } catch (e) { fail(id, e); } });
      sftp.on("READDIR", async (id, handle) => { const entry = handles.get(handle.toString()); if (!entry?.rows.length) { sftp.status(id, STATUS_CODE.EOF); return; } const rows = entry.rows.splice(0); sftp.name(id, await Promise.all(rows.map(async (name) => ({ filename: name, longname: name, attrs: attrs(await stat(local(posix.join(entry.path, name)))) })))); });
      sftp.on("OPEN", async (id, path, flags) => { try { const file = await open(local(path), flags & 2 ? "w" : "r"); const key = String(++sequence); handles.set(key, { file }); sftp.handle(id, Buffer.from(key)); } catch (e) { fail(id, e); } });
      sftp.on("READ", async (id, handle, offset, length) => { try { const buffer = Buffer.alloc(Math.min(length, 64 * 1024)); const { bytesRead } = await handles.get(handle.toString()).file.read(buffer, 0, buffer.length, offset); if (bytesRead) sftp.data(id, buffer.subarray(0, bytesRead)); else sftp.status(id, STATUS_CODE.EOF); } catch (e) { fail(id, e); } });
      sftp.on("WRITE", async (id, handle, offset, data) => { try { await handles.get(handle.toString()).file.write(data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK); } catch (e) { fail(id, e); } });
      sftp.on("CLOSE", async (id, handle) => { const entry = handles.get(handle.toString()); handles.delete(handle.toString()); await entry?.file?.close(); sftp.status(id, STATUS_CODE.OK); });
      sftp.on("MKDIR", async (id, path) => { try { await mkdir(local(path)); sftp.status(id, STATUS_CODE.OK); } catch (e) { fail(id, e); } });
    });
  }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const ssh = new SshHost(metadata);
let passed = 0;
async function check(name, job) { await job(); passed++; console.log(`ok ${passed} - ${name}`); }
try {
  const probe = await ssh.probe("127.0.0.1", port);
  await check("real SSH key probe returns SHA256 fingerprint before authentication", async () => assert.match(probe.fingerprint, /^SHA256:/));
  await check("changed fingerprint fails before authenticated connection", async () => assert.rejects(ssh.connect({ host: "127.0.0.1", port, username: "qa", password: "fixture-password", fingerprint: "SHA256:" + "A".repeat(43), folder: "/project" })));
  const connected = await ssh.connect({ host: "127.0.0.1", port, username: "qa", password: "fixture-password", fingerprint: probe.fingerprint, folder: "/project" });
  const id = connected.profile.id;
  await check("real SSH password authentication and SFTP folder validation", async () => assert.equal(connected.folder, "/project"));
  await check("saved profile does not contain password, private key or passphrase", async () => assert.doesNotMatch(await readFile(join(metadata, "ssh-connections.json"), "utf8"), /fixture-password|passphrase|BEGIN RSA/));
  await check("SSH exec routes cwd and preserves nonzero exit", async () => { const run = await ssh.exec(id, "/project", "fail-test"); assert.equal(run.exitCode, 7); assert.match(run.output, /remote failure/); });
  await check("SSH cancellation terminates pending exec", async () => { const controller = new AbortController(); const run = ssh.exec(id, "/project", "sleep-test", { signal: controller.signal }); setTimeout(() => controller.abort(), 50); await assert.rejects(run, /aborted/); });
  await check("SFTP reads bytes from remote host", async () => assert.equal((await ssh.read(id, "/project/sample.txt")).toString(), "first\nsecond\nthird\n"));
  await check("SFTP writes remote files including new parents", async () => { await ssh.write(id, "/project/new/file.txt", "新文件"); assert.equal(await readFile(join(remoteRoot, "project/new/file.txt"), "utf8"), "新文件"); });
  await check("remote file listing carries SSH identity", async () => { const listing = await ssh.list(id, "/project"); assert(listing.entries.some((row) => row.path === remotePath(id, "/project/sample.txt"))); });
  await check("remote URI encodes special and non-ASCII names", async () => assert.deepEqual(parseRemotePath(remotePath(id, "/project/a #中.txt")), { id, path: "/project/a #中.txt" }));
  const store = new WorkspaceStore(metadata, ssh);
  const remote = await store.remote(id, "Remote QA", "/project");
  const tools = new Map();
  registerRemoteTools({ registerTool: (tool) => tools.set(tool.name, tool) }, ssh, remote);
  await check("all filesystem and shell tools are overridden for remote sessions", async () => assert.deepEqual([...tools.keys()].sort(), ["bash", "powershell", "edit", "find", "grep", "ls", "read", "write"].sort()));
  await check("remote agent read uses offset and limit", async () => assert.equal((await tools.get("read").execute("test", { path: "sample.txt", offset: 2, limit: 1 })).content[0].text, "second\n\n[Showing lines 2-2 of 4; continue with offset=3.]"));
  await check("remote agent edit is exact and refuses ambiguous text", async () => { await tools.get("edit").execute("test", { path: "sample.txt", oldText: "second", newText: "changed" }); assert.match((await ssh.read(id, "/project/sample.txt")).toString(), /changed/); await ssh.write(id, "/project/repeat.txt", "a a"); await assert.rejects(tools.get("edit").execute("test", { path: "repeat.txt", oldText: "a", newText: "b" }), /not unique/); });
  await mkdir(join(remoteRoot, "related"));
  await check("additional remote roots persist and stay on same SSH host", async () => { await store.add(remote.cwd, "/related"); assert.equal((await store.get(remote.cwd)).folders.length, 2); await assert.rejects(store.add(remote.cwd, remotePath("other-host", "/related")), /same SSH/); });
  await mkdir(join(remoteRoot, "project-other"));
  await symlink(join(remoteRoot, "project-other"), join(remoteRoot, "project", "escape"), process.platform === "win32" ? "junction" : "dir");
  await check("remote membership rejects siblings, traversal, symlink escapes and other hosts", async () => {
    for (const path of ["/project-other", "/project/../project-other", "/project/escape", remotePath("other-host", "/project")]) await assert.rejects(store.resolveRemote(remote.cwd, path), /outside|another workspace/);
    assert.equal((await store.resolveRemote(remote.cwd, "/related")).path, "/related");
  });
  await check("saved SSH profiles remain available while workspaces reference them", async () => assert.rejects(store.assertSshUnused(id), /Remove the workspaces/));
  const localA = join(directory, "a"); const localB = join(directory, "b"); await mkdir(localA); await mkdir(localB); await writeFile(join(localB, "b.txt"), "b");
  await check("local multi-root workspace resolves related project files", async () => { await store.add(localA, localB); const target = await store.resolveLocal(localA, join(localB, "b.txt")); assert.equal(target.path, await realpath(join(localB, "b.txt"))); });
  await check("workspace primary folder cannot be removed", async () => assert.rejects(store.remove(localA, localA), /primary/));
  await check("outside paths are rejected", async () => assert.rejects(store.resolveLocal(localA, join(remoteRoot, "project/sample.txt")), /outside/));
  await check("stable folder membership generates stable model prefix", async () => { let callback; registerWorkspaceContext({ on: (_event, listener) => { callback = listener; } }, await store.get(localA)); assert.deepEqual(await callback({ systemPrompt: "base" }), await callback({ systemPrompt: "base" })); });
  await check("shell quoting preserves hostile apostrophes literally", async () => assert.equal(quoteShell("a'b; $(x)"), "'a'\\''b; $(x)'"));
  await check("remote PowerShell is also routed through SSH", async () => { const response = await tools.get("powershell").execute("test", { command: "Get-Location" }); assert.match(response.content[0].text, /REMOTE:.*pwsh/); assert.equal(response.details.remote, true); });
  await check("SSH terminal creates a remote PTY with replay", async () => { const terminal = await ssh.spawn(id, "/project", remote.cwd); assert(terminal.id?.startsWith("ssh-")); await new Promise((resolve) => setTimeout(resolve, 100)); assert.match(ssh.replay(terminal.id), /REMOTE:.*SHELL/); ssh.kill(terminal.id); });
  await mkdir(join(remoteRoot, "project/deep/nested"), { recursive: true });
  await writeFile(join(remoteRoot, "project/deep/nested/leaf.txt"), "leaf");
  await check("remote @ search walks nested roots level-by-level and keeps ssh identity", async () => {
    const hits = await ssh.search(id, ["/project"]);
    const paths = hits.map((row) => parseRemotePath(row.path).path);
    assert(paths.includes("/project/sample.txt"));
    assert(paths.includes("/project/deep/nested/leaf.txt"));
    assert(!paths.some((path) => path.startsWith("/project-other")));
  });
  await check("connected profile remembers the workspace folder for reconnection", async () => assert.equal((await ssh.profilesList()).find((profile) => profile.id === id).folder, "/project"));
  const sdk = await import("@earendil-works/pi-coding-agent");
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd: remote.cwd, agentDir: metadata, extensionFactories: [sdk.createCodemodeExtension(), { name: "qa-remote", factory: (pi) => registerRemoteTools(pi, ssh, remote) }] });
  await resourceLoader.reload();
  const { session: sdkSession } = await sdk.createAgentSession({ cwd: remote.cwd, agentDir: metadata, resourceLoader, settingsManager: sdk.SettingsManager.create(remote.cwd, metadata), sessionManager: sdk.SessionManager.inMemory(remote.cwd) });
  try {
    await sdkSession.bindExtensions({});
    await check("real pi SDK session replaces local built-ins with SSH tool definitions", async () => { const definition = sdkSession.getToolDefinition("read"); assert.equal(definition.label, "SSH read"); const response = await definition.execute("sdk-remote", { path: "sample.txt", limit: 1 }, undefined, undefined, { cwd: remote.cwd }); assert.match(response.content[0].text, /^first/); assert.equal(sdkSession.getToolDefinition("powershell").label, "SSH PowerShell"); });
  } finally { sdkSession.dispose(); }
  await ssh.disconnect(id);
  await check("disconnected remote tools fail instead of executing locally", async () => assert.rejects(tools.get("read").execute("test", { path: "sample.txt" }), /disconnected/));
  await check("disconnected @ search fails loudly instead of listing nothing", async () => assert.rejects(ssh.search(id, ["/project"]), /disconnected|readFile|readdir/));
  await check("disconnected profiles retire stale connection progress", async () => assert.equal((await ssh.profilesList()).find((profile) => profile.id === id).phase, undefined));
  await store.delete(remote.cwd);
  await check("deleted remote metadata never becomes a local workspace", async () => {
    await assert.rejects(store.get(remote.cwd), /metadata is missing/);
    await assert.rejects(store.resolveLocal(remote.cwd, remote.cwd), /metadata is missing/);
    await store.assertSshUnused(id);
  });
  await check("folder switches cannot dispose active agents, compaction, shells or delegated tasks", async () => {
    let disposed = 0;
    const host = Object.assign(Object.create(PiHost.prototype), { cwd: localA, runtime: { session: {} }, detachedRunning: new Set(), fleet: [], dispose: async () => { disposed++; } });
    for (const field of ["isStreaming", "isCompacting", "isBashRunning"]) {
      host.runtime.session = { [field]: true };
      await assert.rejects(host.setCwd(localB), /active tasks/);
      assert.equal(host.getCwd(), localA);
      // Staying in the same workspace may still start a parked new chat.
      await host.setCwd(localA);
    }
    host.runtime.session = {};
    host.detachedRunning.add("parked-task");
    await assert.rejects(host.setCwd(localB), /active tasks/);
    host.detachedRunning.clear();
    host.fleet = [{ status: "running" }];
    await assert.rejects(host.setCwd(localB), /active tasks/);
    assert.equal(disposed, 0);
  });
  await check("corrupt connection metadata is quarantined instead of bricking the panel", async () => {
    const dir = join(directory, "corrupt-ssh");
    await mkdir(dir);
    await writeFile(join(dir, "ssh-connections.json"), "{not json");
    assert.deepEqual(await new SshHost(dir).profilesList(), []);
    assert((await readdir(dir)).some((name) => name.startsWith("ssh-connections.json.corrupt-")));
  });
  await check("corrupt workspace metadata starts empty instead of failing forever", async () => {
    const dir = join(directory, "corrupt-store");
    await mkdir(dir);
    await writeFile(join(dir, "desktop-workspaces.json"), "[bad");
    const fallback = await new WorkspaceStore(dir, ssh).get(join(dir, "anywhere"));
    assert.equal(fallback.folders.length, 1);
    assert((await readdir(dir)).some((name) => name.startsWith("desktop-workspaces.json.corrupt-")));
  });
  console.log(`${passed} remote/workspace checks passed`);
} finally {
  ssh.dispose();
  for (const client of clients) client.end();
  await new Promise((resolve) => server.close(resolve));
  for (const entry of handles.values()) await entry.file?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
