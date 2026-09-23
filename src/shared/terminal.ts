/**
 * A real terminal, one PTY per tab, grouped by the folder that opened it.
 */
export interface PtySession {
  id: string;
  /** the project folder this shell was started in — its isolation key */
  cwd: string;
  title: string;
  shell: string;
  status: "running" | "exited";
  exitCode?: number;
  startedAt: number;
}

/** A shell a terminal tab can start in, as the main process discovered it. */
export interface TerminalShell {
  /** stable key: "wsl:Ubuntu", "gitbash", "powershell", "cmd", "custom" */
  id: string;
  kind: "wsl" | "gitbash" | "powershell" | "cmd" | "custom";
  /** what the tab and the menu call it */
  name: string;
  path: string;
  /** launch arguments (WSL needs -d <distro>) */
  args: string[];
  available: boolean;
  /** the WSL distribution name, when this entry is one */
  detail?: string;
}

export interface PtyData {
  id: string;
  data: string;
}

export interface PtyExit {
  id: string;
  exitCode: number;
}
