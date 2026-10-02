import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { app, shell } from "electron";
import type { AppOpener } from "@shared/workspace";

/**
 * "Open with" for the file viewer and the folder button.
 *
 * The list is whatever the operating system has registered for that target —
 * which is the point: the file manager, Cursor, VS Code, an editor the user
 * installed last week are all already registered, and re-declaring them here
 * would go stale the moment the user's machine changes.
 *
 * On Windows that means reading the registry. A file is answered by the
 * machine-wide and per-user "Open with" lists for its extension, the shell
 * command each ProgID points at, and the application keys of the editors people
 * actually install. A folder has no extension, so it is answered by a different
 * set of keys — `Directory\shell` and `Folder\shell`, where Explorer's own
 * handler and every file manager the user installed put their verbs. macOS and
 * Linux have no equivalent registry, so the list falls back to the default
 * application plus whatever editor binaries are on PATH. Every probe is
 * best-effort — a missing key is not an error.
 *
 * The file manager itself is a per-platform *picture* rather than a registered
 * verb: Explorer's executable on Windows, Finder on macOS. `iconSource` answers
 * with the application the platform's reveal-in-folder actually runs, which is
 * the only way the menu gets a real mark for a row that has no command.
 */

const REG_TIMEOUT_MS = 4000;
/** the pixel size the toolbar button and the menu rows draw at (16px, at 2x) */
const ICON_WANT_PX = 32;
/** discovery walks the registry once per extension, then answers from memory */
const cache = new Map<string, { at: number; openers: AppOpener[] }>();
const CACHE_MS = 60_000;
/** the icon of an application, as a data URL, keyed by opener id */
const iconCache = new Map<string, string>();
/** registry `Icon` values, keyed by opener id — the verb's own picture */
const iconSources = new Map<string, string>();

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
 * `reg query <key> /s` output as `key → its values`.
 *
 * The recursive form is what makes folder discovery affordable: one process
 * lists every verb under `Directory\shell` *and* the command each verb runs,
 * where asking for them one key at a time would spawn a process per verb. Keys
 * and value names are lowercased — both are case-insensitive in the registry.
 */
function regBlocks(output: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^HK[A-Z_]+\\/i.test(line)) {
      current = new Map();
      blocks.set(line.trim().toLowerCase(), current);
      continue;
    }
    const match = /^\s+(.+?)\s{2,}REG_[A-Z_]+\s{2,}(.*)$/.exec(line);
    if (match && current) current.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return blocks;
}

/**
 * The executable a shell command launches.
 *
 * Commands are stored as `"C:\...\Code.exe" "%1"` — and, for anything Windows
 * itself registered, as `%SystemRoot%\Explorer.exe`, so the environment has to
 * be expanded before the path means anything. Launching the exe with the target
 * as an argument (rather than running the command template through a shell)
 * keeps a path containing spaces or quotes from becoming an injection.
 */
function executableFrom(command: string): string | undefined {
  const trimmed = expandEnv(command).trim();
  if (!trimmed) return undefined;
  const quoted = /^"([^"]+\.exe)"/i.exec(trimmed);
  if (quoted) return quoted[1];
  const bare = /^([^\s]+\.exe)(\s|$)/i.exec(trimmed);
  if (bare) return bare[1];
  const first = trimmed.split(/\s+/)[0];
  return first.replace(/^"|"$/g, "") || undefined;
}

/** `%SystemRoot%` and friends arrive unexpanded from `REG_EXPAND_SZ` values. */
function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

/** Explorer's own executable — the handler behind every folder `open` verb. */
function explorerExe(): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "Explorer.exe");
}

/**
 * Finder, as a file to read a picture out of.
 *
 * `shell.showItemInFolder` is answered by Finder on macOS, and Finder is the
 * application whose mark a Mac user reads as "open the file manager" — the blue
 * smiley is Explorer's counterpart, not a generic glyph. It has no
 * bundle-independent `/Applications` entry (it lives in CoreServices), so the
 * path is spelled out.
 *
 * On macOS `app.getFileIcon` resolves by *type*, not by bundle: handed a `.app`
 * it answers with the generic application glyph (verified — a pale placeholder,
 * not Finder's face). The bundle's own `.icns` is the only picture of it, so
 * that is what is read, and the read is the same best-effort probe as every
 * other one here.
 */
