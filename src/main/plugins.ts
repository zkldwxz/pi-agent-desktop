import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PluginInfo, PluginKind, PluginScope } from "@shared/types";

const DISABLED_SUFFIX = ".disabled";

export interface PluginRoots {
  agentDir: string;
  cwd: string;
}

export function pluginRoots(cwd: string): PluginRoots {
  return { agentDir: getAgentDir(), cwd };
}

function readDirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function dirSize(path: string, depth = 0): { bytes: number; modified: number } {
  let bytes = 0;
  let modified = 0;
  try {
    const stat = statSync(path);
    modified = stat.mtimeMs;
    if (!stat.isDirectory()) return { bytes: stat.size, modified };
    if (depth > 4) return { bytes: 0, modified };
    for (const entry of readDirSafe(path)) {
      const child = dirSize(join(path, entry), depth + 1);
      bytes += child.bytes;
      modified = Math.max(modified, child.modified);
    }
  } catch {
    /* ignore */
  }
  return { bytes, modified };
}

function describeExtension(filePath: string): { name: string; description?: string } {
  const fallback = basename(filePath).replace(/\.(ts|js|mts)$/, "");
  let head = "";
  try {
    head = readFileSync(filePath, "utf8").slice(0, 1200);
  } catch {
    return { name: fallback };
  }
  const docMatch = head.match(/\/\*\*([\s\S]*?)\*\//);
  const lineMatch = head.match(/^\s*\/\/\s*(.+)$/m);
  const raw = docMatch?.[1] ?? lineMatch?.[1] ?? "";
  const description = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .trim();
  return { name: fallback, description: description || undefined };
}

function classifyEntry(root: string, entry: string): { path: string; entry: string } | null {
  const full = join(root, entry);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return null;
  }
  if (stat.isFile()) {
    return /\.(ts|js|mts)$/.test(entry) ? { path: full, entry } : null;
  }
  if (stat.isDirectory() && existsSync(join(full, "index.ts"))) {
    return { path: full, entry };
  }
  return null;
}

function scanDir(root: string, scope: PluginScope, kind: PluginKind, enabled: boolean): PluginInfo[] {
  const out: PluginInfo[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readDirSafe(root)) {
    if (entry.startsWith(".")) continue;
    const classified = classifyEntry(root, entry);
    if (!classified) continue;
    const isDir = statSync(classified.path).isDirectory();
    const manifest = isDir ? join(classified.path, "index.ts") : classified.path;
    const meta = describeExtension(manifest);
    const size = dirSize(classified.path);
    out.push({
      id: `${scope}:${kind}:${classified.path}`,
      kind,
      name: meta.name,
      description: meta.description,
      path: classified.path,
      scope,
      enabled,
      toggleable: true,
      sizeBytes: size.bytes,
      modified: size.modified ? new Date(size.modified).toISOString() : undefined,
    });
  }
  return out;
}

function scanResourceDir(root: string, scope: PluginScope, kind: PluginKind): PluginInfo[] {
  const out: PluginInfo[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readDirSafe(root)) {
    if (entry.startsWith(".")) continue;
    const full = join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    const name = stat.isDirectory() ? entry : entry.replace(/\.[a-z]+$/i, "");
    const descriptionFile = stat.isDirectory() ? join(full, "SKILL.md") : full;
    let description: string | undefined;
    if (existsSync(descriptionFile)) {
      try {
        const text = readFileSync(descriptionFile, "utf8").slice(0, 800);
        const match = text.match(/^---[\s\S]*?description:\s*(.+)$/m);
        description = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      } catch {
        /* ignore */
      }
    }
    out.push({
      id: `${scope}:${kind}:${full}`,
      kind,
      name,
      description,
      path: full,
      scope,
      enabled: true,
      toggleable: false,
      sizeBytes: dirSize(full).bytes,
      modified: new Date(stat.mtimeMs).toISOString(),
    });
  }
  return out;
}

function readSettings(cwd: string): Record<string, unknown> {
  const paths = [join(getAgentDir(), "settings.json"), join(cwd, ".pi", "settings.json")];
  const merged: Record<string, unknown> = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      Object.assign(merged, JSON.parse(readFileSync(path, "utf8")));
    } catch {
      /* ignore */
    }
  }
  return merged;
}

