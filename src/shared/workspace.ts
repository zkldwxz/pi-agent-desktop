export type PanelTab = "chats" | "files" | "terminal" | "plans";

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  modified?: string;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
  error?: string;
}

export interface FileContent {
  path: string;
  name: string;
  /** language hint derived from the extension, for the code viewer */
  lang: string;
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  error?: string;
}

export interface TerminalChunk {
  runId: string;
  delta: string;
}

export interface TerminalResult {
  runId: string;
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  /** ms */
  durationMs: number;
}

export interface TerminalRunState {
  running: boolean;
  runId?: string;
  command?: string;
}

/**
 * An application the operating system will open a file with.
 *
 * `id` is `reveal`, `default`, or the executable path of a registered app — the
 * main process resolves it, and the viewer sends the same id back to launch it.
 */
export interface AppOpener {
  id: string;
  name: string;
  kind: "reveal" | "default" | "app";
  command?: string;
  /** the application's own icon, extracted from the executable — a data URL */
  icon?: string;
}

/**
 * The workspace's git state, read straight from `git status --porcelain=v2`.
 *
 * A workspace that is not a repository is a normal case, so `repo` is false
 * rather than an error — the monitor's environment section collapses to nothing.
 */
export interface GitState {
  repo: boolean;
  /** the checked-out branch, or null when detached or before the first commit */
  branch: string | null;
  detached: boolean;
  /** paths with movement in the working tree, including untracked ones */
  changed: number;
  /** line movement across tracked files */
  added: number;
  removed: number;
  ahead: number;
  behind: number;
  /** false until the branch has been pushed once — `git push` needs `-u` then */
  hasUpstream: boolean;
}

export interface GitBranches {
  repo: boolean;
  current: string | null;
  detached: boolean;
  branches: Array<{ name: string; current: boolean }>;
}

/** the shape every git mutation returns: git's output, or git's complaint */
export interface GitResult {
  ok: boolean;
  output?: string;
  error?: string;
}
