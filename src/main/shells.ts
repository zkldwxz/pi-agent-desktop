import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TerminalShell } from "@shared/terminal";

/**
 * The shells a terminal tab can start in — discovered, not defaulted.
 *
 * pi's own bash tool resolves Git Bash first (that is a POSIX shell for the
 * *agent*); a terminal panel answers a different question — which shell does
 * this human want to sit in — so the candidates are the ones a Windows user
 * actually has: WSL distributions, Git Bash, PowerShell, cmd, and a custom
 * path. Nothing is forced: the list shows what exists on this machine, and
 * the preference only biases which one the plain "+" opens.
 */

/** `wsl.exe` prints UTF-16LE on most builds; a UTF-8 read leaves \x00 in every
 *  character, so distributions would parse as "U\x00b\x00u\x00n\x00t\x00u". */
function decodeWslOutput(buffer: Buffer): string {
  const hasUtf16 = buffer.length >= 2 && buffer[1] === 0;
  return (hasUtf16 ? buffer.toString("utf16le") : buffer.toString("utf8"))
    .replace(/\x00/g, "")
    .replace(/\r/g, "");
}

async function wslDistributions(wslPath: string): Promise<string[]> {
  try {
    const { stdout: out } = await execFileAsync(wslPath, ["-l", "-q"], {
      encoding: "buffer",
      timeout: 5000,
      windowsHide: true,
    });
    return decodeWslOutput(out)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("Windows Subsystem"));
  } catch {
    return [];
  }
}

async function onPath(executable: string): Promise<string | undefined> {
  try {
    const { stdout: out } = await execFileAsync("where", [executable], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const first = out.trim().split(/\r?\n/)[0];
    return first && existsSync(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

/** The legacy System32 bash.exe is WSL's first-generation bridge, not Git
 *  Bash — pi's shell util treats it the same way (stdin transport, no -c). */
function isLegacyWslBash(path: string): boolean {
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(path.replace(/\//g, "\\").toLowerCase());
}

async function gitBashPath(): Promise<string | undefined> {
  const candidates = [
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const onPathBash = await onPath("bash.exe");
  if (onPathBash && !isLegacyWslBash(onPathBash)) return onPathBash;
  return undefined;
}

async function powerShellPath(): Promise<{ path: string; name: string } | undefined> {
  const pwsh = await onPath("pwsh.exe");
  if (pwsh) return { path: pwsh, name: "PowerShell 7" };
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const windowsPowerShell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync(windowsPowerShell)) return { path: windowsPowerShell, name: "Windows PowerShell" };
  return undefined;
}

function cmdPath(): string | undefined {
  const comspec = process.env.COMSPEC;
  if (comspec && existsSync(comspec)) return comspec;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const cmd = join(systemRoot, "System32", "cmd.exe");
  return existsSync(cmd) ? cmd : undefined;
}

/** Every shell this machine offers, ordered the way the "+" menu shows them —
 *  and, because "auto" takes the first available, ordered the way a default
 *  should be chosen: Git Bash first (pi's own preference), then PowerShell,
 *  cmd, and WSL last (its list includes internal distributions like
 *  docker-desktop, which are poor interactive shells and must not win by
 *  accident). */
async function probeTerminalShells(): Promise<TerminalShell[]> {
  const shells: TerminalShell[] = [];

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const wsl = join(systemRoot, "System32", "wsl.exe");
    const [gitBash, powershell, distributions] = await Promise.all([
      gitBashPath(), powerShellPath(), existsSync(wsl) ? wslDistributions(wsl) : Promise.resolve([]),
    ]);
    if (gitBash) {
      shells.push({ id: "gitbash", kind: "gitbash", name: "Git Bash", path: gitBash, args: [], available: true });
    }

    if (powershell) {
      shells.push({
        id: "powershell",
        kind: "powershell",
        name: powershell.name,
        path: powershell.path,
        args: [],
        available: true,
      });
    }

    const cmd = cmdPath();
    if (cmd) {
      shells.push({ id: "cmd", kind: "cmd", name: "Command Prompt", path: cmd, args: [], available: true });
    }

    if (existsSync(wsl)) {
      for (const distro of distributions) {
        shells.push({
          id: `wsl:${distro}`,
          kind: "wsl",
          name: `WSL · ${distro}`,
          path: wsl,
          args: ["-d", distro],
          available: true,
          detail: distro,
        });
      }
    }
  } else {
    const userShell = process.env.SHELL || "/bin/bash";
    shells.push({
      id: "system",
      kind: "custom",
      name: "System shell",
      path: userShell,
      args: [],
      available: existsSync(userShell),
    });
    for (const candidate of ["/bin/bash", "/bin/zsh", "/usr/bin/fish"]) {
      if (candidate !== userShell && existsSync(candidate)) {
        shells.push({
          id: `path:${candidate}`,
          kind: "custom",
          name: candidate.split("/").pop() ?? candidate,
          path: candidate,
          args: [],
          available: true,
        });
      }
    }
  }

  return shells;
}

/**
 * The one shell a plain "new terminal" starts.
 *
 * Resolution order, mirroring pi's own philosophy of "configured, else
 * sensible, never forced": the custom path when one is set and exists, else
 * the preferred entry when it is still available, else the first thing the
 * machine actually has — PowerShell before cmd, because that is the Windows
 * convention, and pi's agent bash is a separate concern.
 */
let shellCache: { at: number; shells: TerminalShell[] } | undefined;
let shellProbe: Promise<TerminalShell[]> | undefined;

/** Async probes keep slow WSL startup off Electron's UI thread. */
export function discoverTerminalShells(): Promise<TerminalShell[]> {
  if (shellCache && Date.now() - shellCache.at < 10_000) return Promise.resolve(shellCache.shells);
  if (!shellProbe) {
    shellProbe = probeTerminalShells().then((shells) => {
      shellCache = { at: Date.now(), shells };
      return shells;
    }).finally(() => { shellProbe = undefined; });
  }
  return shellProbe;
}

export function resolveTerminalShell(
  preferred: string,
  customPath: string | undefined,
  shells: TerminalShell[],
): TerminalShell | undefined {
  if (customPath && customPath.trim() && existsSync(customPath.trim())) {
    const path = customPath.trim();
    return {
      id: "custom",
      kind: "custom",
      name: path.split(/[\\/]/).pop() ?? "Shell",
      path,
      args: [],
      available: true,
    };
  }
  const match = preferred !== "auto" ? shells.find((shell) => shell.id === preferred) : undefined;
  if (match?.available) return match;
  return shells.find((shell) => shell.available);
}
