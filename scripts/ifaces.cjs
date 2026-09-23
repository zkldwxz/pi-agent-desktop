// scratch helper: extract interface/type declarations whose name matches a regex
const fs = require('fs');
const file = process.argv[2];
const nameRe = new RegExp(process.argv[3]);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const m = l.match(/^export (?:interface|type) ([A-Za-z0-9_]+)/);
  if (!m || !nameRe.test(m[1])) continue;
  let depth = 0, j = i, body = [];
  if (/^export type /.test(l) && !l.includes('{')) {
    // multi-line union: accumulate until line ends with ';'
    while (j < lines.length) { body.push(lines[j]); if (/;\s*$/.test(lines[j])) break; j++; }
  } else {
    while (j < lines.length) {
      body.push(lines[j]);
      for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && j > i) break;
      if (depth === 0 && /;\s*$/.test(lines[j]) && lines[j].includes('=')) break;
      j++;
    }
  }
  blocks.push(body.join('\n'));
  i = j;
}
console.log(blocks.join('\n\n'));
console.log(`\n[${blocks.length} blocks]`);
