/**
 * Keep only the files the packaged app actually loads.
 *
 * `electron-builder` copies each production dependency whole, which for this
 * project means 620 MB of `node_modules` — docs, example projects, sourcemaps,
 * the pi CLI's bundled TUI, font families nothing imports, and type definitions.
 * The installed app would be a quarter of a gigabyte, almost all of it files
 * that are never read.
 *
 * This hook runs after the app's own files are copied and before the installer
 * is assembled, and deletes what the running app cannot reach:
 *
 *   - `dist/bundle/` — the pi CLI bundled for Node and Bun. It is a second copy
 *     of the whole agent, and app code imports the source modules through
 *     `dist/index.js`, never the bundle.
 *   - other platforms' native prebuilds (this build ships win32-x64).
 *   - `docs`, `examples`, maps, TypeScript declarations, test directories.
 *   - `@fontsource` families the app does not import (only Geist is used).
 *
 * `asar` is off in this project, so the files here are what the app reads off
 * disk. A few of these are load-bearing even though they look unused and are
 * deliberately left alone — see the notes on each rule.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Directories that never contribute to the running app. */
const DROP_DIRS = ["docs", "examples", "test", "tests", "__tests__", "coverage", ".github"];

const DROP_EXTENSIONS = [".map", ".d.ts", ".d.mts", ".d.cts"];

/**
 * Directories dropped wherever they appear.
 *
 * `bundle` is the pi CLI bundled for Node and Bun: a second copy of the whole
 * agent, loaded only by `dist/bundle/cli.js`, which this app never runs.
 */
const DROP_ANYWHERE = new Set(["bundle"]);

/** @fontsource families nothing imports: the app uses Geist and Geist Mono. */
const DROP_FONTS = new Set(["inter", "jetbrains-mono"]);

/** Native prebuilds for other platforms. */
const KEEP_NATIVE = "win32-x64";

let freed = 0;

function directorySize(path) {
  let total = 0;
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return 0;
  if (stats.isFile()) return stats.size;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySize(join(path, entry.name));
  }
  return total;
}

function drop(path) {
  try {
    const size = directorySize(path);
    rmSync(path, { recursive: true, force: true });
    freed += size;
  } catch {
    /* a locked file is not worth failing the build over */
  }
}

function pruneTree(root, depth = 0) {
  if (!existsSync(root) || depth > 12) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (DROP_ANYWHERE.has(entry.name)) {
        drop(path);
        continue;
      }
      if (entry.name === "prebuilds") {
        for (const target of readdirSync(path, { withFileTypes: true })) {
          if (target.isDirectory() && target.name !== KEEP_NATIVE) drop(join(path, target.name));
        }
        continue;
      }
      pruneTree(path, depth + 1);
      continue;
    }
    if (DROP_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) drop(path);
  }
}

export default async function afterPack(context) {
  const root = join(context.appOutDir, "resources", "app", "node_modules");
  if (!existsSync(root)) return;
  freed = 0;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);

    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(path, { withFileTypes: true })) {
        const scopedPath = join(path, scoped.name);
        if (!scoped.isDirectory()) continue;
        /* the font packages ship every family under two scopes; keep Geist */
        if (scoped.name === "fontsource" || scoped.name === "fontsource-variable") {
          for (const family of readdirSync(scopedPath, { withFileTypes: true })) {
            if (family.isDirectory() && DROP_FONTS.has(family.name)) drop(join(scopedPath, family.name));
          }
          continue;
        }
        if (scoped.name === "types") {
          /* nothing at runtime reads a type declaration */
          drop(scopedPath);
          continue;
        }
        for (const extra of DROP_DIRS) drop(join(scopedPath, extra));
        pruneTree(scopedPath);
      }
      continue;
    }

    for (const extra of DROP_DIRS) drop(join(path, extra));
    pruneTree(path);
  }

  console.log(`[after-pack] pruned ${(freed / 1024 / 1024).toFixed(1)} MB from the packaged node_modules`);
}
