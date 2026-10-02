import type { UsageBucket } from "../../../../shared/types.ts";

/**
 * Chart maths, kept free of React so `scripts/web-regression.mjs` can exercise
 * it directly — a malformed path string blanks an entire chart silently, and
 * the failure is invisible in a screenshot review.
 */

export interface Point {
  x: number;
  y: number;
}

/** Two decimals is well under a device pixel at our chart widths, and it keeps
 *  the path string small enough that React's diff of a re-render stays cheap. */
function coord(value: number): string {
  return String(Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);
}

/**
 * Cubic path through the samples, with Fritsch–Carlson monotonicity.
 *
 * Plain Catmull-Rom overshoots: a spike day draws a curve that dips below zero
 * between two real points, which reads as a negative token count. Constraining
 * the tangents keeps every segment inside its neighbours' range, so the line
 * can never lie about the data it was drawn from.
 */
export function monotoneLinePath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  const start = `M${coord(points[0].x)},${coord(points[0].y)}`;
  if (n === 1) return start;
  if (n === 2) return `${start}L${coord(points[1].x)},${coord(points[1].y)}`;

  const run: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    run.push(dx);
    slope.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  const tangent = new Array<number>(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    // a sign change means a local extremum: the slope there must be flat
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const magnitude = Math.hypot(a, b);
    if (magnitude > 3) {
      const scale = 3 / magnitude;
      tangent[i] = scale * a * slope[i];
      tangent[i + 1] = scale * b * slope[i];
    }
  }

  let d = start;
  for (let i = 0; i < n - 1; i += 1) {
    const third = run[i] / 3;
    d +=
      `C${coord(points[i].x + third)},${coord(points[i].y + tangent[i] * third)}` +
      `,${coord(points[i + 1].x - third)},${coord(points[i + 1].y - tangent[i + 1] * third)}` +
      `,${coord(points[i + 1].x)},${coord(points[i + 1].y)}`;
  }
  return d;
}

/**
 * A donut segment between two angles measured clockwise from 12 o'clock.
 *
 * A true full circle cannot be drawn with a single elliptical arc — the start
 * and end points coincide and the browser picks an arbitrary sweep — so a lone
 * 100% slice is clamped just short of closing on itself.
 */
export function donutArcPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const span = Math.min(endAngle - startAngle, Math.PI * 2 - 1e-3);
  const from = startAngle - Math.PI / 2;
  const to = from + span;
  const large = span > Math.PI ? 1 : 0;
  const at = (radius: number, angle: number): string =>
    `${coord(cx + radius * Math.cos(angle))},${coord(cy + radius * Math.sin(angle))}`;

  return (
    `M${at(outerRadius, from)}` +
    `A${coord(outerRadius)},${coord(outerRadius)} 0 ${large} 1 ${at(outerRadius, to)}` +
    `L${at(innerRadius, to)}` +
    `A${coord(innerRadius)},${coord(innerRadius)} 0 ${large} 0 ${at(innerRadius, from)}Z`
  );
}

/** Date ticks. Below fifteen points every day fits; past that the labels collide
 *  every second step, so only a weekly-ish subset is drawn — but the first and
 *  last are always kept, since they define the window being described. */
export function showDateTick(index: number, total: number): boolean {
  if (total <= 14) return true;
  const step = total > 45 ? 7 : 5;
  return index === 0 || index === total - 1 || index % step === 0;
}

export interface ChartSeries {
  key: string;
  label: string;
  colorIndex: number;
}

export interface HeatCell {
  date: string;
  tokens: number;
  calls: number;
}

/** Written out rather than built from the index, because Tailwind only emits a
 *  utility for a class string it can see complete in the source. */
export const HEAT_BG = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"];

/** Four steps between "used at all" and "all day". The thresholds are uneven on
 *  purpose: usage is long-tailed, and a linear ramp paints almost every day in
 *  the bottom two levels, which is a wall of one colour rather than a chart. */
export function heatLevel(tokens: number, peak: number): number {
  if (tokens <= 0) return 0;
  const ratio = tokens / peak;
  if (ratio > 0.6) return 4;
  if (ratio > 0.3) return 3;
  if (ratio > 0.12) return 2;
  return 1;
}


export interface TrendDay {
  date: string;
  total: number;
  /** parallel to `series` */
  values: number[];
}

