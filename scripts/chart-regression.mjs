import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  monotoneLinePath,
  donutArcPath,
  showDateTick,
  buildTrendModel,
  buildShareModel,
} = await jiti.import("../src/renderer/src/components/charts/chart-geometry.ts");

/**
 * Walk a path string and report, per segment, the y values the curve actually
 * paints. A malformed path is not a thrown error in a browser — it is a chart
 * that silently draws nothing — so the assertions have to read the geometry
 * rather than trust that a function returned a string.
 */
function segmentsOf(path) {
  const tokens = path.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const segments = [];
  let index = 0;
  let current = null;

  const pair = () => {
    const point = { x: Number(tokens[index]), y: Number(tokens[index + 1]) };
    index += 2;
    return point;
  };

  while (index < tokens.length) {
    const command = tokens[index];
    index += 1;
    if (command === "M") {
      current = pair();
      continue;
    }
    if (command === "L") {
      const to = pair();
      segments.push({ kind: "line", from: current, to, ys: [current.y, to.y] });
      current = to;
      continue;
    }
    if (command !== "C") throw new Error(`unexpected path command ${command} in ${path}`);
    const c1 = pair();
    const c2 = pair();
    const to = pair();
    const ys = [];
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const u = 1 - t;
      ys.push(u ** 3 * current.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y);
    }
    segments.push({ kind: "curve", from: current, to, ys });
    current = to;
  }
  return segments;
}

const bucket = (date, model, total, provider = "p") => ({
  date,
  hour: 9,
  provider,
  providerName: provider,
  model,
  calls: 1,
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total,
  cost: 0,
});

test("monotone line: degenerate inputs draw nothing impossible", () => {
  assert.equal(monotoneLinePath([]), "");
  assert.equal(monotoneLinePath([{ x: 3, y: 4 }]), "M3,4");
  assert.equal(monotoneLinePath([{ x: 0, y: 0 }, { x: 10, y: 5 }]), "M0,0L10,5");
});

test("monotone line: an increasing run never doubles back on itself", () => {
  const points = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * 20, y: 100 - i * 12 }));
  const path = monotoneLinePath(points);
  assert.equal(path.split("C").length - 1, points.length - 1);
  assert.ok(path.startsWith("M0,100"));
  for (const segment of segmentsOf(path)) {
    const low = Math.min(segment.from.y, segment.to.y) - 1e-6;
    const high = Math.max(segment.from.y, segment.to.y) + 1e-6;
    assert.ok(
      segment.ys.every((y) => y >= low && y <= high),
      `a segment painted outside its own endpoints: ${segment.ys}`,
    );
  }
});

test("monotone line: a spike returns to flat instead of ringing below zero", () => {
  const points = [0, 100, 0, 0].map((y, i) => ({ x: i * 10, y }));
  const low = Math.min(...segmentsOf(monotoneLinePath(points)).flatMap((segment) => segment.ys));
  assert.ok(low >= -1e-6, `dipped under the axis: ${low}`);
});

test("monotone line: non-finite values collapse to the axis rather than poisoning the path", () => {
  const path = monotoneLinePath([{ x: 0, y: Number.NaN }, { x: 10, y: 5 }]);
  assert.ok(!path.includes("NaN"), path);
});

test("donut arc: a lone full slice stops short of closing on itself", () => {
  const full = donutArcPath(50, 50, 28, 43, 0, Math.PI * 2);
  const large = full.match(/A43,43 0 (\d)/)?.[1];
  assert.equal(large, "1", "a 360-degree span must take the long way round");
  assert.ok(!full.includes("NaN"));
});

test("donut arc: a small slice takes the short way", () => {
  const small = donutArcPath(50, 50, 28, 43, 0, 0.4);
  assert.equal(small.match(/A43,43 0 (\d)/)?.[1], "0");
});

test("date ticks: the window's ends are always named", () => {
  for (const total of [1, 3, 14, 15, 30, 60]) {
    assert.ok(showDateTick(0, total), `index 0 of ${total}`);
    assert.ok(showDateTick(total - 1, total), `last of ${total}`);
  }
  assert.equal(showDateTick(1, 14), true, "fourteen points still fit");
  assert.equal(showDateTick(1, 30), false, "thirty points thin to every fifth");
  assert.equal(showDateTick(5, 30), true);
  assert.equal(showDateTick(6, 30), false);
  assert.equal(showDateTick(7, 60), true, "past 45 days the thinning goes weekly");
  assert.equal(showDateTick(8, 60), false);
});

test("trend model: only the busiest six models draw a line", () => {
  const buckets = Array.from({ length: 8 }, (_, i) => bucket("2026-09-01", `m${i}`, 100 - i * 10));
  const model = buildTrendModel(buckets);
  assert.equal(model.series.length, 6);
  assert.deepEqual(
    model.series.map((series) => series.label),
    ["m0", "m1", "m2", "m3", "m4", "m5"],
  );
  assert.equal(model.days[0].total, 520, "the day total counts every model, drawn or not");
  assert.equal(model.peak, 100, "the vertical range follows the tallest visible line");
});

test("trend model: days are ordered and absent models read as zero", () => {
  const buckets = [
    bucket("2026-09-03", "a", 5),
    bucket("2026-09-01", "a", 7),
    bucket("2026-09-02", "b", 4),
  ];
  const model = buildTrendModel(buckets);
  assert.deepEqual(
    model.days.map((day) => day.date),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
  );
  assert.deepEqual(
    model.days.map((day) => day.values),
    [[7, 0], [0, 4], [5, 0]],
  );
});

test("share model: the long tail folds into Other, the top six do not", () => {
  const six = Array.from({ length: 6 }, (_, i) => bucket("2026-09-01", `m${i}`, 10));
  assert.equal(buildShareModel(six).slices.length, 6);
  assert.equal(buildShareModel(six).slices.some((slice) => slice.key === "__other__"), false);

  const seven = Array.from({ length: 7 }, (_, i) => bucket("2026-09-01", `m${i}`, 10));
  const merged = buildShareModel(seven);
  assert.equal(merged.slices.length, 6);
  assert.equal(merged.slices.at(-1).key, "__other__");
  assert.equal(merged.slices.at(-1).tokens, 20, "Other carries the fifth, sixth and seventh models");
});

test("share model: shares sum to one and the ring closes", () => {
  const buckets = [bucket("2026-09-01", "a", 30), bucket("2026-09-01", "b", 70)];
  const model = buildShareModel(buckets, 6, 0.1);
  assert.ok(Math.abs(model.slices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9);
  const swept = model.slices.reduce((sum, slice) => sum + (slice.end - slice.start), 0);
  assert.ok(Math.abs(swept + 0.1 * model.slices.length - Math.PI * 2) < 1e-9, "pad + arcs fill the ring");
  assert.ok(
    model.slices.every((slice, i) => i === 0 || slice.start >= model.slices[i - 1].end),
    "slices never overlap",
  );
});

test("share model: an empty or zero range yields no slices", () => {
  assert.deepEqual(buildShareModel([]), { slices: [], total: 0 });
  assert.deepEqual(buildShareModel([bucket("2026-09-01", "a", 0)]), { slices: [], total: 0 });
});
