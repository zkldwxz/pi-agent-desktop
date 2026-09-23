// scratch helper: print lines of a file matching a regex, with line numbers
const fs = require('fs');
const file = process.argv[2];
const re = new RegExp(process.argv[3]);
const before = Number(process.argv[4] || 0);
const after = Number(process.argv[5] || 0);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const printed = new Set();
const matches = [];
lines.forEach((l, i) => { if (re.test(l)) matches.push(i); });
for (const i of matches) {
  for (let j = Math.max(0, i - before); j <= Math.min(lines.length - 1, i + after); j++) printed.add(j);
}
const sorted = [...printed].sort((a, b) => a - b);
let prev = -2;
for (const j of sorted) {
  if (j !== prev + 1) console.log('   ...');
  console.log(String(j + 1).padStart(5) + ': ' + lines[j]);
  prev = j;
}
console.log(`\n[${matches.length} matching lines, ${sorted.length} printed of ${lines.length} total]`);
