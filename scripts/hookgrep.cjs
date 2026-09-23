// scratch helper: recursive case-insensitive grep inside a package dir
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const pattern = new RegExp(process.argv[3], 'i');
const exts = new Set(['.d.ts', '.ts', '.js', '.mjs', '.cjs', '.json', '.md']);
const maxFilesize = Number(process.argv[5] || 8_000_000); // skip huge bundles by default
const skipDirs = (process.argv[6] || '').split(',').filter(Boolean);

let hits = 0;
const fileHits = new Map();

function extOk(name) {
  if (name.endsWith('.d.ts')) return true;
  return exts.has(path.extname(name));
}

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || skipDirs.includes(rel)) continue;
      walk(full);
    } else {
      if (!extOk(e.name)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      if (size > maxFilesize) { console.log(`SKIPPED(size ${size}): ${rel}`); continue; }
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          hits++;
          fileHits.set(rel, (fileHits.get(rel) || 0) + 1);
          const snippet = lines[i].length > 400 ? lines[i].slice(0, 400) + '…[truncated]' : lines[i];
          console.log(`${rel}:${i + 1}: ${snippet}`);
        }
      }
    }
  }
}

walk(root);
console.log('\n=== TOTAL LINES: ' + hits + ' in ' + fileHits.size + ' files ===');
console.log('=== Files (by hit count) ===');
[...fileHits.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, c]) => console.log(`${c}\t${f}`));
