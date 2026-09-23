import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { IPty } from "node-pty";
import type { PtySession } from "@shared/terminal";

/**
 * Real terminals.
 *
 * One PTY per tab, owned by the folder that opened them. The panel is a view
 * onto a process that keeps running when you switch projects or close the dock,
 * so a dev server started in one folder carries on there and is nowhere to be
 * found in another.
 *
 * node-pty is loaded lazily and only when a tab is actually opened. Its native
 * half is a prebuilt binary that may be missing on a platform this project does
 * not ship for, and a terminal that will not start is a panel showing one line
 * of text — not a reason to fail app startup.
 */

const require = createRequire(import.meta.url);

/** Raw output kept per session, replayed when the panel re-attaches to it. */
const REPLAY_LIMIT = 200 * 1024;

interface Entry {
  session: PtySession;
  proc: IPty;
  buffer: string;
}

let ptyModule: typeof import("node-pty") | undefined;
let ptyLoadError: string | undefined;

function loadPty(): typeof import("node-pty") | undefined {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) return undefined;
  try {
    ptyModule = require("node-pty") as typeof import("node-pty");
    return ptyModule;
  } catch (error) {
    ptyLoadError = error instanceof Error ? error.message : String(error);
    return undefined;
  }
}

/** The shell a new tab starts in, when nothing more specific was asked for.
 *  The platform's own interactive shell — PowerShell on Windows, $SHELL
 *  elsewhere. The caller normally passes a shell resolved by shells.ts
 *  (discovered, or the user's preference); this is the boot-time fallback. */
export function defaultShell(configured?: string): string {
  if (configured && existsSync(configured)) return configured;
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(powershell)) return powershell;
    return process.env.COMSPEC ?? join(systemRoot, "System32", "cmd.exe");
  }
  return process.env.SHELL || "/bin/bash";
}

export class PtyHost {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, exitCode: number) => void,
  ) {}

  /** Every shell belonging to one folder, oldest first. */
  list(cwd: string): PtySession[] {
    return [...this.entries.values()]
      .filter((entry) => sameFolder(entry.session.cwd, cwd))
      .map((entry) => entry.session);
  }

  /**
   * Start a shell in `cwd`. Returns the session, or an error string the panel
   * can show inline — a terminal that cannot fork is not worth a dialog.
   *
   * `shell` is what shells.ts resolved (discovered entry, preference, or
   * custom path) and carries its launch args — WSL needs `-d <distro>` — and
   * the name the tab should show.
   */
  spawn(
    cwd: string,
    shell?: { path: string; args?: string[]; name?: string },
  ): PtySession | { error: string } {
    const pty = loadPty();
    if (!pty) return { error: ptyLoadError ?? "node-pty is not available on this machine." };

    const dir = existsSync(cwd) ? cwd : homedir();
    const path = shell?.path && existsSync(shell.path) ? shell.path : defaultShell();
    const args = shell?.path === path ? (shell.args ?? []) : [];
    const id = createHash("sha1").update(`${Date.now()}${this.entries.size}`).digest("hex").slice(0, 12);

    let proc: IPty;
    try {
      proc = pty.spawn(path, args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: dir,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TERM_PROGRAM: "pi-agent-desktop",
        } as Record<string, string>,
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }

    const session: PtySession = {
      id,
      cwd: dir,
      title: shell?.name ?? basename(path).replace(/\.exe$/i, ""),
      shell: path,
      status: "running",
      startedAt: Date.now(),
    };
    const entry: Entry = { session, proc, buffer: "" };
    this.entries.set(id, entry);

    proc.onData((data) => {
      entry.buffer += data;
      if (entry.buffer.length > REPLAY_LIMIT) {
        // trim at a line boundary so the replay does not start mid-escape-code
        const cut = entry.buffer.indexOf("\n", entry.buffer.length - REPLAY_LIMIT);
        entry.buffer = cut > 0 ? entry.buffer.slice(cut + 1) : entry.buffer.slice(-REPLAY_LIMIT);
      }
      this.onData(id, data);
    });

    proc.onExit(({ exitCode }) => {
      entry.session = { ...entry.session, status: "exited", exitCode };
      this.onExit(id, exitCode);
    });

    return session;
  }

  /** Everything the session has printed so far, so a remounted panel catches up. */
  replay(id: string): string {
    return this.entries.get(id)?.buffer ?? "";
  }

  write(id: string, data: string): void {
    try {
      this.entries.get(id)?.proc.write(data);
    } catch {
      /* the shell already exited */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.session.status !== "running") return;
    try {
      entry.proc.resize(Math.max(20, Math.round(cols)), Math.max(4, Math.round(rows)));
    } catch {
      /* resizing a process that just died is normal */
    }
  }

  kill(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      entry.proc.kill();
    } catch {
      /* already gone */
    }
    this.entries.delete(id);
  }

  /** Shells belong to folders, not to the panel that happens to be looking. */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.kill(id);
  }
}

/** Windows paths are case-insensitive; the same folder must not get two lists. */
function sameFolder(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return normalize(a) === normalize(b);
}
