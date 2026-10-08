import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkspaceInfo, WorkspaceFolder } from "../shared/workspaces.ts";
import { parseRemotePath, remotePath } from "../shared/workspaces.ts";
import type { SshHost } from "./remote-ssh";

const pathKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);

/** Workspace membership is saved on the host, not inferred from open tabs. */
export class WorkspaceStore {
  private records = new Map<string, WorkspaceInfo>();
  private ready: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string, private readonly ssh: SshHost) {}
  private load() {
    return this.ready ??= (async () => {
      const path = join(this.directory, "desktop-workspaces.json");
      try {
        const data = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(data)) throw new Error("Invalid workspace metadata.");
        for (const record of data) {
          if (typeof record.cwd !== "string" || !Array.isArray(record.folders) || !record.folders.length || typeof record.id !== "string") continue;
          this.records.set(pathKey(record.cwd), record);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        // Quarantine an unreadable file instead of failing every workspace
        // lookup forever; remote anchors report a clear error on their own.
        await rename(path, `${path}.corrupt-${Date.now()}.bak`).catch(() => {});
        console.warn("[pi-desktop] quarantined unreadable desktop-workspaces.json:", error instanceof Error ? error.message : String(error));
      }
    })();
  }
  private save() {
    const data = JSON.stringify([...this.records.values()], null, 2) + "\n";
    const next = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, "desktop-workspaces.json");
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, path);
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async get(cwd: string): Promise<WorkspaceInfo> {
    await this.load();
    const record = this.records.get(pathKey(cwd));
    // A remote session anchor is local metadata, never a local project. Missing
    // metadata must fail closed rather than silently changing every transport.
    const anchor = relative(resolve(this.directory, "remote-workspaces"), resolve(cwd));
    if (!record && (!anchor || (anchor !== ".." && !anchor.startsWith(`..${sep}`) && !isAbsolute(anchor)))) throw new Error("SSH workspace metadata is missing. Reconnect before opening this workspace.");
    return record ? { ...record, folders: record.folders.map((folder) => ({ ...folder })) } : { id: createHash("sha256").update(pathKey(cwd)).digest("hex").slice(0, 16), name: basename(cwd) || cwd, cwd, folders: [{ name: basename(cwd) || cwd, path: cwd }] };
  }
  async list() { await this.load(); return [...this.records.values()].map((record) => ({ ...record, folders: record.folders.map((folder) => ({ ...folder })) })); }
  async remote(id: string, name: string, folder: string) {
    await this.load();
    const key = createHash("sha256").update(`${id}\n${folder}`).digest("hex").slice(0, 24);
    const cwd = join(this.directory, "remote-workspaces", key);
    await mkdir(cwd, { recursive: true });
    const existing = this.records.get(pathKey(cwd));
    const record: WorkspaceInfo = existing ?? { id: key, name, cwd, sshId: id, folders: [{ name: folder.split("/").filter(Boolean).at(-1) || "/", path: remotePath(id, folder) }] };
    this.records.set(pathKey(cwd), record);
    await this.save();
    return record;
  }
  async add(cwd: string, path: string) {
    const record = await this.get(cwd);
    let folder: WorkspaceFolder;
    if (record.sshId) {
      const parsed = parseRemotePath(path);
      if (parsed && parsed.id !== record.sshId) throw new Error("All remote folders in a workspace must use the same SSH connection.");
      const target = await this.ssh.realpath(record.sshId, parsed?.path ?? path);
      const info = await this.ssh.stat(record.sshId, target);
      if (!info.isDirectory()) throw new Error("Workspace folder must be a directory.");
      folder = { name: target.split("/").filter(Boolean).at(-1) || "/", path: remotePath(record.sshId, target) };
    } else {
      if (parseRemotePath(path)) throw new Error("Create an SSH workspace before adding remote folders.");
      const target = await realpath(path);
      if (!(await stat(target)).isDirectory()) throw new Error("Workspace folder must be a directory.");
      folder = { name: basename(target) || target, path: target };
    }
    const key = (value: string) => record.sshId ? value : pathKey(value);
    if (!record.folders.some((row) => key(row.path) === key(folder.path))) record.folders.push(folder);
    this.records.set(pathKey(cwd), record);
    await this.save();
    return record;
  }
  async remove(cwd: string, path: string) {
    const record = await this.get(cwd);
    if (record.folders[0].path === path) throw new Error("The primary workspace folder cannot be removed. Open another workspace instead.");
    record.folders = record.folders.filter((folder) => folder.path !== path);
    this.records.set(pathKey(cwd), record);
    await this.save();
    return record;
  }
  async rename(cwd: string, name: string) {
    const record = await this.get(cwd);
    if (!name.trim() || name.length > 120) throw new Error("Workspace name must contain 1–120 characters.");
    record.name = name.trim();
    this.records.set(pathKey(cwd), record);
    await this.save();
    return record;
  }
  async assertSshUnused(id: string) {
    await this.load();
    if ([...this.records.values()].some((record) => record.sshId === id)) throw new Error("Remove the workspaces using this SSH connection before removing the saved connection.");
  }
  async delete(cwd: string) { await this.load(); this.records.delete(pathKey(cwd)); await this.save(); }
  async resolveLocal(cwd: string, target: string): Promise<{ root: string; path: string }> {
    const record = await this.get(cwd);
    if (record.sshId) throw new Error("This workspace uses remote files.");
    const candidate = await realpath(isAbsolute(target) ? resolve(target) : resolve(record.folders[0].path, target));
    for (const folder of record.folders) {
      // Canonicalize before membership: Windows may return an 8.3 spelling for
      // temp paths, while the picker and SFTP metadata use long names.
      const root = await realpath(folder.path);
      const diff = relative(root, candidate);
      if (!diff || (diff !== ".." && !diff.startsWith(`..${sep}`) && !isAbsolute(diff))) return { root, path: candidate };
    }
    throw new Error("Path is outside the workspace folders.");
  }
  async resolveRemote(cwd: string, target: string): Promise<{ id: string; path: string; root: string }> {
    const record = await this.get(cwd);
    if (!record.sshId) throw new Error("This workspace is local.");
    const parsed = parseRemotePath(target);
    if (parsed && parsed.id !== record.sshId) throw new Error("SSH path belongs to another workspace.");
    const requested = parsed?.path ?? target;
    const actual = await this.ssh.realpath(record.sshId, requested);
    for (const folder of record.folders) {
      const root = parseRemotePath(folder.path)!.path;
      if (actual === root || actual.startsWith(root.endsWith("/") ? root : `${root}/`)) return { id: record.sshId, path: actual, root };
    }
    throw new Error("Path is outside the remote workspace folders.");
  }
}
