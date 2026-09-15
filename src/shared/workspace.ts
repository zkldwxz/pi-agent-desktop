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
}
