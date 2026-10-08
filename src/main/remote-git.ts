import type { GitBranches, GitResult, GitState } from "../shared/workspace";
import { noRepoBranches, noRepoState } from "./git";
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
  async mutate(action: "checkout" | "create" | "delete" | "commit" | "push", value = ""): Promise<GitResult> {
    try {
      if (["checkout", "create", "delete"].includes(action)) {
        if (!value.trim() || value.trim().startsWith("-")) throw new Error("Invalid branch name.");
        await this.run(["check-ref-format", "--branch", value.trim()]);
      }
      let output: string;
      if (action === "checkout") output = await this.run(["switch", "--", value.trim()]);
      else if (action === "create") output = await this.run(["switch", "-c", value.trim()]);
      else if (action === "delete") output = await this.run(["branch", "-d", "--", value.trim()]);
      else if (action === "commit") { if (!value.trim()) throw new Error("Empty commit message."); await this.run(["add", "-A"]); output = await this.run(["commit", "-m", value.trim()]); }
      else { try { output = await this.run(["push"], 600); } catch (error) { if (!/no upstream branch|has no upstream/i.test(String(error))) throw error; output = await this.run(["push", "--set-upstream", "origin", "HEAD"], 600); } }
      return { ok: true, output: output.trim() };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
