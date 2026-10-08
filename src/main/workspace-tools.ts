import { posix } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorkspaceInfo } from "../shared/workspaces.ts";
import { parseRemotePath } from "../shared/workspaces.ts";
import { SshHost, quoteShell } from "./remote-ssh";
import { cleanShellOutput, cutHeadAndTail, cutTail, BUDGETS } from "./agent-tools/policy";

const result = (text: string, isError = false, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text }], details, ...(isError ? { isError } : {}) });
const PATH = Type.String({ description: "Remote POSIX path, relative to the primary folder or absolute" });
const LIMIT = Type.Optional(Type.Number({ minimum: 1, maximum: 2000 }));

/** Every filesystem tool is overridden together, so SSH can never fall back to local I/O. */
export function registerRemoteTools(pi: ExtensionAPI, ssh: SshHost, workspace: WorkspaceInfo) {
  const id = workspace.sshId!;
  const root = parseRemotePath(workspace.folders[0].path)!.path;
  const pathOf = (path: string) => {
    const remote = parseRemotePath(path);
    if (remote && remote.id !== id) throw new Error("File belongs to a different SSH connection.");
    const value = remote?.path ?? path;
    if (value.includes("\0")) throw new Error("Invalid remote path.");
    return posix.resolve(root, value);
  };
  pi.registerTool({ name: "bash", label: "SSH bash", executionMode: "sequential", description: "Execute a shell command in the remote workspace through SSH. Output is cleaned and bounded to 20KB; failures retain their exit code. Relative paths use the primary remote folder. No command runs locally.", promptSnippet: "Execute commands on the SSH host", parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })) }), async execute(_call, args, signal, update) {
    let preview = "";
    const run = await ssh.exec(id, root, args.command, { signal, timeout: args.timeout, maxBytes: 256 * 1024, onData: (chunk) => { preview = (preview + cleanShellOutput(chunk)).slice(-BUDGETS.bash.maxBytes); update?.(result(preview)); } });
    const clean = cleanShellOutput(run.output);
    const cut = run.truncated ? cutTail(clean, BUDGETS.bash.maxBytes) : cutHeadAndTail(clean, BUDGETS.bash.maxBytes, BUDGETS.bash.headBytes);
    return result(`${cut.text}${cut.truncated || run.truncated ? "\n\n[Output truncated; rerun with a narrower query or redirect output to a remote file and read it.]" : ""}${run.exitCode !== 0 ? `\n[Exit code: ${run.exitCode ?? "unknown"}]` : ""}`, run.exitCode !== 0, { exitCode: run.exitCode, remote: true });
  } });
  pi.registerTool({ name: "powershell", label: "SSH PowerShell", executionMode: "sequential", description: "Execute PowerShell on the SSH host using pwsh. Requires PowerShell installed on the remote host; otherwise use bash. Never runs on the local machine.", parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })) }), async execute(_call, args, signal) {
    const run = await ssh.exec(id, root, `pwsh -NoProfile -NonInteractive -Command ${quoteShell(args.command)}`, { signal, timeout: args.timeout, maxBytes: BUDGETS.bash.maxBytes });
    return result(cleanShellOutput(run.output), run.exitCode !== 0, { remote: true, exitCode: run.exitCode, truncated: run.truncated });
  } });
  pi.registerTool({ name: "read", label: "SSH read", description: "Read text or image files on the SSH host. Text is bounded to 24KB; continue with the returned line offset. Relative paths use the primary remote folder.", promptSnippet: "Read files on the SSH host", parameters: Type.Object({ path: PATH, offset: Type.Optional(Type.Number({ minimum: 1 })), limit: LIMIT }), async execute(_call, args, signal) {
    signal?.throwIfAborted();
    const path = pathOf(args.path);
    const buffer = await ssh.read(id, path);
    signal?.throwIfAborted();
    const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
    if (mime[posix.extname(path).toLowerCase()]) return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: mime[posix.extname(path).toLowerCase()] }], details: { remote: true } };
    if (buffer.includes(0)) return result("Binary file; use a remote command to inspect it.");
    const lines = buffer.toString("utf8").split("\n");
    const offset = Math.max(0, (args.offset ?? 1) - 1);
    if (offset >= lines.length) throw new Error(`offset exceeds ${lines.length} lines.`);
    const take = lines.slice(offset, offset + (args.limit ?? 2000));
    const selected: string[] = []; let size = 0;
    for (const line of take) { const bytes = Buffer.byteLength(line + "\n"); if (size + bytes > BUDGETS.read.maxBytes) break; selected.push(line); size += bytes; }
    if (!selected.length) throw new Error("First line exceeds 24KB. Read a bounded byte range with bash.");
    const next = offset + selected.length;
    return result(selected.join("\n") + (next < lines.length ? `\n\n[Showing lines ${offset + 1}-${next} of ${lines.length}; continue with offset=${next + 1}.]` : ""), false, { remote: true });
  } });
  pi.registerTool({ name: "write", label: "SSH write", executionMode: "sequential", description: "Write a UTF-8 file on the SSH host. Creates parent directories. Use absolute paths to work in an additional workspace folder.", promptSnippet: "Write files on the SSH host", parameters: Type.Object({ path: PATH, content: Type.String() }), async execute(_call, args, signal) { signal?.throwIfAborted(); const path = pathOf(args.path); await ssh.write(id, path, args.content); return result(`Wrote ${Buffer.byteLength(args.content)} bytes to ${path}.`); } });
  pi.registerTool({ name: "edit", label: "SSH edit", executionMode: "sequential", description: "Replace one exact occurrence of oldText with newText in a remote UTF-8 file. Fails when oldText is missing or occurs more than once.", promptSnippet: "Edit files on the SSH host", parameters: Type.Object({ path: PATH, oldText: Type.String(), newText: Type.String() }), async execute(_call, args, signal) {
    signal?.throwIfAborted();
    if (!args.oldText) throw new Error("oldText must not be empty.");
    const path = pathOf(args.path); const old = await ssh.read(id, path); if (old.includes(0)) throw new Error("Cannot edit a binary file.");
    const text = old.toString("utf8"); const index = text.indexOf(args.oldText);
    if (index < 0) throw new Error("oldText was not found in the remote file.");
    if (text.indexOf(args.oldText, index + args.oldText.length) >= 0) throw new Error("oldText is not unique; include more surrounding text.");
    signal?.throwIfAborted();
    // The second read detects most external edits rather than overwriting stale content.
    if (!(await ssh.read(id, path)).equals(old)) throw new Error("Remote file changed while editing; read it again.");
    const next = text.slice(0, index) + args.newText + text.slice(index + args.oldText.length);
    await ssh.write(id, path, next);
    return result(`Edited ${path}.`, false, { diff: `-${args.oldText}\n+${args.newText}`, remote: true });
  } });
  pi.registerTool({ name: "ls", label: "SSH ls", description: "List a remote directory through SFTP; hidden entries are included. At most 500 entries.", parameters: Type.Object({ path: Type.Optional(PATH) }), async execute(_call, args, signal) { signal?.throwIfAborted(); const listing = await ssh.list(id, pathOf(args.path || "."), true); return result(listing.entries.map((row) => `${row.name}${row.kind === "dir" ? "/" : ""}`).join("\n") + (listing.truncated ? "\n[Directory listing truncated at 500 entries.]" : "")); } });
  pi.registerTool({ name: "grep", label: "SSH grep", description: "Search remote files with ripgrep (rg must be installed on the SSH host). Output is bounded to 16KB. Pattern is passed as an argument, not shell code.", parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(PATH), glob: Type.Optional(Type.String()), ignoreCase: Type.Optional(Type.Boolean()), literal: Type.Optional(Type.Boolean()), limit: LIMIT }), async execute(_call, args, signal) {
    const flags = ["rg", "--line-number", "--color=never", "--max-count", String(args.limit ?? 100), ...(args.ignoreCase ? ["-i"] : []), ...(args.literal ? ["-F"] : []), ...(args.glob ? ["--glob", args.glob] : []), "--", args.pattern, pathOf(args.path || ".")];
    const run = await ssh.exec(id, root, flags.map(quoteShell).join(" "), { signal, maxBytes: BUDGETS.grep.maxBytes });
    return result(cleanShellOutput(run.output) || (run.exitCode === 1 ? "No matches found." : ""), run.exitCode !== 0 && run.exitCode !== 1, { remote: true, truncated: run.truncated });
  } });
  pi.registerTool({ name: "find", label: "SSH find", description: "Find remote files using a glob via ripgrep (rg required). Output is bounded; use path to narrow a large tree.", parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(PATH), limit: LIMIT }), async execute(_call, args, signal) {
    const run = await ssh.exec(id, root, ["rg", "--files", "--hidden", "--glob", "!.git", "--glob", args.pattern, "--", pathOf(args.path || ".")].map(quoteShell).join(" "), { signal, maxBytes: 16 * 1024 });
    return result(run.output.split("\n").slice(0, args.limit ?? 1000).join("\n"), run.exitCode !== 0 && run.exitCode !== 1, { remote: true, truncated: run.truncated });
  } });
}

/** This text is deterministic for unchanged membership, preserving the prompt prefix. */
export function registerWorkspaceContext(pi: ExtensionAPI, workspace: WorkspaceInfo, getWorkspace?: () => Promise<WorkspaceInfo>) {
  pi.on("before_agent_start", async (event) => {
    const current = getWorkspace ? await getWorkspace() : workspace;
    const paths = current.folders.map((folder) => parseRemotePath(folder.path)?.path ?? folder.path);
    const context = `\n\nWorkspace folders (${current.sshId ? "SSH remote; all file and shell tools execute on the remote host" : "local"}):\n${paths.map((path) => `- ${JSON.stringify(path)}`).join("\n")}\nThe first folder is the default working directory. Use absolute paths for files in additional folders. Related projects in these folders can be inspected and edited in this conversation.`;
    return { systemPrompt: event.systemPrompt + context };
  });
}