function finderIcon(): string | undefined {
  const icns = "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns";
  return existsSync(icns) ? icns : undefined;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * One picture out of a macOS `.icns`, as a data URL.
 *
 * An `.icns` is a container of PNGs at several sizes, so this walks it and takes
 * the entry closest to `want` (preferring the larger one on a tie). Only
 * PNG-backed entries are considered: macOS also stores some legacy sizes as raw
 * bitmaps, and their pixel format is a decoder this file does not need — the
 * sizes around them are enough for a 16px button.
 *
 * Falls back to the biggest PNG when the size table is odd, and to `undefined`
 * when the file holds no PNG at all, so a machine Apple ships differently still
 * gets a working menu rather than a thrown error.
 */
function icnsDataUrl(path: string, want: number): string | undefined {
  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch {
    return undefined;
  }
  if (data.length < 8 || data.toString("latin1", 0, 4) !== "icns") return undefined;

  let best: { score: number; payload: Buffer } | undefined;
  let biggest: Buffer | undefined;
  for (let offset = 8; offset + 8 <= data.length; ) {
    const type = data.toString("latin1", offset, offset + 4);
    const size = data.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > data.length) break;
    const payload = data.subarray(offset + 8, offset + size);
    if (payload.subarray(0, 8).equals(PNG_MAGIC)) {
      /* the type carries the size for the PNG kinds: ic07=128, ic08=256,
       * ic09=512, ic10=1024, ic11=32, ic12=64, ic13=256@2x, ic14=512@2x */
      const declared: Record<string, number> = {
        ic07: 128,
        ic08: 256,
        ic09: 512,
        ic10: 1024,
        ic11: 32,
        ic12: 64,
        ic13: 256,
        ic14: 512,
      };
      const byType = declared[type];
      const width = byType ?? pngWidth(payload) ?? 0;
      const score = width ? Math.abs(width - want) * 1000 - width : Number.MAX_SAFE_INTEGER;
      if (!best || score < best.score) best = { score, payload };
      if (!biggest || payload.length > biggest.length) biggest = payload;
    }
    offset += size;
  }
  const chosen = best?.payload ?? biggest;
  if (!chosen) return undefined;
  return `data:image/png;base64,${chosen.toString("base64")}`;
}