export function listPlugins(cwd: string): PluginInfo[] {
  const { agentDir } = pluginRoots(cwd);
  const plugins: PluginInfo[] = [];
  const globalExtensions = join(agentDir, "extensions");
  const globalDisabled = `${globalExtensions}${DISABLED_SUFFIX}`;
  const projectExtensions = join(cwd, ".pi", "extensions");
  const projectDisabled = `${projectExtensions}${DISABLED_SUFFIX}`;

  plugins.push(...scanDir(globalExtensions, "global", "extension", true));
  plugins.push(...scanDir(globalDisabled, "global", "extension", false));
  plugins.push(...scanDir(projectExtensions, "project", "extension", true));
  plugins.push(...scanDir(projectDisabled, "project", "extension", false));

  const settings = readSettings(cwd);
  const configured = Array.isArray(settings.extensions) ? (settings.extensions as unknown[]) : [];
  for (const raw of configured) {
    if (typeof raw !== "string") continue;
    const resolved = raw.replace(/^~/, process.env.HOME ?? "");
    if (plugins.some((plugin) => plugin.path === resolved)) continue;
    const exists = existsSync(resolved);
    const meta = exists ? describeExtension(resolved) : { name: basename(resolved) };
    plugins.push({
      id: `configured:extension:${resolved}`,
      kind: "extension",
      name: meta.name,
      description: meta.description ?? "Declared in settings.json → extensions",
      path: resolved,
      scope: "configured",
      enabled: exists,
      toggleable: false,
      error: exists ? undefined : "Path not found",
    });
  }

  const packages = Array.isArray(settings.packages) ? (settings.packages as unknown[]) : [];
  for (const raw of packages) {
    const source = typeof raw === "string" ? raw : (raw as { source?: string })?.source;
    if (!source) continue;
    plugins.push({
      id: `configured:package:${source}`,
      kind: "package",
      name: source,
      description: "Pi package declared in settings.json",
      path: source,
      scope: "configured",
      enabled: true,
      toggleable: false,
    });
  }

  plugins.push(...scanResourceDir(join(agentDir, "skills"), "global", "skill"));
  plugins.push(...scanResourceDir(join(cwd, ".pi", "skills"), "project", "skill"));
  plugins.push(...scanResourceDir(join(cwd, ".agents", "skills"), "project", "skill"));
  plugins.push(...scanResourceDir(join(agentDir, "prompts"), "global", "prompt"));
  plugins.push(...scanResourceDir(join(agentDir, "themes"), "global", "theme"));

  return plugins.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "extension" ? -1 : b.kind === "extension" ? 1 : a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });
}

function targetFor(path: string, kind: PluginKind): { activeRoot: string; disabledRoot: string } | null {
  const normalized = path.replace(/\\/g, "/");
  const marker = "/extensions/";
  const disabledMarker = `/extensions${DISABLED_SUFFIX}/`;
  if (normalized.includes(disabledMarker)) {
    const [activeRoot] = normalized.split(disabledMarker);
    return { activeRoot, disabledRoot: `${activeRoot}/extensions${DISABLED_SUFFIX}` };
  }
  if (!normalized.includes(marker)) return null;
  const [activeRoot] = normalized.split(marker);
  return { activeRoot: `${activeRoot}/extensions`, disabledRoot: `${activeRoot}/extensions${DISABLED_SUFFIX}` };
}

export function setPluginEnabled(path: string, kind: PluginKind, enabled: boolean): PluginInfo[] {
  const roots = targetFor(path, kind);
  if (!roots) throw new Error("This plugin is not a movable extension file.");
  const nodeName = basename(path);
  const targetRoot = enabled ? roots.activeRoot : roots.disabledRoot;
  if (!existsSync(targetRoot)) mkdirSync(targetRoot, { recursive: true });
  const destination = join(targetRoot, nodeName);
  if (existsSync(destination)) throw new Error(`Already exists: ${destination}`);
  renameSync(path, destination);
  return [];
}

export function deletePlugin(path: string, kind: PluginKind): void {
  const trashRoot = join(getAgentDir(), "trash");
  if (!existsSync(trashRoot)) mkdirSync(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = join(trashRoot, `${stamp}-${basename(path)}`);
  renameSync(path, destination);
}

export function pluginCounts(plugins: PluginInfo[]): { total: number; enabled: number; disabled: number } {
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    disabled: plugins.filter((plugin) => !plugin.enabled).length,
  };
}
