/**
 * Generate the Windows icon for the installer.
 *
 * The app draws its own mark in `Logo.tsx` — a "π" on a rounded dark tile. There
 * is no image file to reuse, so the SVG path from that component is rasterised
 * here, at the same proportions, onto a 512px tile. `electron-builder` accepts a
 * single PNG of at least 256×256 and derives the .ico itself, which keeps the
 * icon right at every size Windows asks for.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZE = 512;

/** The mark, verbatim from `Logo.tsx`: a 28×20 viewBox, drawn in the corner. */
const PATH =
  "M4 16c0-6.2 3.4-10 8.2-10 2.6 0 4.4 1.2 5.3 3.1C18.3 6.4 20.4 5.4 23 5.4c.7 0 1.4.1 2 .3-.6 1.4-1.9 2.3-3.5 2.3-1.8 0-3.1.9-3.7 2.5-.3.8-.4 1.8-.4 3.1V16H14.6V9.7c0-1.8-.9-2.9-2.5-2.9-2.3 0-3.7 2.2-3.7 6V16H4Z";

/* ── path parsing ───────────────────────────────────────
 * Only the commands this glyph uses: move, cubic, line, and close, in both
 * absolute and relative forms. Numbers may run together (`1.4-1.9`, `.3.8`). */
function parsePath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const subpaths = [];
  let points = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;

  const num = () => Number(tokens[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const steps = 24;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const u = 1 - t;
      points.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    x = x3;
    y = y3;
  };

  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M" || command === "m") {
      if (points.length > 1) subpaths.push(points);
      points = [];
      x = command === "m" ? x + num() : num();
      y = command === "m" ? y + num() : num();
      startX = x;
      startY = y;
      points.push([x, y]);
    } else if (command === "L" || command === "l") {
      x = command === "l" ? x + num() : num();
      y = command === "l" ? y + num() : num();
      points.push([x, y]);
    } else if (command === "H" || command === "h") {
      x = command === "h" ? x + num() : num();
      points.push([x, y]);
    } else if (command === "V" || command === "v") {
      y = command === "v" ? y + num() : num();
      points.push([x, y]);
    } else if (command === "C" || command === "c") {
      const rel = command === "c";
      const x1 = rel ? x + num() : num();
      const y1 = rel ? y + num() : num();
      const x2 = rel ? x + num() : num();
      const y2 = rel ? y + num() : num();
      const x3 = rel ? x + num() : num();
      const y3 = rel ? y + num() : num();
      cubic(x1, y1, x2, y2, x3, y3);
    } else if (command === "S" || command === "s") {
      // smooth cubic: the first control point mirrors the previous curve
      const rel = command === "s";
      const x2 = rel ? x + num() : num();
      const y2 = rel ? y + num() : num();
      const x3 = rel ? x + num() : num();
      const y3 = rel ? y + num() : num();
      cubic(x, y, x2, y2, x3, y3);
    } else if (command === "Z" || command === "z") {
      points.push([startX, startY]);
      subpaths.push(points);
      points = [];
      x = startX;
      y = startY;
    }
  }
  if (points.length > 1) subpaths.push(points);
  return subpaths;
}

const subpaths = parsePath(PATH);

/* The path's own box, so the mark can be centred whatever padding is wanted. */
const box = subpaths.flat().reduce(
  (acc, [px, py]) => ({
    minX: Math.min(acc.minX, px),
    maxX: Math.max(acc.maxX, px),
    minY: Math.min(acc.minY, py),
    maxY: Math.max(acc.maxY, py),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);

/**
 * Map the glyph into the tile.
 *
 * Vertically centred, and wide enough that the mark reads at 16px in the
 * taskbar: the π spans 62% of the tile's width, which is the same proportion
 * the logo has inside its own square in the title bar.
 */
const SPAN = SIZE * 0.62;
const scale = SPAN / (box.maxX - box.minX);
const offsetX = (SIZE - (box.maxX - box.minX) * scale) / 2 - box.minX * scale;
/* the mark sits slightly above centre: its own box includes the hook's
 * overshoot, so centring the ink rather than the box looks level */
const offsetY = (SIZE - (box.maxY - box.minY) * scale) / 2 - box.minY * scale;

const edges = subpaths.flatMap((subpath) => {
  const mapped = subpath.map(([px, py]) => [px * scale + offsetX, py * scale + offsetY]);
  const list = [];
  for (let index = 0; index < mapped.length - 1; index += 1) {
    const [ax, ay] = mapped[index];
    const [bx, by] = mapped[index + 1];
    if (ay !== by) list.push([ax, ay, bx, by]);
  }
  return list;
});

/* ── rasterising ────────────────────────────────────────
 * Four vertical samples per pixel, exact horizontal spans per sample row: the
 * winding number decides what is inside, so the counters drawn by the relative
 * curves come out as holes rather than filled lumps. */
const COVERAGE = new Float32Array(SIZE * SIZE);
const SAMPLES = 4;

for (let row = 0; row < SIZE * SAMPLES; row += 1) {
  const scanY = (row + 0.5) / SAMPLES;
  const crossings = [];
  for (const [ax, ay, bx, by] of edges) {
    if ((ay <= scanY && by > scanY) || (by <= scanY && ay > scanY)) {
      const t = (scanY - ay) / (by - ay);
      crossings.push([ax + t * (bx - ax), by > ay ? 1 : -1]);
    }
  }
  if (!crossings.length) continue;
  crossings.sort((a, b) => a[0] - b[0]);

  let winding = 0;
  for (let index = 0; index < crossings.length - 1; index += 1) {
    winding += crossings[index][1];
    if (winding === 0) continue;
    const from = Math.max(0, crossings[index][0]);
    const to = Math.min(SIZE, crossings[index + 1][0]);
    if (to <= from) continue;

    const firstPixel = Math.floor(from);
    const lastPixel = Math.ceil(to) - 1;
    const weight = 1 / SAMPLES;
    for (let column = firstPixel; column <= lastPixel; column += 1) {
      const overlap = Math.min(to, column + 1) - Math.max(from, column);
      if (overlap > 0) COVERAGE[(Math.floor(row / SAMPLES) * SIZE) + column] += overlap * weight;
    }
  }
}

/* ── the tile ─────────────────────────────────────────── */

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const CENTRE = SIZE / 2;
const CORNER = SIZE * 0.225;

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const index = (y * SIZE + x) * 4;

    let tile = 0;
    for (const [ox, oy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const dx = Math.abs(x + ox - CENTRE) - (SIZE / 2 - CORNER);
      const dy = Math.abs(y + oy - CENTRE) - (SIZE / 2 - CORNER);
      const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - CORNER;
      if (distance <= 0) tile += 1;
    }
    if (tile === 0) continue;

    const ink = Math.min(1, COVERAGE[y * SIZE + x]);
    // the tile is --ink (#17181a), the mark is --canvas (#fbfbfc)
    const value = Math.round(23 * (1 - ink) + 251 * ink);
    pixels[index] = value;
    pixels[index + 1] = Math.min(255, value + 1);
    pixels[index + 2] = Math.min(255, value + 3);
    pixels[index + 3] = Math.round((255 * tile) / 4);
  }
}

/* ── PNG encoding ─────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", png);
console.log(`wrote build/icon.png (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);
