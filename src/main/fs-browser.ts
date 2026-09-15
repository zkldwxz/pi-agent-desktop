import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
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

/** Refuse to walk outside the project root. */
function assertInside(root: string, target: string): string {
  const resolved = normalize(target);
  const rootResolved = normalize(root);
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