export interface TrendModel {
  series: ChartSeries[];
  days: TrendDay[];
  /** the tallest single model-day value among the drawn series */
  peak: number;
}

const SERIES_LIMIT = 6;

function modelKey(bucket: UsageBucket): string {
  return `${bucket.provider}/${bucket.model}`;
}

function shortModel(model: string): string {
  return model.includes("/") ? model.split("/").at(-1)! : model;
}

/**
 * Collapse (day × model) buckets into one line per model.
 *
 * Only the busiest six models get a line. A line chart with fifteen series is
 * a colour-matching exercise, not a chart; the remainder still shows in the
 * share donut and the tables below.
 */
export function buildTrendModel(buckets: readonly UsageBucket[], limit = SERIES_LIMIT): TrendModel {
  const totals = new Map<string, { label: string; tokens: number }>();
  for (const bucket of buckets) {
    const key = modelKey(bucket);
    const row = totals.get(key) ?? { label: shortModel(bucket.model), tokens: 0 };
    row.tokens += bucket.total;
    totals.set(key, row);
  }

  const series: ChartSeries[] = [...totals.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, limit)
    .map(([key, row], index) => ({ key, label: row.label, colorIndex: index }));

  const indexOf = new Map(series.map((entry, position) => [entry.key, position] as const));
  const byDate = new Map<string, TrendDay>();
  for (const bucket of buckets) {
    const day = byDate.get(bucket.date) ?? {
      date: bucket.date,
      total: 0,
      values: new Array<number>(series.length).fill(0),
    };
    // The day's total covers every model, drawn or not — the header of the
    // tooltip answers "how much did this day cost", which is not the same
    // question as "which of the six lines is highest".
    day.total += bucket.total;
    const position = indexOf.get(modelKey(bucket));
    if (position !== undefined) day.values[position] += bucket.total;
    byDate.set(bucket.date, day);
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Independent lines, not a stack: the vertical range must follow the tallest
  // visible line, or six models sharing a day scale crush each other to flat.
  let peak = 0;
  for (const day of days) for (const value of day.values) peak = Math.max(peak, value);

  return { series, days, peak };
}

export interface ShareSlice {
  key: string;
  label: string;
  colorIndex: number;
  tokens: number;
  share: number;
  /** radians, clockwise from 12 o'clock, gap already applied */
  start: number;
  end: number;
}

export interface ShareModel {
  slices: ShareSlice[];
  total: number;
}

/**
 * Model share as donut angles, with the long tail folded into one slice.
 *
 * Merging is conditional on actually overflowing: six models draw six honest
 * slices, while seven draw six plus an "Other" so the ring never contains a
 * sliver too thin to hover.
 */
export function buildShareModel(
  buckets: readonly UsageBucket[],
  limit = SERIES_LIMIT,
  padAngle = 0,
): ShareModel {
  const totals = new Map<string, { label: string; tokens: number }>();
  for (const bucket of buckets) {
    const key = modelKey(bucket);
    const row = totals.get(key) ?? { label: shortModel(bucket.model), tokens: 0 };
    row.tokens += bucket.total;
    totals.set(key, row);
  }

  const ranked = [...totals.entries()]
    .map(([key, row]) => ({ key, ...row }))
    .sort((a, b) => b.tokens - a.tokens)
    .filter((row) => row.tokens > 0);

  const total = ranked.reduce((sum, row) => sum + row.tokens, 0);
  if (total <= 0) return { slices: [], total: 0 };

  const overflow = ranked.length > limit;
  const kept = ranked.slice(0, overflow ? limit - 1 : limit);
  const rest = ranked.slice(kept.length);
  const rows = rest.length
    ? [...kept, { key: "__other__", label: "other", tokens: rest.reduce((sum, row) => sum + row.tokens, 0) }]
    : kept;

  const gap = rows.length > 1 ? padAngle : 0;
  const usable = Math.PI * 2 - gap * rows.length;
  let cursor = 0;
  const slices = rows.map((row, index) => {
    const share = row.tokens / total;
    const start = cursor + gap / 2;
    const end = start + share * usable;
    cursor = end + gap / 2;
    return {
      key: row.key,
      label: row.label,
      colorIndex: index,
      tokens: row.tokens,
      share,
      start,
      end,
    } satisfies ShareSlice;
  });

  return { slices, total };
}
