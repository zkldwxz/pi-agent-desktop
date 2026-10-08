import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import ssh2 from "ssh2";
import type { Client, ClientChannel, ConnectConfig, SFTPWrapper, Stats } from "ssh2";
const { Client: SshClient } = ssh2;
import type { SshConnectInput, SshProbe, SshProfile } from "../shared/workspaces.ts";
import type { DirListing, FileContent, TerminalResult } from "../shared/workspace";
import type { PtySession } from "../shared/terminal";
import { parseRemotePath, remotePath } from "../shared/workspaces.ts";
import { languageFor } from "./fs-browser";

const OUTPUT_LIMIT = 512 * 1024;
const SKIP = new Set(["node_modules", ".git", "dist", "out", ".cache", ".venv", "__pycache__"]);
export const quoteShell = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const fingerprintOf = (key: Buffer) => `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

function endpoint(host: string, port = 22) {
  if (typeof host !== "string" || !host.trim() || /[\s\0]/.test(host)) throw new Error("SSH host is required.");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("SSH port must be between 1 and 65535.");
  return { host: host.trim(), port };
}

interface Connection { profile: SshProfile; client: Client; sftp: SFTPWrapper }
interface Terminal { session: PtySession; channel: ClientChannel; buffer: string; connectionId: string }

/** SSH and SFTP stay in the main process; saved profiles never contain secrets. */
export class SshHost {
  private readonly connections = new Map<string, Connection>();
  private readonly profiles = new Map<string, SshProfile>();
  private readonly terminals = new Map<string, Terminal>();
  private loaded: Promise<void> | undefined;
  private saveQueue: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string, private readonly onData: (id: string, data: string) => void = () => {}, private readonly onExit: (id: string, code: number) => void = () => {}, private readonly onChange: () => void = () => {}) {}

  private load() {
    return this.loaded ??= (async () => {
      const path = join(this.directory, "ssh-connections.json");
      try {
        const rows = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(rows)) throw new Error("Invalid SSH connection metadata.");
        for (const row of rows) {
          if (typeof row.id !== "string" || typeof row.username !== "string") continue;
          const { host, port } = endpoint(row.host, row.port);
          this.profiles.set(row.id, { id: row.id, name: String(row.name || host), host, port, username: row.username, privateKeyPath: typeof row.privateKeyPath === "string" ? row.privateKeyPath : undefined, fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : undefined, folder: typeof row.folder === "string" ? row.folder : undefined, status: "disconnected" });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        // A corrupt metadata file must not brick the SSH panel until someone
        // deletes it by hand: quarantine it and continue with no saved hosts.
        await rename(path, `${path}.corrupt-${Date.now()}.bak`).catch(() => {});
        console.warn("[pi-desktop] quarantined unreadable ssh-connections.json:", error instanceof Error ? error.message : String(error));
      }
    })();
  }
  async profilesList(): Promise<SshProfile[]> { await this.load(); return [...this.profiles.values()].map((row) => ({ ...row })); }
  private save() {
    const rows = [...this.profiles.values()].map(({ status: _s, error: _e, phase: _p, ...metadata }) => metadata);
    const work = this.saveQueue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, "ssh-connections.json");
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, path);
    });
    this.saveQueue = work.catch(() => {});
    return work;
  }

  /** Discovery ends before authentication. A changed host key is never auto-accepted. */
  probe(host: string, port = 22): Promise<SshProbe> {
    const target = endpoint(host, port);
    return new Promise((resolve, reject) => {
      const client = new SshClient();
      let found = false;
      client.on("error", (error) => { if (!found) { client.end(); reject(error); } });
      client.connect({ ...target, username: "pi-key-probe", readyTimeout: 12_000, hostVerifier: (key: Buffer) => {
        found = true;
        let algorithm = "SSH";
        if (key.length >= 4) { const size = key.readUInt32BE(0); algorithm = key.subarray(4, 4 + size).toString(); }
        resolve({ fingerprint: fingerprintOf(key), algorithm });
        return false;
      } });
    });
  }

  async connect(input: SshConnectInput): Promise<{ profile: SshProfile; folder: string }> {
    await this.load();
    const target = endpoint(input.host, input.port ?? 22);
    if (!input.username?.trim() || /[\0\r\n]/.test(input.username)) throw new Error("SSH username is required.");
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint)) throw new Error("Probe and verify the SSH host fingerprint first.");
    const id = input.id ?? randomUUID();
    const previous = this.profiles.get(id);
    if (previous?.fingerprint && previous.fingerprint !== input.fingerprint) throw new Error("SSH host key changed. Remove this saved connection and verify the new fingerprint.");
    const profile: SshProfile = { id, name: input.name?.trim() || `${input.username}@${target.host}`, ...target, username: input.username.trim(), privateKeyPath: input.privateKeyPath || undefined, fingerprint: input.fingerprint, status: "connecting" };
    await this.disconnect(id);
    this.profiles.set(id, profile);
    this.onChange();
    const client = new SshClient();
    client.on("handshake", () => { profile.phase = "authenticating"; this.onChange(); });
    profile.phase = "connecting";
    client.on("error", () => {}); // ssh2 can emit a late error while a rejected handshake closes.
    try {
      const privateKey = input.privateKeyPath ? await readFile(input.privateKeyPath) : undefined;
      const config: ConnectConfig = { ...target, username: profile.username, privateKey, passphrase: input.passphrase || undefined, password: input.password || undefined, agent: !privateKey && !input.password ? (process.env.SSH_AUTH_SOCK || (process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined)) : undefined, readyTimeout: 20_000, keepaliveInterval: 15_000, keepaliveCountMax: 3, hostVerifier: (key: Buffer) => fingerprintOf(key) === input.fingerprint, tryKeyboard: Boolean(input.password) };
      if (input.password) client.on("keyboard-interactive", (_n, _i, _l, prompts, finish) => finish(prompts.map(() => input.password!)));
      await new Promise<void>((resolve, reject) => { client.once("ready", resolve); client.once("error", reject); client.connect(config); });
      profile.phase = "opening-sftp"; this.onChange();
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
      profile.phase = "checking-folder"; this.onChange();
      const home = await new Promise<string>((resolve, reject) => sftp.realpath(".", (error, path) => error ? reject(error) : resolve(path)));
      const requested = input.folder === "~" || !input.folder ? home : input.folder.startsWith("~/") ? posix.join(home, input.folder.slice(2)) : input.folder;
      if (!posix.isAbsolute(requested) || requested.includes("\0")) throw new Error("Remote folder must be an absolute POSIX path.");
      const folder = await new Promise<string>((resolve, reject) => sftp.realpath(requested, (error, path) => error ? reject(error) : resolve(path)));
      const stats = await new Promise<Stats>((resolve, reject) => sftp.stat(folder, (error, info) => error ? reject(error) : resolve(info)));
      if (!stats.isDirectory()) throw new Error("Remote workspace path is not a directory.");
      profile.status = "connected";
      profile.phase = "ready";
      // Remember the resolved folder: a reconnect that defaults back to "~"
      // would hash to a different workspace anchor and strand the old history.
      profile.folder = folder;
      this.connections.set(id, { client, sftp, profile });
      const closed = () => {
        if (this.connections.get(id)?.client !== client) return;
        this.connections.delete(id);
        profile.status = "disconnected";
        profile.phase = undefined;
        this.onChange();
      };
      client.on("close", closed);
      client.on("end", closed);
      client.on("error", (error) => { if (this.connections.get(id)?.client === client) { profile.error = error.message; closed(); } });
      await this.save();
      this.onChange();
      return { profile: { ...profile }, folder };
    } catch (error) {
      client.end();
      profile.status = "error";
      profile.error = error instanceof Error ? error.message : String(error);
      this.onChange();
      throw error;
    }
  }
  async disconnect(id: string) {
    for (const [terminalId, terminal] of this.terminals) if (terminal.connectionId === id) this.kill(terminalId);
    const connection = this.connections.get(id);
    this.connections.delete(id);
    connection?.client.end();
    const profile = this.profiles.get(id);
    if (profile) { profile.status = "disconnected"; profile.phase = undefined; }
    this.onChange();
  }
  async remove(id: string) { await this.load(); await this.disconnect(id); this.profiles.delete(id); await this.save(); }
  connection(id: string) { const connection = this.connections.get(id); if (!connection) throw new Error("SSH disconnected. Reconnect before using remote tools."); return connection; }

  async stat(id: string, path: string) { return new Promise<Stats>((resolve, reject) => this.connection(id).sftp.stat(path, (e, v) => e ? reject(e) : resolve(v))); }
  async realpath(id: string, path: string) { return new Promise<string>((resolve, reject) => this.connection(id).sftp.realpath(path, (e, v) => e ? reject(e) : resolve(v))); }
  async read(id: string, path: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
    const info = await this.stat(id, path);
    if (!info.isFile()) throw new Error("Remote path is not a file.");
    if (info.size > maxBytes) throw new Error(`Remote file exceeds ${maxBytes} bytes; read a bounded range with bash.`);
    const stream = this.connection(id).sftp.createReadStream(path);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0;
      stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) stream.destroy(new Error("Remote file grew beyond the read limit.")); else chunks.push(chunk); });
      stream.once("error", reject); stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  }
  async write(id: string, path: string, content: string) {
    if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error("Remote write exceeds 8MB.");
    const connection = this.connection(id);
    const parent = posix.dirname(path);
    const segments = parent.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      try { await this.stat(id, current); } catch { await new Promise<void>((resolve, reject) => connection.sftp.mkdir(current, (error) => error ? reject(error) : resolve())); }
    }
    await new Promise<void>((resolve, reject) => connection.sftp.writeFile(path, content, (e) => e ? reject(e) : resolve()));
  }
  async list(id: string, path: string, showAll = false): Promise<DirListing> {
    const rows = await new Promise<import("ssh2").FileEntry[]>((resolve, reject) => this.connection(id).sftp.readdir(path, (e, v) => e ? reject(e) : resolve(v)));
    const entries = rows.filter((r) => r.filename !== "." && r.filename !== ".." && (showAll || (!r.filename.startsWith(".") && !SKIP.has(r.filename)))).map((r) => ({ name: r.filename, path: remotePath(id, posix.join(path, r.filename)), kind: (r.attrs.mode & 0o170000) === 0o040000 ? "dir" as const : "file" as const, size: r.attrs.size, modified: new Date(r.attrs.mtime * 1000).toISOString() })).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "dir" ? -1 : 1);
    return { path: remotePath(id, path), parent: path === "/" ? null : remotePath(id, posix.dirname(path)), entries: entries.slice(0, 500), truncated: entries.length > 500 };
  }
  async fileView(id: string, path: string): Promise<FileContent> {
    const info = await this.stat(id, path);
    const stream = this.connection(id).sftp.createReadStream(path, { start: 0, end: OUTPUT_LIMIT - 1 });
    const chunks: Buffer[] = [];
    const buffer = await new Promise<Buffer>((resolve, reject) => { stream.on("data", (v: Buffer) => chunks.push(v)); stream.once("end", () => resolve(Buffer.concat(chunks))); stream.once("error", reject); });
    const binary = buffer.includes(0);
    return { path: remotePath(id, path), name: posix.basename(path), lang: languageFor(path), text: binary ? "" : buffer.toString("utf8"), size: info.size, truncated: info.size > OUTPUT_LIMIT, binary };
  }
  async search(id: string, roots: string[], limit = 4000): Promise<{ path: string; modified: number }[]> {
    const hits: { path: string; modified: number }[] = [];
    let frontier = roots.map((path) => ({ path, depth: 0 }));
    while (frontier.length && hits.length < limit) {
      // One batch per BFS level: directories within a level are independent,
      // so concurrent SFP reads replace a serial round trip per directory —
      // on a slow link the @ menu waited seconds for a plain readdir walk.
      const batch = await Promise.all(frontier.map(async (directory) => {
        try {
          return { directory, listing: await this.list(id, directory.path) };
        } catch (error) {
          // A dropped connection must surface: swallowing it here made the @
          // menu read as an empty repository instead of a dead link.
          if (!this.connections.has(id)) throw error;
          return { directory, listing: null as DirListing | null };
        }
      }));
      const next: Array<{ path: string; depth: number }> = [];
      for (const { directory, listing } of batch) {
        if (!listing) continue;
        for (const entry of listing.entries) {
          const parsed = parseRemotePath(entry.path)!;
          if (entry.kind === "dir") { if (directory.depth < 8) next.push({ path: parsed.path, depth: directory.depth + 1 }); }
          else if (hits.length < limit) hits.push({ path: entry.path, modified: Date.parse(entry.modified || "") || 0 });
        }
      }
      frontier = next;
    }
    return hits;
  }
  exec(id: string, cwd: string, command: string, options: { signal?: AbortSignal; timeout?: number; onData?: (text: string) => void; maxBytes?: number } = {}): Promise<TerminalResult> {
    const connection = this.connection(id);
    options.signal?.throwIfAborted();
    const started = Date.now();
    const runId = randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false, channel: ClientChannel | undefined, total = 0, output = "", truncated = false, cancelled = false;
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
      const finish = (error?: Error, exitCode?: number) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve({ runId, command, output, exitCode, truncated, cancelled, durationMs: Date.now() - started }); };
      const abort = () => { cancelled = true; channel?.signal("TERM"); channel?.close(); finish(new DOMException("SSH command aborted", "AbortError")); };
      const timer = setTimeout(() => { channel?.signal("TERM"); channel?.close(); finish(new Error("SSH command timed out.")); }, Math.max(1, options.timeout ?? 120) * 1000);
      options.signal?.addEventListener("abort", abort, { once: true });
      connection.client.exec(`cd -- ${quoteShell(cwd)} && ${command}`, (error, stream) => {
        if (error) { finish(error); return; }
        channel = stream;
        if (settled) { stream.close(); return; }
        const data = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          options.onData?.(text);
          total += chunk.length;
          const budget = options.maxBytes ?? OUTPUT_LIMIT;
          output += text;
          if (total > budget) { truncated = true; output = output.slice(-budget); }
        };
        stream.on("data", data); stream.stderr.on("data", data); stream.on("error", (error: Error) => finish(error)); stream.on("close", (code: number | undefined) => finish(undefined, code));
      });
    });
  }
  async spawn(id: string, cwd: string, owner: string): Promise<PtySession | { error: string }> {
    try {
      const channel = await new Promise<ClientChannel>((resolve, reject) => this.connection(id).client.exec(`cd -- ${quoteShell(cwd)} && exec \"\${SHELL:-/bin/sh}\" -l`, { pty: { term: "xterm-256color", cols: 80, rows: 24 } }, (e, v) => e ? reject(e) : resolve(v)));
      const terminalId = `ssh-${randomUUID()}`;
      const session: PtySession = { id: terminalId, cwd: owner, title: `SSH · ${this.connection(id).profile.name}`, shell: "ssh", status: "running", startedAt: Date.now() };
      const entry: Terminal = { session, channel, buffer: "", connectionId: id };
      this.terminals.set(terminalId, entry);
      const data = (chunk: Buffer) => { const text = chunk.toString("utf8"); entry.buffer = (entry.buffer + text).slice(-200 * 1024); this.onData(terminalId, text); };
      channel.on("data", data); channel.stderr.on("data", data); channel.on("error", () => {});
      channel.on("close", (code: number | undefined) => { session.status = "exited"; session.exitCode = code ?? 1; this.onExit(terminalId, code ?? 1); });
      return session;
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
  listTerminals(owner: string) { return [...this.terminals.values()].filter((entry) => entry.session.cwd === owner).map((entry) => ({ ...entry.session })); }
  replay(id: string) { return this.terminals.get(id)?.buffer ?? ""; }
  writeTerminal(id: string, data: string) { this.terminals.get(id)?.channel.write(data); }
  resize(id: string, cols: number, rows: number) { this.terminals.get(id)?.channel.setWindow(Math.max(4, Math.round(rows)), Math.max(20, Math.round(cols)), 0, 0); }
  kill(id: string) { const entry = this.terminals.get(id); entry?.channel.close(); this.terminals.delete(id); }
  dispose() { for (const id of this.connections.keys()) void this.disconnect(id); }
}
