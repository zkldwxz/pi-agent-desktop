import type { GitBranches, GitChanges, GitDiff, GitDiscardFile, GitResult, GitState } from "../shared/workspace";
import { noRepoChanges } from "../shared/workspace.ts";
import { noRepoBranches, noRepoState, parseChanges } from "./git";
import { SshHost, quoteShell } from "./remote-ssh";

export class RemoteGit {
  constructor(private readonly ssh: SshHost, private readonly id: string, private readonly cwd: string) {}
  private async run(args: string[], timeout?: number) {
    const result = await this.ssh.exec(this.id, this.cwd, ["git", ...args].map(quoteShell).join(" "), { timeout });
    if (result.exitCode !== 0) throw new Error(result.output.trim() || `Remote git exited ${result.exitCode}`);
    return result.output;
  }
  async status(): Promise<GitState> {
    const state = noRepoState();
    let output: string;
    try { output = await this.run(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]); }
    catch (error) { if (/not a git repository/i.test(String(error))) return state; throw error; }
    state.repo = true;
    for (const line of output.split("\n")) {
      if (line.startsWith("# branch.head ")) { const head = line.slice(14).trim(); state.detached = head === "(detached)"; state.branch = state.detached || head === "(missing)" ? null : head; }
      else if (line.startsWith("# branch.upstream ")) state.hasUpstream = true;
      else if (line.startsWith("# branch.ab ")) { const match = /\+(\d+) -(\d+)/.exec(line); if (match) { state.ahead = Number(match[1]); state.behind = Number(match[2]); } }
      else if (/^[12u?] /.test(line)) state.changed++;
    }
    try { const output = await this.run(["diff", "--shortstat", "HEAD"]); state.added = Number(/(\d+) insertions?/.exec(output)?.[1] ?? 0); state.removed = Number(/(\d+) deletions?/.exec(output)?.[1] ?? 0); } catch {}
    return state;
  }
  async branches(): Promise<GitBranches> {
    let output: string;
    try { output = await this.run(["for-each-ref", "--format=%(refname:short)%00%(HEAD)", "refs/heads/"]); }
    catch (error) { if (/not a git repository/i.test(String(error))) return noRepoBranches(); throw error; }
    const branches = output.split("\n").filter(Boolean).map((line) => { const [name, head] = line.split("\0"); return { name, current: head.trim() === "*" }; });
    return { repo: true, current: branches.find((branch) => branch.current)?.name ?? null, detached: !branches.some((branch) => branch.current), branches };
  }
  async mutate(action: "checkout" | "create" | "delete" | "commit" | "push", value = "", paths?: string[]): Promise<GitResult> {
    try {
      if (["checkout", "create", "delete"].includes(action)) {
        if (!value.trim() || value.trim().startsWith("-")) throw new Error("Invalid branch name.");
        await this.run(["check-ref-format", "--branch", value.trim()]);
      }
      let output: string;
      if (action === "checkout") output = await this.run(["switch", "--", value.trim()]);
      else if (action === "create") output = await this.run(["switch", "-c", value.trim()]);
      else if (action === "delete") output = await this.run(["branch", "-d", "--", value.trim()]);
      else if (action === "commit") {
        if (!value.trim()) throw new Error("Empty commit message.");
        if (paths?.length) {
          await this.run(["add", "--", ...paths]);
          output = await this.run(["commit", "-m", value.trim(), "--", ...paths]);
        } else {
          await this.run(["add", "-A"]);
          output = await this.run(["commit", "-m", value.trim()]);
        }
      }
      else { try { output = await this.run(["push"], 600); } catch (error) { if (!/no upstream branch|has no upstream/i.test(String(error))) throw error; output = await this.run(["push", "--set-upstream", "origin", "HEAD"], 600); } }
      return { ok: true, output: output.trim() };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  /** file-level working tree state — the same porcelain v2 pass as local */
  async changes(): Promise<GitChanges> {
    let output: string;
    try { output = await this.run(["status", "--porcelain=v2", "--untracked-files=normal", "-z"]); }
    catch (error) { if (/not a git repository/i.test(String(error))) return noRepoChanges(); throw error; }
    return parseChanges(output);
  }

  /**
   * A file's patch. Untracked diffs go through `--no-index` against
   * `/dev/null` — POSIX remotes only — and exit 1 is "difference found",
   * so this bypasses `run`'s non-zero throw and reads the output itself.
   */
  async diff(path: string, flags: { staged?: boolean; untracked?: boolean } = {}): Promise<GitDiff> {
    const args = flags.untracked
      ? ["diff", "--no-index", "--", "/dev/null", path]
      : flags.staged
        ? ["diff", "--cached", "--", path]
        : ["diff", "--", path];
    try {
      const result = await this.ssh.exec(this.id, this.cwd, ["git", ...args].map(quoteShell).join(" "));
      const diff = result.output.length > MAX_REMOTE_DIFF ? result.output.slice(0, MAX_REMOTE_DIFF) : result.output;
      return { path, staged: Boolean(flags.staged), diff, truncated: result.output.length > MAX_REMOTE_DIFF };
    } catch (error) {
      return { path, staged: Boolean(flags.staged), diff: "", truncated: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** stage / unstage / discard by path, mirroring git.ts */
  async mutateFiles(action: "stage" | "unstage" | "discard", files: GitDiscardFile[]): Promise<GitResult> {
    try {
      if (!files.length) throw new Error("No files.");
      if (action === "stage") await this.run(["add", "--", ...files.map((file) => file.path)]);
      else if (action === "unstage") {
        try { await this.run(["restore", "--staged", "--", ...files.map((file) => file.path)]); }
        catch (error) {
          if (!/could not resolve|ambiguous argument|unknown revision|unborn/i.test(String(error))) throw error;
          await this.run(["rm", "--cached", "-q", "--", ...files.map((file) => file.path)]);
        }
      } else {
        const tracked = files.filter((file) => !file.untracked).map((file) => file.path);
        const untracked = files.filter((file) => file.untracked).map((file) => file.path);
        if (tracked.length) await this.run(["restore", "--staged", "--worktree", "--", ...tracked]);
        if (untracked.length) await this.run(["clean", "-f", "--", ...untracked]);
      }
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}

/** remote diffs ride a shell channel; the same panel cap applies */
const MAX_REMOTE_DIFF = 512 * 1024;
