// scratch helper: print a line range of a file
const fs = require('fs');
const file = process.argv[2];
const from = Number(process.argv[3]);
const to = Number(process.argv[4]);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
for (let i = from - 1; i <= to - 1 && i < lines.length; i++) {
  console.log(String(i + 1).padStart(5) + ': ' + lines[i]);
}
