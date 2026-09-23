import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { DirListing, FileContent, FileEntry } from "@shared/workspace";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "out",
  "dist",
  "release",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const MAX_ENTRIES = 500;
const MAX_BYTES = 512 * 1024;

/** Bounded walk for the composer's `@` mentions — not a full index. */
const MAX_SEARCH_FILES = 4000;
const MAX_SEARCH_DEPTH = 8;

export interface FileSearchHit {
  /** relative path, forward slashes */
  path: string;
  /** epoch ms — the newest files sort first */
  modified: number;
}

/**
 * Walk a workspace for filenames, skipping the usual noise directories.
 *
 * The composer's `@` menu wants to search what is on disk, not just the ten
 * entries the session happens to have touched. The walk is bounded (depth and
 * count) so a large repository stays a few milliseconds, and it hits the
 * filesystem's directory cache on repeat calls.
 */
export async function searchFiles(root: string, limit = MAX_SEARCH_FILES): Promise<FileSearchHit[]> {
  const hits: FileSearchHit[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length && hits.length < limit) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if (entry.isDirectory()) {
        // dot-directories are caches and tooling; the code is never in them
        if (entry.name.startsWith(".") || SKIP.has(entry.name) || depth >= MAX_SEARCH_DEPTH) continue;
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      // breadth-first keeps shallow files (the ones people mention) first
      hits.push({ path: join(dir, entry.name).slice(root.length + 1).split(sep).join("/"), modified: 0 });
    }
  }

  return hits;
}

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js", ".cjs": "js",
  ".json": "json", ".jsonc": "json", ".css": "css", ".scss": "scss", ".less": "less",
  ".html": "html", ".vue": "vue", ".svelte": "svelte", ".astro": "astro",
  ".py": "py", ".rb": "rb", ".go": "go", ".rs": "rs", ".java": "java", ".kt": "kt",
  ".swift": "swift", ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cs": "cs",
  ".php": "php", ".sh": "sh", ".bash": "sh", ".zsh": "sh", ".ps1": "ps1", ".bat": "bat",
  ".sql": "sql", ".yml": "yml", ".yaml": "yml", ".toml": "toml", ".ini": "ini",
  ".md": "md", ".mdx": "md", ".txt": "txt", ".log": "txt", ".csv": "csv", ".tsv": "csv",
  ".xml": "xml", ".svg": "xml", ".env": "ini", ".gitignore": "txt", ".dockerfile": "docker",
};

export function languageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "docker";
  if (name === "makefile") return "make";
  return LANG_BY_EXT[extname(name)] ?? "txt";
}

/**
 * Refuse to walk outside the project root.
 *
 * A tool call spells the file it touched relative to the workspace
 * (`src/renderer/src/App.tsx`), so a relative target is read against the root —
 * normalising alone left it relative, which failed the check below and turned
 * every diff opened from the changes list into "Path is outside the workspace".
 */
export function assertInside(root: string, target: string): string {
  const rootResolved = normalize(root);
  const resolved = isAbsolute(target) ? normalize(target) : resolve(rootResolved, target);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep)) {
    throw new Error("Path is outside the workspace");
  }
  return resolved;
}

export async function listDir(root: string, dirPath: string, showAll = false): Promise<DirListing> {
  try {
    const target = assertInside(root, dirPath || root);
    const dirents = await readdir(target, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const dirent of dirents) {
      if (!showAll && (dirent.name.startsWith(".") || SKIP.has(dirent.name))) continue;
      if (SKIP.has(dirent.name) && showAll === false) continue;
      const full = join(target, dirent.name);
      let size: number | undefined;
      let modified: string | undefined;
      try {
        const info = await stat(full);
        size = info.size;
        modified = info.mtime.toISOString();
      } catch {
        /* unreadable entry — still list it */
      }
      entries.push({
        name: dirent.name,
        path: full,
        kind: dirent.isDirectory() ? "dir" : "file",
        size,
        modified,
      });
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    const truncated = entries.length > MAX_ENTRIES;
    return {
      path: target,
      parent: target === normalize(root) ? null : dirname(target),
      entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
      truncated,
    };
  } catch (error) {
    return {
      path: dirPath,
      parent: null,
      entries: [],
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readFileForView(root: string, filePath: string): Promise<FileContent> {
  const lang = languageFor(filePath);
  const name = basename(filePath);
  try {
    const target = assertInside(root, filePath);
    const info = await stat(target);
    if (info.isDirectory()) throw new Error("That is a directory");
    const buffer = await readFile(target);
    const binary = buffer.includes(0);
    if (binary) {
      return { path: target, name, lang: "txt", text: "", size: info.size, truncated: false, binary: true };
    }
    const truncated = buffer.length > MAX_BYTES;
    const text = buffer.subarray(0, MAX_BYTES).toString("utf8");
    return { path: target, name, lang, text, size: info.size, truncated, binary: false };
  } catch (error) {
    return {
      path: filePath,
      name,
      lang,
      text: "",
      size: 0,
      truncated: false,
      binary: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
