import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { shell } from "electron";
import type { AppOpener } from "@shared/workspace";

/**
 * "Open with" for the file viewer.
 *
 * The list is whatever the operating system has registered for that file type —
 * which is the point: the file manager, Cursor, VS Code, an editor the user
 * installed last week are all already registered, and re-declaring them here
 * would go stale the moment the user's machine changes.
 *
 * On Windows that means reading the registry: the machine-wide and per-user
 * "Open with" lists for the extension, the shell command each ProgID points at,
 * and the application keys of the editors people actually install. macOS and
 * Linux have no equivalent registry, so the list falls back to the default
 * application plus whatever editor binaries are on PATH. Every probe is
 * best-effort — a missing key is not an error.
 */

const REG_TIMEOUT_MS = 4000;
/** discovery walks the registry once per extension, then answers from memory */
const cache = new Map<string, { at: number; openers: AppOpener[] }>();
const CACHE_MS = 60_000;

function regQuery(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("reg", args, { timeout: REG_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

/** Pull `name` (or `(Default)` when omitted) out of `reg query` output. */
function regValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{2,}REG_[A-Z_]+\s{2,}(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const wantDefault = name === "";
    if ((wantDefault && key === "(Default)") || (!wantDefault && key.toLowerCase() === name.toLowerCase())) {
      return match[2].trim();
    }
  }
  return undefined;
}

/** every value name in `reg query` output, used for the multi-valued lists */
function regNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s{2,}REG_[A-Z_]+\s{2,}/.exec(line);
    if (match) names.push(match[1].trim());
  }
  return names;
}

/**
 * The executable a shell command launches.
 *
 * Commands are stored as `"C:\...\Code.exe" "%1"`, so the executable is either
 * the quoted first token or everything before the first space. Launching the exe
 * with the file as an argument (rather than running the command template through
 * a shell) keeps a path containing spaces or quotes from becoming an injection.
 */
function executableFrom(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  const quoted = /^"([^"]+\.exe)"/i.exec(trimmed);
  if (quoted) return quoted[1];
  const bare = /^([^\s]+\.exe)(\s|$)/i.exec(trimmed);
  if (bare) return bare[1];
  const first = trimmed.split(/\s+/)[0];
  return first.replace(/^"|"$/g, "") || undefined;
}

function prettyName(exe: string): string {
  const file = basename(exe).replace(/\.exe$/i, "");
  const known: Record<string, string> = {
    code: "Visual Studio Code",
    "code - insiders": "VS Code Insiders",
    cursor: "Cursor",
    windsurf: "Windsurf",
    notepad: "Notepad",
    kiro: "Kiro",
    devenv: "Visual Studio",
  };
  return known[file.toLowerCase()] ?? file;
}

/**
 * Editors that register under `HKCR\Applications` without writing an entry for
 * every extension they can open.
 *
 * Probing the application key is what makes this reliable on a machine whose
 * editor lives somewhere unusual — VS Code in `D:\Vscode`, say — because the
 * path in the registry is the one the installer chose, not one we guessed.
 */
const WELL_KNOWN_APPS = [
  "Cursor.exe",
  "Code.exe",
  "Code - Insiders.exe",
  "Windsurf.exe",
  "Notepad++.exe",
  "Sublime Text.exe",
];

