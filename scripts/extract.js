const fs = require('fs');
const path = require('path');

const i18n = fs.readFileSync('src/renderer/src/lib/i18n.ts', 'utf8');
const existingKeys = new Set([...i18n.matchAll(/"([^"]+)":/g)].map(m => m[1]));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk('src/renderer/src').filter(f => f.endsWith('.tsx') && !f.includes('beautiful'));

const catalog = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = file.split(path.sep).join('/').replace('src/renderer/src/', '');

  // 1. Strings in t("...")
  for (const m of content.matchAll(/\bt\("([^"]+)"\)|\btf\("([^"]+)"/g)) {
    const str = m[1] || m[2];
    catalog.push({ text: str, file: rel, context: 't() wrapper' });
  }

  // 2. JSX text nodes: >Text<
  for (const m of content.matchAll(/>([^<>{}\n\r]+)</g)) {
    const str = m[1].trim();
    if (str && str.length > 1 && /[A-Za-z]/.test(str)) {
      catalog.push({ text: str, file: rel, context: 'JSX text' });
    }
  }

  // 3. title=, placeholder=, aria-label=, label=
  for (const m of content.matchAll(/\b(title|placeholder|aria-label|label|subtitle|hint|caption)=["']([^"']+)["']/g)) {
    const attr = m[1];
    const str = m[2].trim();
    if (str && /[A-Za-z]/.test(str)) {
      catalog.push({ text: str, file: rel, context: attr });
    }
  }
}

// deduplicate
const map = new Map();
for (const item of catalog) {
  if (/^(http|var\(|calc\(|rgba?\(|currentColor|translate|rotate|flex|grid|absolute|relative|fixed|stagger|font-|text-|bg-|border-)/.test(item.text)) continue;
  if (/^([a-z0-9_-]+:[a-z0-9_-]+)$/.test(item.text)) continue;
  if (/^(\d+(\.\d+)?(px|%|rem|ms|s)?)$/.test(item.text)) continue;
  if (/^[A-Z0-9_-]+$/.test(item.text) && item.text.length < 3) continue;
  if (['true', 'false', 'null', 'undefined', 'auto', 'none', 'inherit'].includes(item.text)) continue;

  if (!map.has(item.text)) {
    map.set(item.text, { text: item.text, files: new Set(), contexts: new Set(), alreadyInI18n: existingKeys.has(item.text) });
  }
  map.get(item.text).files.add(item.file);
  map.get(item.text).contexts.add(item.context);
}

const unlocalized = [];
const localized = [];

for (const [text, data] of map.entries()) {
  const entry = {
    text,
    files: Array.from(data.files),
    contexts: Array.from(data.contexts),
  };
  if (data.alreadyInI18n) {
    localized.push(entry);
  } else {
    unlocalized.push(entry);
  }
}

console.log('Unlocalized count:', unlocalized.length);
console.log('Already in i18n count:', localized.length);
fs.writeFileSync('scripts/extracted_unlocalized.json', JSON.stringify(unlocalized, null, 2));
