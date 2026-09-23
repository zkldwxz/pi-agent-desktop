import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitBranches, GitResult, GitState } from "@shared/workspace";

const run = promisify(execFile);

/** a bounded walk of the working tree is enough for a status line */
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Run git with argv, never a shell.
 *
 * The renderer used to compose `git commit -m ${JSON.stringify(message)}` and
 * hand it to the agent's bash. JSON quotes are not shell quotes, so that broke
 * on every Windows shell; passing argv to `execFile` removes the whole class of
 * problem, and `--` stops a branch name being read as an option.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, windowsHide: true, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** git's own words, which is where the useful part of a failure is. */
function failure(error: unknown): string {
  const { stderr, stdout } = (error ?? {}) as { stderr?: unknown; stdout?: unknown };
  /* `git commit` reports "nothing to commit" on stdout, so an empty stderr does
   * not mean an uninformative failure — the message is just on the other stream */
  for (const stream of [stderr, stdout]) {
    const text = typeof stream === "string" ? stream.trim() : "";
    if (text) return text.split("\n").slice(0, 3).join("\n");
  }
  return error instanceof Error ? error.message.replace(/^Command failed: .*/, "git failed") : String(error);
}

/** not a repository is a state of the workspace, not an error worth a toast */
function notRepo(error: unknown): boolean {
  return /not a git repository/i.test(failure(error));
}

/** what a workspace without git reports — the environment section then shows nothing */
export function noRepoState(): GitState {
  return { repo: false, branch: null, detached: false, changed: 0, added: 0, removed: 0, ahead: 0, behind: 0, hasUpstream: false };
}

export function noRepoBranches(): GitBranches {
  return { repo: false, current: null, detached: false, branches: [] };
}

/**
 * `git status --porcelain=v2 --branch` in one pass.
 *
 * The v2 header carries the branch, its upstream and the ahead/behind counts, so
 * the panel's environment row does not need three round trips to say the same
 * thing. Entry lines are one per path, which is the honest definition of
 * "changed" for a working tree.
 */
export async function gitStatus(cwd: string): Promise<GitState> {
  let out: string;
  try {
    out = await git(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
  } catch (error) {
    if (notRepo(error)) return noRepoState();
    throw new Error(failure(error));
  }
  let branch: string | null = null;
  let detached = false;
  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  let changed = 0;
  for (const line of out.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      detached = head === "(detached)";
      branch = detached || head === "(missing)" ? null : head;
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      hasUpstream = line.slice("# branch.upstream ".length).trim().length > 0;
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      // "+N -M": the commit count the two ends differ by
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (line[0] === "1" || line[0] === "2" || line[0] === "u" || line[0] === "?") changed += 1;
  }
  /* the line movement the panel reports: tracked edits, in either direction.
   * Untracked files have no diff yet, so `--shortstat` alone is the number. */
  let added = 0;
  let removed = 0;
  try {
    const stat = await git(cwd, ["diff", "--shortstat", "HEAD"]);
    const numbers = /(\d+) insertions?\(\+\)/.exec(stat);
    const deletions = /(\d+) deletions?\(-\)/.exec(stat);
    added = numbers ? Number(numbers[1]) : 0;
    removed = deletions ? Number(deletions[1]) : 0;
  } catch {
    // no HEAD yet (a repository with no commits) still has a valid status
  }
  return { repo: true, branch, detached, changed, added, removed, ahead, behind, hasUpstream };
}

/** local branches — the menu's whole universe */
export async function gitBranches(cwd: string): Promise<GitBranches> {
  let out: string;
  try {
    out = await git(cwd, ["for-each-ref", "--format=%(refname:short)%00%(HEAD)", "refs/heads/"]);
  } catch (error) {
    if (notRepo(error)) return noRepoBranches();
    throw new Error(failure(error));
  }
  const branches: GitBranches["branches"] = [];
  let current: string | null = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [name, head] = line.split("\0");
    if (!name) continue;
    const at = head?.trim() === "*";
    if (at) current = name;
    branches.push({ name, current: at });
  }
  branches.sort((a, b) => (a.current === b.current ? a.name.localeCompare(b.name) : a.current ? -1 : 1));
  return { repo: true, current, detached: !current, branches };
}

/**
 * Refuse anything git would read as a flag.
 *
 * `--` already stops argv injection, but a name starting with `-` is confusing
 * enough at the UI level to reject outright; `check-ref-format` handles the rest
 * with git's own rules rather than a copy of them.
 */
async function assertBranchName(cwd: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith("-")) throw new Error(`Invalid branch name: ${name}`);
  try {
    await git(cwd, ["check-ref-format", "--branch", trimmed]);
  } catch {
    throw new Error(`Invalid branch name: ${trimmed}`);
  }
}

export async function gitCheckout(cwd: string, name: string): Promise<GitResult> {
  try {
    await assertBranchName(cwd, name);
    const out = await git(cwd, ["switch", "--", name.trim()]);
    return { ok: true, output: out.trim() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

/** create and move onto it — a branch you stay behind on is not what "new" means */
export async function gitCreateBranch(cwd: string, name: string): Promise<GitResult> {
  try {
    await assertBranchName(cwd, name);
    /* no `--` here: `git switch -c X -- Y` reads Y as the start point, not the
     * name. The leading-dash check above is what keeps it out of option parsing */
    const out = await git(cwd, ["switch", "-c", name.trim()]);
    return { ok: true, output: out.trim() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

/**
 * Delete with `-d`, not `-D`.
 *
 * Unmerged work must not vanish because a click landed on the wrong row: git's
 * own safety check is the second confirmation, and its error says why.
 */
export async function gitDeleteBranch(cwd: string, name: string): Promise<GitResult> {
  try {
    await assertBranchName(cwd, name);
    const out = await git(cwd, ["branch", "-d", "--", name.trim()]);
    return { ok: true, output: out.trim() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

export async function gitCommit(cwd: string, message: string): Promise<GitResult> {
  const text = message.trim();
  if (!text) return { ok: false, error: "Empty commit message" };
  try {
    await git(cwd, ["add", "-A"]);
    const out = await git(cwd, ["commit", "-m", text]);
    return { ok: true, output: out.trim() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

/**
 * Push, setting upstream the first time.
 *
 * A branch that has never been pushed is the common case in this app — the
 * commit control creates branches — and plain `git push` only errors with a
 * suggestion. `HEAD` keeps the remote's branch name equal to the local one
 * without reading either.
 */
export async function gitPush(cwd: string): Promise<GitResult> {
  try {
    const out = await git(cwd, ["push"]);
    return { ok: true, output: out.trim() };
  } catch (error) {
    const message = failure(error);
    if (!/no upstream branch|has no upstream/i.test(message)) return { ok: false, error: message };
    try {
      const out = await git(cwd, ["push", "--set-upstream", "origin", "HEAD"]);
      return { ok: true, output: out.trim() };
    } catch (retryError) {
      return { ok: false, error: `${message}\n${failure(retryError)}` };
    }
  }
}