/** Well-known editors, so a fresh install is reachable even if the registry is thin. */
function knownEditors(): AppOpener[] {
  const local = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:/Program Files";
  const candidates: Array<[string, string]> = [
    [join(local, "Programs", "Microsoft VS Code", "Code.exe"), "Visual Studio Code"],
    [join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"), "VS Code Insiders"],
    [join(local, "Programs", "cursor", "Cursor.exe"), "Cursor"],
    [join(local, "Programs", "windsurf", "Windsurf.exe"), "Windsurf"],
    [join(programFiles, "Microsoft VS Code", "Code.exe"), "Visual Studio Code"],
    [join(programFiles, "cursor", "Cursor.exe"), "Cursor"],
  ];
  const found: AppOpener[] = [];
  for (const [path, name] of candidates) {
    if (!existsSync(path)) continue;
    found.push({ id: path.toLowerCase(), name, kind: "app", command: path });
  }
  return found;
}

async function windowsOpeners(target: string): Promise<AppOpener[]> {
  const ext = extname(target).toLowerCase();
  const openers: AppOpener[] = [];
  const seen = new Set<string>();

  const add = (opener: AppOpener) => {
    const key = opener.id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    openers.push(opener);
  };

  /* the shell command a ProgID runs, plus the friendliest name we can find */
  const fromProgId = async (progId: string) => {
    // ".ext" is an association, not a handler; AppX is a packaged app that only
    // Explorer can launch, and it needs a protocol we cannot drive.
    if (!progId || progId.startsWith(".") || progId.startsWith("AppX")) return;
    const command = regValue(await regQuery(["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]), "");
    const exe = command ? executableFrom(command) : undefined;
    if (!exe || !existsSync(exe)) return;
    const friendly = regValue(
      await regQuery(["query", `HKCR\\Applications\\${basename(exe)}\\FriendlyAppName`, "/ve"]),
      "",
    );
    // The ProgID's own description is the *file type* ("TypeScript source
    // file"), never the application, so the executable names the entry.
    add({ id: exe.toLowerCase(), name: friendly || prettyName(exe), kind: "app", command: exe });
  };

  if (ext) {
    /* The machine-wide list is where editors put themselves, and it is the only
     * place a source extension like .ts is registered at all. */
    const machine = await regQuery(["query", `HKCR\\${ext}\\OpenWithProgids`]);
    for (const name of regNames(machine)) await fromProgId(name);

    const userList = await regQuery([
      "query",
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\OpenWithProgids`,
    ]);
    for (const name of regNames(userList)) await fromProgId(name);

    /* the legacy OpenWithList stores application names on keys a, b, c… */
    const legacy = await regQuery(["query", `HKCR\\${ext}\\OpenWithList`]);
    for (const key of regNames(legacy)) {
      if (!/^[a-z]$/i.test(key)) continue;
      const appName = regValue(await regQuery(["query", `HKCR\\${ext}\\OpenWithList`, "/v", key]), key);
      if (!appName) continue;
      await fromProgId(appName);
      const fromApp = regValue(await regQuery(["query", `HKCR\\Applications\\${appName}\\shell\\open\\command`, "/ve"]), "");
      const exe = fromApp ? executableFrom(fromApp) : undefined;
      if (exe && existsSync(exe)) add({ id: exe.toLowerCase(), name: prettyName(exe), kind: "app", command: exe });
    }
  }

  for (const app of WELL_KNOWN_APPS) {
    const command = regValue(await regQuery(["query", `HKCR\\Applications\\${app}\\shell\\open\\command`, "/ve"]), "");
    const exe = command ? executableFrom(command) : undefined;
    if (exe && existsSync(exe)) add({ id: exe.toLowerCase(), name: prettyName(exe), kind: "app", command: exe });
  }

  for (const editor of knownEditors()) add(editor);
  return openers;
}

/** Executables on PATH — the macOS and Linux answer, where nothing is registered. */
async function pathEditors(): Promise<AppOpener[]> {
  const names = ["cursor", "code", "windsurf"];
  const found = await Promise.all(
    names.map(
      (name) =>
        new Promise<AppOpener | null>((resolve) => {
          execFile("which", [name], { timeout: 2000 }, (error, stdout) => {
            const path = stdout.split(/\r?\n/)[0]?.trim();
            resolve(!error && path ? { id: path.toLowerCase(), name: prettyName(name), kind: "app", command: path } : null);
          });
        }),
    ),
  );
  return found.filter((entry): entry is AppOpener => entry !== null);
}

/**
 * Applications registered for this file, most specific first.
 *
 * Always leads with the two entry points every platform has — reveal in the file
 * manager, and whatever is registered as the default — so the menu is never
 * empty even on a machine with nothing else installed.
 */
export async function listOpeners(target: string): Promise<AppOpener[]> {
  const ext = extname(target).toLowerCase();
  const cached = cache.get(`${process.platform}:${ext}`);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.openers;

  const discovered = process.platform === "win32" ? await windowsOpeners(target) : await pathEditors();
  const openers: AppOpener[] = [
    { id: "reveal", name: "File manager", kind: "reveal" },
    { id: "default", name: "Default application", kind: "default" },
    ...discovered,
  ];
  cache.set(`${process.platform}:${ext}`, { at: Date.now(), openers });
  return openers;
}

/** Launch `target` with the chosen opener. */
export async function openWith(target: string, openerId: string): Promise<{ ok: boolean; error?: string }> {
  if (openerId === "reveal") {
    shell.showItemInFolder(target);
    return { ok: true };
  }
  if (openerId === "default") {
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  }
  const openers = await listOpeners(target);
  const chosen = openers.find((opener) => opener.id === openerId);
  const command = chosen?.command;
  if (!command || !existsSync(command)) return { ok: false, error: "That application is no longer installed." };
  try {
    const child = execFile(command, [target], { windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