/** A PNG's width from its own IHDR, or nothing when the header is not one. */
function pngWidth(png: Buffer): number | undefined {
  if (png.length < 24 || png.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return png.readUInt32BE(16);
}

/** An icon source is only useful when it is a real file we can ask for an icon. */
function iconPathFrom(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // `"C:\...\App.exe",0` and `shell32.dll,-8506` both carry a resource id we
  // cannot read; the path in front of it is what `getFileIcon` accepts.
  const path = value.replace(/,\s*-?\d+\s*$/, "").trim().replace(/^"|"$/g, "").trim();
  return /^[a-z]:\\/i.test(path) ? path : undefined;
}

function prettyName(exe: string): string {
  const file = basename(exe).replace(/\.exe$/i, "");
  const known: Record<string, string> = {
    code: "Visual Studio Code",
    "code - insiders": "VS Code Insiders",
    cursor: "Cursor",
    windsurf: "Windsurf",
    zed: "Zed",
    notepad: "Notepad",
    kiro: "Kiro",
    devenv: "Visual Studio",
    explorer: "File Explorer",
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
  "Zed.exe",
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
    [join(local, "Programs", "Zed", "Zed.exe"), "Zed"],
    [join(programFiles, "Microsoft VS Code", "Code.exe"), "Visual Studio Code"],
    [join(programFiles, "cursor", "Cursor.exe"), "Cursor"],
    [join(programFiles, "Zed", "Zed.exe"), "Zed"],
  ];
  const found: AppOpener[] = [];
  for (const [path, name] of candidates) {
    if (!existsSync(path)) continue;
    found.push({ id: path.toLowerCase(), name, kind: "app", command: path });
  }
  return found;
}

/**
 * The keys Windows registers folder handling under.
 *
 * A file manager is not "the application for .ext" — it is the verb the shell
 * runs for a folder, which is why every one of them writes to `Directory\shell`
 * or `Folder\shell`: Explorer's own handler, and the Total Commanders, Directory
 * Opuses, XYplorers and IDEs a user installs. `HKCU\Software\Classes` mirrors
 * the machine-wide keys for anything installed for one user only.
 */
const FOLDER_SHELL_ROOTS = [
  "HKEY_CLASSES_ROOT\\Folder\\shell",
  "HKEY_CLASSES_ROOT\\Directory\\shell",
  "HKEY_CURRENT_USER\\Software\\Classes\\Folder\\shell",
  "HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell",
];

/**
 * Verbs that open a console, a shell dialog, or another shell — not an
 * application. Windows registers plenty of them beside the real entries, and
 * each one would otherwise become a menu row.
 */
const NON_APP_VERBS = new Set([
  "anycode",
  "cmd",
  "find",
  "git_gui",
  "git_shell",
  "opennewprocess",
  "opennewtab",
  "opennewwindow",
  "pintohome",
  "powershell",
  "runas",
  "updateencryptionsettings",
  "wsl",
]);

/**
 * Verbs that name a COM handler instead of an executable.
 *
 * The folder `open` verb is the one that matters: the registry points at the
 * shell's own "browse this folder" handler, so the CLSID is the only thing that
 * says Explorer is what will run.
 */
const SHELL_DELEGATES: Record<string, () => string> = {
  "{11dbb47c-a525-400b-9e80-a54615a090c0}": explorerExe,
};

/** one registered folder verb, already resolved to an executable that exists */
interface ShellVerb {
  exe: string;
  /** the label the application registered, when it is not a resource reference */
  name?: string;
  /** an `Icon` value worth extracting from, when the registry supplied one */
  icon?: string;
}

/**
 * The verb's own label — the application's name for what it does ("Open in
 * Total Commander"). Windows usually stores it as a resource reference
 * (`@shell32.dll,-8506`) that we cannot resolve, and a key can carry one in
 * `MUIVerb` while its plain name sits in the default value, so both are tried
 * before the executable names the entry.
 */
function verbName(values: Map<string, string>): string | undefined {
  for (const raw of [values.get("muiverb"), values.get("(default)")]) {
    if (!raw) continue;
    const label = raw.trim();
    if (!label || label.startsWith("@")) continue;
    return label.replace(/&/g, "") || undefined;
  }
  return undefined;
}

/** The executable a verb runs, whether it names one or delegates to the shell. */
function verbExecutable(values: Map<string, string>, command: Map<string, string> | undefined): string | undefined {
  const exe = executableFrom(command?.get("(default)") ?? "");
  if (exe && existsSync(exe)) return exe;
  const delegate = SHELL_DELEGATES[(values.get("delegateexecute") ?? "").toLowerCase()];
  if (!delegate) return undefined;
  const viaDelegate = delegate();
  return existsSync(viaDelegate) ? viaDelegate : undefined;
}

/** Every folder verb registered on this machine, in registry order. */
async function folderVerbs(): Promise<ShellVerb[]> {
  const verbs: ShellVerb[] = [];
  const seen = new Set<string>();
  for (const root of FOLDER_SHELL_ROOTS) {
    const blocks = regBlocks(await regQuery(["query", root, "/s"]));
    const prefix = `${root.toLowerCase()}\\`;
    for (const [key, values] of blocks) {
      if (!key.startsWith(prefix)) continue;
      const verb = key.slice(prefix.length);
      /* deeper keys are a verb's own `command` and its subcommands, not verbs */
      if (verb.includes("\\")) continue;
      if (NON_APP_VERBS.has(verb.toLowerCase())) continue;
      /* the shell hides these from its own menus, so they are not choices */
      if (values.has("programmaticaccessonly") || values.has("legacydisable")) continue;
      const exe = verbExecutable(values, blocks.get(`${key}\\command`));
      if (!exe || seen.has(exe.toLowerCase())) continue;
      seen.add(exe.toLowerCase());
      verbs.push({ exe, name: verbName(values), icon: iconPathFrom(values.get("icon")) });
    }
  }
  return verbs;
}

async function windowsOpeners(target: string, directory: boolean): Promise<AppOpener[]> {
  const ext = extname(target).toLowerCase();
  const openers: AppOpener[] = [];
  const seen = new Set<string>();

  const add = (opener: AppOpener, iconSource?: string) => {
    const key = opener.id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    openers.push(opener);
    /* a verb's own `Icon` value is what Explorer draws for it, so it wins over
     * the executable's icon when the registry supplied one */
    if (iconSource) iconSources.set(key, iconSource);
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

  /* A folder has no extension to look up, and a name that happens to contain a
   * dot is still not a file type: what opens it are the verbs the shell
   * registered for folders — Explorer's own handler among them. */
  if (directory) {
    for (const verb of await folderVerbs()) {
      add(
        { id: verb.exe.toLowerCase(), name: verb.name ?? prettyName(verb.exe), kind: "app", command: verb.exe },
        verb.icon,
      );
    }
  }

  if (ext && !directory) {
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
 * The application's own icon, straight from the executable.
 *
 * `app.getFileIcon` reads what Explorer shows — Cursor shows Cursor, Zed shows
 * Zed, the folder verb shows Explorer's blue-front folder — and a data URL
 * travels the IPC boundary without extra wiring. Icons are cached per opener so
 * reopening the menu is instant. Failure is fine: the menu renders a neutral
 * dot when an icon cannot be extracted.
 */
async function iconForOpeners(openers: AppOpener[]): Promise<void> {
  await Promise.all(
    openers.map(async (opener) => {
      const source = iconSource(opener);
      if (!source) return;
      const cached = iconCache.get(opener.id);
      if (cached) {
        opener.icon = cached;
        return;
      }
      try {
        /* a `.icns` is a container, not an image: `getFileIcon` cannot read one,
         * so the picture is unpacked here instead */
        const dataUrl = source.endsWith(".icns")
          ? icnsDataUrl(source, ICON_WANT_PX)
          : (await app.getFileIcon(source, { size: "normal" })).toDataURL();
        if (!dataUrl) return;
        iconCache.set(opener.id, dataUrl);
        opener.icon = dataUrl;
      } catch (error) {
        /* no icon — the menu falls back to a dot; the log explains why */
        console.warn("[openers] icon extraction failed:", opener.name, error);
      }
    }),
  );
}

/**
 * Where an opener's icon comes from, or nothing when it has none.
 *
 * The file manager is a platform handler rather than an executable, so its only
 * picture is the one the platform's own file manager shows: Explorer's own blue
 * front on Windows, Finder's on macOS. Linux has no single answer — the reveal
 * verb belongs to whichever registered handler the desktop environment picked —
 * so its row keeps the neutral glyph rather than wearing a mark that may not be
 * the application that opens.
 */
function iconSource(opener: AppOpener): string | undefined {
  if (opener.kind === "reveal") {
    if (process.platform === "win32") return explorerExe();
    if (process.platform === "darwin") return finderIcon();
    return undefined;
  }
  if (opener.kind !== "app") return undefined;
  const preferred = iconSources.get(opener.id);
  if (preferred && existsSync(preferred)) return preferred;
  return opener.command && existsSync(opener.command) ? opener.command : undefined;
}

/** Whether the target is a folder — discovery for the two differs completely. */
function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Applications registered for this target, most specific first.
 *
 * Always leads with the two entry points every platform has — reveal in the file
 * manager, and whatever is registered as the default — so the menu is never
 * empty even on a machine with nothing else installed.
 *
 * A folder and a file are answered by different keys, so they are cached under
 * different scopes: one registry walk covers every folder on the machine.
 */
export async function listOpeners(target: string): Promise<AppOpener[]> {
  const directory = isDirectory(target);
  const scope = directory ? "dir" : extname(target).toLowerCase();
  const cached = cache.get(`${process.platform}:${scope}`);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.openers;

  const discovered = process.platform === "win32" ? await windowsOpeners(target, directory) : await pathEditors();
  const openers: AppOpener[] = [
    { id: "reveal", name: "File manager", kind: "reveal" },
    { id: "default", name: "Default application", kind: "default" },
    ...discovered,
  ];
  await iconForOpeners(openers);
  cache.set(`${process.platform}:${scope}`, { at: Date.now(), openers });
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
