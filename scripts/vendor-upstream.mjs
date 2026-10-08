/**
 * vendor-upstream — copy pi's source, changelog and docs into `docs/upstream/`.
 *
 *   node scripts/vendor-upstream.mjs
 *
 * The npm tarball ships no `src/`, but every `dist/**\/*.js.map` carries
 * `sourcesContent`: the original TypeScript. This recovers those files so the
 * upstream implementation is readable from inside this repository, next to the
 * changelog and the docs the package does publish. Nothing here is executed or
 * typechecked — the folders live under `docs/`, outside both tsconfigs and
 * outside electron-builder's `out/**` file list.
 *
 * Re-run it after a pi upgrade; it is idempotent and only rewrites what it owns.
 * `README.md` in the target folder is hand-written and is never touched.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkgDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
const dist = join(pkgDir, "dist");

if (!existsSync(join(pkgDir, "package.json"))) {
  console.error("pi-coding-agent is not installed — run npm install first.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const target = join(root, "docs", "upstream", `pi-coding-agent-${version}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/* ── the sources, recovered from the maps ─────────────────────────────── */

const sourceRoot = join(target, "src");
/* recursive, so a tree an earlier run nested under a second `src/` goes too */
rmSync(sourceRoot, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const recovered = new Map();
const collisions = [];
for (const map of walk(dist).filter((path) => path.endsWith(".js.map"))) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(map, "utf8"));
  } catch {
    continue;
  }
  const sources = parsed.sources ?? [];
  const contents = parsed.sourcesContent ?? [];
  for (let index = 0; index < sources.length; index += 1) {
    const text = contents[index];
    if (typeof text !== "string") continue;
    /* `../../../src/extensions/mcp/config.ts` → `src/extensions/mcp/config.ts` */
    const relative = sources[index].replace(/^(\.\.\/)+/, "");
    if (!relative.startsWith("src/")) continue;
    if (recovered.has(relative) && recovered.get(relative) !== text) collisions.push(relative);
    recovered.set(relative, text);
  }
}

for (const [relative, text] of recovered) {
  /* `relative` already starts with `src/`, so the target root is the folder
     itself — joining it under a second `src/` is how the first run nested them */
  const destination = join(target, relative);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, text, "utf8");
}

/* ── what the package does publish ────────────────────────────────────── */

copyFileSync(join(pkgDir, "CHANGELOG.md"), join(target, "CHANGELOG.md"));

const docsTarget = join(target, "docs");
rmSync(docsTarget, { recursive: true, force: true });
mkdirSync(docsTarget, { recursive: true });
let docs = 0;
const docsSource = join(pkgDir, "docs");
if (existsSync(docsSource)) {
  for (const path of walk(docsSource).filter((entry) => entry.endsWith(".md"))) {
    const relative = path.slice(docsSource.length + 1);
    const destination = join(docsTarget, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(path, destination);
    docs += 1;
  }
}

writeFileSync(
  join(target, "manifest.json"),
  `${JSON.stringify(
    {
      package: "@earendil-works/pi-coding-agent",
      version,
      recoveredFrom: "dist/**/*.js.map sourcesContent",
      sources: recovered.size,
      docs,
      collisions: collisions.length ? collisions : undefined,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const kb = (value) => `${(value / 1024).toFixed(0)} KB`;
let bytes = 0;
for (const text of recovered.values()) bytes += Buffer.byteLength(text, "utf8");

console.log(`pi-coding-agent ${version} → docs/upstream/pi-coding-agent-${version}`);
console.log(`  src/         ${recovered.size} files (${kb(bytes)}) recovered from sourcemaps`);
console.log(`  docs/        ${docs} markdown files`);
console.log(`  CHANGELOG.md copied`);
if (collisions.length) console.log(`  ! ${collisions.length} files appeared with different content in two maps`);
