import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { UsageBucket } from "@shared/types";
import { cn } from "../../lib/cn";
import { compactTokens, percent } from "../../lib/format";
import { localeTag, t } from "../../lib/i18n";
import {
  buildShareModel,
  buildTrendModel,
  donutArcPath,
  heatLevel,
  monotoneLinePath,
  showDateTick,
  type HeatCell,
  type ShareSlice,
} from "./chart-geometry";

/**
 * The usage charts.
 *
 * Hand-drawn SVG rather than a charting library. There are exactly four shapes
 * here — a line series, a padded donut, a week grid and a bar row — and each is
 * a few dozen lines of path maths, while a library buys them with an internal
 * data store that re-dispatches on every parent render, its own resize
 * machinery, and enough bytes to matter in a window opened by a click.
 *
 * Every chart owns one tooltip. Attaching a hover target to each point is how a
 * 30-day series ends up with sixty listeners and sixty layout roots; the chart
 * already knows where the hovered thing is, so the card is placed from that.
 */

/** Positional, not name-derived: a model keeps its hue as the ranking shifts
 *  beneath it. Shared with the donut so the two charts agree about a colour. */
function seriesColor(index: number): string {
  return `var(--chart-${(index % 6) + 1})`;
}

/**
 * Width of an element, measured before paint so a chart never shows an empty
 * frame first.
 *
 * The sub-pixel guard is not cosmetic: `ResizeObserver` reports fractional
 * widths, and re-rendering a 30-point SVG on each 0.4px would keep the chart
 * churning long after the window stopped moving.
 */
function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** rAF-coalesced hover: `pointermove` can outrun the frame budget on a slow
 *  machine, and one sample per frame is all a cursor can be. */
function useHoverTracker() {
  const frame = useRef(0);
  return (apply: () => void) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(apply);
  };
}

/**
 * A floating card anchored to a point inside the nearest `relative` ancestor.
 *
 * It always opens upward and is never clipped: no chart here sits inside an
 * `overflow` container, and the ones that scroll keep the tooltip outside the
 * scroller on purpose.
 */
function ChartTip({
  x,
  y,
  hostWidth,
  children,
}: {
  x: number;
  y: number;
  hostWidth: number;
  children: ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[232px] rounded-control border border-line bg-surface px-2.5 py-2 shadow-overlay"
      style={{
        left: Math.min(Math.max(x, 100), Math.max(100, hostWidth - 100)),
        top: y,
        transform: "translate(-50%, calc(-100% - 12px))",
      }}
    >
      {children}
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-ui-sm">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** A value with no colour of its own — a count, not a series. */
function TipLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-ui-sm">
      <span className="min-w-0 flex-1 text-ink-2">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="rounded-control border border-dashed border-line-strong px-4 py-9 text-center">
      <div className="text-ui-caption font-medium text-ink-2">{t("Nothing to chart yet")}</div>
      <div className="mt-1 text-ui-sm text-ink-3">{t("No model calls in this range.")}</div>
    </div>
  );
}

const shortDay = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(localeTag(), { month: "short", day: "numeric" });

const longDay = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(localeTag(), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const hourLabel = (hour: number): string => {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
};

/* ── daily model trend ─────────────────────────────────── */

/* The reference chart pads 8px top, 24px each side and rides in a 240px box,
   ticks included — copied here so both apps' trends read identically. */
const INSET = { left: 24, right: 24, top: 8 };
const PLOT_HEIGHT = 216;
const AXIS_BAND = 24;

export function ModelTrendChart({ buckets }: { buckets: UsageBucket[] }) {
  const [hostRef, width] = useChartWidth<HTMLDivElement>();
  const track = useHoverTracker();
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => buildTrendModel(buckets), [buckets]);
  const count = model.days.length;
  const plotWidth = Math.max(0, width - INSET.left - INSET.right);
  const step = count > 1 ? plotWidth / (count - 1) : 0;
  const xAt = (index: number): number => INSET.left + (step > 0 ? index * step : plotWidth / 2);
  const yAt = (value: number): number =>
    INSET.top + (PLOT_HEIGHT - INSET.top) * (1 - (model.peak > 0 ? value / model.peak : 0));

  const paths = useMemo(
    () =>
      model.series.map((series, position) =>
        monotoneLinePath(
          model.days.map((day, index) => ({ x: xAt(index), y: yAt(day.values[position] ?? 0) })),
        ),
      ),
    [model, width],
  );

  const active = hover === null ? null : (model.days[hover] ?? null);
  let tipTop = INSET.top;
  if (active) {
    let highest = Number.POSITIVE_INFINITY;
    for (const value of active.values) if (value > 0) highest = Math.min(highest, yAt(value));
    if (Number.isFinite(highest)) tipTop = highest;
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-hairline">
      <h3 className="text-ui-base font-medium text-ink">{t("Daily token trend")}</h3>
      {count === 0 || model.peak <= 0 ? (
        <ChartEmpty />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {model.series.map((series, index) => (
              <div key={series.key} className="flex min-w-0 items-center gap-2 text-ui-sm">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: seriesColor(index) }}
                />
                <span className="max-w-[150px] truncate text-ink-3">{series.label}</span>
              </div>
            ))}
          </div>

          <div
            ref={hostRef}
            className="relative"
            style={{ height: PLOT_HEIGHT + AXIS_BAND }}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const raw = step > 0 ? Math.round((event.clientX - box.left - INSET.left) / step) : 0;
              const next = Math.min(Math.max(raw, 0), count - 1);
              track(() => setHover(next));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {width > 0 ? (
              <svg width={width} height={PLOT_HEIGHT + AXIS_BAND} className="block">
                {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                  const y = INSET.top + (PLOT_HEIGHT - INSET.top) * fraction;
                  return (
                    <line
                      key={fraction}
                      x1={INSET.left}
                      x2={width - INSET.right}
                      y1={y}
                      y2={y}
                      className="stroke-line"
                      strokeDasharray="3 3"
                    />
                  );
                })}
                {paths.map((d, index) => (
                  <path
                    key={model.series[index].key}
                    d={d}
                    fill="none"
                    stroke={seriesColor(index)}
                    strokeWidth={2}
                    pathLength={1}
                    className="chart-draw"
                  />
                ))}
                {active && hover !== null
                  ? active.values.map((value, position) =>
                      value > 0 ? (
                        <circle
                          key={model.series[position].key}
                          cx={xAt(hover)}
                          cy={yAt(value)}
                          r={4}
                          fill={seriesColor(position)}
                          className="stroke-surface"
                          strokeWidth={1.5}
                        />
                      ) : null,
                    )
                  : null}
              </svg>
            ) : null}

            {model.days.map((day, index) =>
              showDateTick(index, count) ? (
                <span
                  key={day.date}
                  className={cn(
                    "pointer-events-none absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-ui-xs tabular-nums text-ink-3",
                    hover === index && "text-ink",
                  )}
                  /* The first and last ticks are centred on the plot's edge, so
                     half of each would hang outside the host and wrap into a
                     vertical stack of glyphs; both are pulled inside. */
                  style={{ left: Math.min(Math.max(xAt(index), 26), Math.max(26, width - 26)) }}
                >
                  {shortDay(day.date)}
                </span>
              ) : null,
            )}

            {active && hover !== null ? (
              <ChartTip x={xAt(hover)} y={tipTop} hostWidth={width}>
                <div className="mb-1 text-ui-xs tabular-nums text-ink-3">
                  {shortDay(active.date)} · {compactTokens(active.total)} {t("tokens")}
                </div>
                <div className="flex flex-col gap-0.5">
                  {model.series.map((series, position) => {
                    const value = active.values[position] ?? 0;
                    // A model idle that day has no point on the chart; listing it
                    // would read as "you used this, a little".
                    if (value <= 0) return null;
                    return (
                      <TipRow
                        key={series.key}
                        color={seriesColor(position)}
                        label={series.label}
                        value={compactTokens(value)}
                      />
                    );
                  })}
                </div>
              </ChartTip>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/* ── model share ───────────────────────────────────────── */

const RING = { inner: 28, outer: 43, hovered: 46 };
const PAD_ANGLE = (2 * Math.PI) / 180;

/** The merged tail slice is labelled by the caller: `chart-geometry` is a pure
 *  module and has no business importing the dictionary. */
const sliceLabel = (slice: ShareSlice): string => (slice.key === "__other__" ? t("Other") : slice.label);

export function ModelShareChart({ buckets }: { buckets: UsageBucket[] }) {
  const model = useMemo(() => buildShareModel(buckets, 6, PAD_ANGLE), [buckets]);
  const hostRef = useRef<HTMLDivElement>(null);
  const track = useHoverTracker();
  const [hover, setHover] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const active: ShareSlice | null = model.slices.find((slice) => slice.key === hover) ?? null;

  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-hairline">
      <h3 className="text-ui-base font-medium text-ink">{t("Model usage")}</h3>
      {model.slices.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="grid gap-4 px-3 py-3 md:grid-cols-2">
          <div
            ref={hostRef}
            className="relative mx-auto h-56 w-full max-w-64 self-center md:h-64 md:max-w-72"
            onPointerLeave={() => {
              setHover(null);
              setPoint(null);
            }}
          >
            <svg
              viewBox="0 0 100 100"
              className="block h-full w-full"
              onPointerMove={(event) => {
                const box = hostRef.current?.getBoundingClientRect();
                if (!box) return;
                const x = event.clientX - box.left;
                const y = event.clientY - box.top;
                track(() => setPoint({ x, y }));
              }}
            >
              {model.slices.map((slice) => {
                const on = slice.key === hover;
                return (
                  <path
                    key={slice.key}
                    d={donutArcPath(50, 50, RING.inner, on ? RING.hovered : RING.outer, slice.start, slice.end)}
                    fill={seriesColor(slice.colorIndex)}
                    className={cn("transition-opacity duration-150", hover && !on && "opacity-70")}
                    onPointerEnter={() => setHover(slice.key)}
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-8 text-center">
              <div className="max-w-full truncate text-ui-sm font-semibold tabular-nums text-ink">
                {compactTokens(model.total)}
              </div>
              <div className="max-w-full truncate text-ui-sm text-ink-3">{t("tokens")}</div>
            </div>
            {active && point ? (
              <ChartTip x={point.x} y={point.y} hostWidth={hostRef.current?.clientWidth ?? 0}>
                <TipRow
                  color={seriesColor(active.colorIndex)}
                  label={sliceLabel(active)}
                  value={`${compactTokens(active.tokens)} · ${percent(active.share)}`}
                />
              </ChartTip>
            ) : null}
          </div>

          <div className="min-w-0 self-center" role="list">
            {model.slices.map((slice) => (
              <div
                key={slice.key}
                role="listitem"
                onPointerEnter={() => setHover(slice.key)}
                onPointerLeave={() => setHover(null)}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-line/70 py-2 last:border-b-0",
                  hover === slice.key && "bg-hover",
                )}
              >
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: seriesColor(slice.colorIndex) }}
                />
                <span className="min-w-0 truncate font-mono text-ui-sm text-ink">{sliceLabel(slice)}</span>
                <span className="font-mono text-ui-sm tabular-nums text-ink-3">
                  {percent(slice.share)}
                </span>
                <span />
                <span className="col-start-2 min-w-0 truncate text-ui-sm text-ink-3">
                  {compactTokens(slice.tokens)} {t("tokens")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ── activity heatmap ──────────────────────────────────── */

export type HeatmapMode = "daily" | "weekly" | "cumulative";

/** One column of the grid, pre-computed for the active mode. */
interface HeatColumn {
  key: string;
  /** end date of whatever the column covers (a day, or the week's last day) */
  date: string;
  tooltipTitle: string | null;
  cells: Array<{ key: string; level: number; hasUsage: boolean }>;
}

/** ZCode's level scale: four steps between "touched" and "maxed out", computed
 *  against the mode's own peak — a weekly column shares the ramp with a day. */
function levelOf(value: number, peak: number): number {
  if (value <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / peak) * 4)));
}

/** How deep a weekly/cumulative column fills: 1–7 of its cells, bottom-up. */
function fillOf(value: number, peak: number): number {
  if (value <= 0) return 0;
  return Math.min(7, Math.max(1, Math.ceil((value / peak) * 7)));
}

export function ActivityHeatmap({
  weeks,
  months,
  peak,
  mode,
  selected,
  onSelect,
}: {
  weeks: Array<Array<HeatCell | null>>;
  months: Array<{ index: number; label: string }>;
  peak: number;
  /** daily colours every day on its own; weekly and cumulative aggregate the
   *  column and paint a bottom-aligned block of it */
  mode: HeatmapMode;
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const track = useHoverTracker();
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: Array<[string, string]> } | null>(
    null,
  );

  const columns = useMemo<HeatColumn[]>(() => {
    if (mode === "daily") {
      return weeks.map((week, weekIndex) => ({
        key: `daily-${weekIndex}`,
        date: week.find(Boolean)?.date ?? "",
        tooltipTitle: "",
        cells: week.map((cell, dayIndex) => {
          const entry = cell ?? { date: `empty-${weekIndex}-${dayIndex}`, tokens: 0, calls: 0 };
          return {
            key: entry.date,
            level: heatLevel(entry.tokens, peak),
            hasUsage: entry.tokens > 0,
          };
        }),
      }));
    }
    const totals = weeks.map((week) => week.reduce((sum, cell) => sum + (cell?.tokens ?? 0), 0));
    const calls = weeks.map((week) => week.reduce((sum, cell) => sum + (cell?.calls ?? 0), 0));
    const running = mode === "cumulative";
    const values = running
      ? totals.reduce<Array<number>>((out, value) => {
          out.push((out.at(-1) ?? 0) + value);
          return out;
        }, [])
      : totals;
    const counts = running
      ? calls.reduce<Array<number>>((out, value) => {
          out.push((out.at(-1) ?? 0) + value);
          return out;
        }, [])
      : calls;
    const peakValue = Math.max(0, ...values);
    return weeks.map((week, weekIndex) => {
      const value = values[weekIndex] ?? 0;
      const level = levelOf(value, peakValue);
      const fill = fillOf(value, peakValue);
      const date = [...week].reverse().find(Boolean)?.date ?? "";
      return {
        key: `${mode}-${weekIndex}`,
        date,
        tooltipTitle: "",
        cells: week.map((cell, dayIndex) => {
          const painted = dayIndex >= 7 - fill;
          return {
            key: cell?.date ?? `${weekIndex}-${dayIndex}`,
            level: painted ? level : 0,
            hasUsage: painted && value > 0,
          };
        }),
      };
    });
  }, [weeks, peak, mode]);

  // totals for the aggregate tooltip, kept beside the columns they describe
  const columnTotals = useMemo(() => {
    const totals = weeks.map((week) => week.reduce((sum, cell) => sum + (cell?.tokens ?? 0), 0));
    const calls = weeks.map((week) => week.reduce((sum, cell) => sum + (cell?.calls ?? 0), 0));
    return mode === "cumulative"
      ? totals.map((_, index) => ({
          tokens: totals.slice(0, index + 1).reduce((a, b) => a + b, 0),
          calls: calls.slice(0, index + 1).reduce((a, b) => a + b, 0),
        }))
      : totals.map((tokens, index) => ({ tokens, calls: calls[index] }));
  }, [weeks, mode]);

  /** Month labels ride a second grid of the same column count, each label
   *  spanning the weeks it covers — the reference's own trick, which keeps the
   *  labels aligned without absolute positioning. */
  const monthSpans = useMemo(() => {
    const out: Array<{ key: string; label: string; span: number }> = [];
    for (const month of months) {
      const start = month.index;
      const next = months.find((candidate) => candidate.index > start);
      const span = Math.max(1, (next?.index ?? weeks.length) - start);
      out.push({ key: `${month.label}-${start}`, label: month.label, span });
    }
    return out;
  }, [months, weeks.length]);

  const gridStyle = {
    gridTemplateColumns: `repeat(${Math.max(1, weeks.length)}, minmax(0, 1fr))`,
    /* a year of weeks fills the card; fewer weeks must not stretch into giant
       squares, so the grid is capped and centred instead */
    maxWidth: Math.min(100, weeks.length) * 22,
  };

  const showTip = (
    event: React.PointerEvent<HTMLElement>,
    title: string,
    lines: Array<[string, string]>,
  ) => {
    const host = rootRef.current;
    if (!host) return;
    const box = event.currentTarget.getBoundingClientRect();
    const root = host.getBoundingClientRect();
    const x = box.left - root.left + box.width / 2;
    const y = box.top - root.top;
    track(() => setHover({ x, y, title, lines }));
  };

  return (
    <div ref={rootRef} className="relative" onPointerLeave={() => setHover(null)}>
      <div className="mx-auto grid w-full gap-x-0.5" style={gridStyle}>
        {columns.map((column, columnIndex) => {
          const aggregate = mode !== "daily";
          const tooltipTitle =
            mode === "daily" ? longDay(column.date) : `${longDay(column.date)} · ${t(mode === "weekly" ? "week" : "to date")}`;
          const lines =
            mode === "daily"
              ? null
              : ([
                  [t("tokens"), compactTokens(columnTotals[columnIndex]?.tokens ?? 0)],
                  [t("calls"), String(columnTotals[columnIndex]?.calls ?? 0)],
                ] as Array<[string, string]>);
          return (
            <div
              key={column.key}
              className={cn("flex min-w-0 flex-col gap-1", aggregate && "group/usage-heatmap-column")}
              onPointerEnter={(event) => {
                if (!aggregate) return;
                showTip(event, tooltipTitle, lines ?? []);
              }}
            >
              {column.cells.map((cell, dayIndex) => {
                const cellDate = weeks[columnIndex]?.[dayIndex]?.date;
                const selectable = mode === "daily" && Boolean(cellDate);
                const isSelected = Boolean(cellDate && selected === cellDate);
                const tile = (
                  <button
                    key={cell.key}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={cellDate ? longDay(cellDate) : undefined}
                    tabIndex={selectable ? 0 : -1}
                    onClick={() => {
                      if (!selectable || !cellDate) return;
                      onSelect(selected === cellDate ? null : cellDate);
                    }}
                    onPointerEnter={(event) => {
                      if (!cellDate || aggregate) return;
                      showTip(event, longDay(cellDate), [
                        [t("tokens"), compactTokens(weeks[columnIndex][dayIndex]!.tokens)],
                        [t("calls"), String(weeks[columnIndex][dayIndex]!.calls)],
                      ]);
                    }}
                    className={cn(
                      "aspect-square w-full min-w-0 rounded-[4px] border",
                      "transition-transform hover:scale-110 hover:border-line-strong",
                      cell.hasUsage ? "border-line" : "border-transparent",
                      aggregate && "group-hover/usage-heatmap-column:border-line-strong",
                      isSelected && "scale-[1.15] shadow-[0_0_0_1.5px_var(--surface),0_0_0_3px_var(--accent-ink)]",
                    )}
                    style={{ backgroundColor: `var(--heat-${cell.level})` }}
                  />
                );
                return tile;
              })}
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-3 grid w-full gap-x-0.5" style={gridStyle}>
        {monthSpans.map((month) => (
          <div
            key={month.key}
            data-usage-heatmap-month-label
            className="min-w-0 truncate text-ui-sm text-ink-3"
            style={{ gridColumn: `span ${month.span}` }}
          >
            {month.label}
          </div>
        ))}
      </div>

      {hover ? (
        <ChartTip x={hover.x} y={hover.y} hostWidth={rootRef.current?.clientWidth ?? 0}>
          <div className="mb-1 text-ui-xs tabular-nums text-ink-3">{hover.title}</div>
          <div className="flex flex-col gap-0.5">
            {hover.lines.map(([label, value]) => (
              <TipLine key={label} label={label} value={value} />
            ))}
          </div>
        </ChartTip>
      ) : null}
    </div>
  );
}

/* ── hour-of-day bars ──────────────────────────────────── */

const HOUR_HEIGHT = 48;
const HOUR_LABEL_BAND = 14;

export function HourBars({
  hours,
  selected,
  onSelect,
  faded,
}: {
  hours: number[];
  selected: number | null;
  onSelect: (hour: number | null) => void;
  /** a day is drilled into, so an empty hour reads as empty rather than gone */
  faded: boolean;
}) {
  const [hostRef, width] = useChartWidth<HTMLDivElement>();
  const track = useHoverTracker();
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...hours);
  const slot = width / 24;

  return (
    <div className="border-t border-line pt-3">
      <div ref={hostRef} className="relative flex items-end gap-[3px]" onPointerLeave={() => setHover(null)}>
        {hours.map((tokens, hour) => {
          const ratio = tokens / peak;
          const on = selected === hour;
          return (
            <button
              key={hour}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? null : hour)}
              onPointerEnter={() => setHover(hour)}
              className="group flex flex-1 flex-col items-center justify-end gap-1"
            >
              <span
                className="relative flex w-full items-end overflow-hidden"
                style={{ height: HOUR_HEIGHT }}
              >
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 h-full origin-bottom rounded-[2px]",
                    on
                      ? "bg-accent"
                      : tokens > 0
                        ? "bg-[color-mix(in_oklch,var(--ink-3)_55%,var(--surface))] group-hover:bg-accent"
                        : "bg-field",
                  )}
                  style={{
                    transform: `scaleY(${tokens > 0 ? Math.max(0.06, ratio) : 0.05})`,
                    opacity: faded && !tokens ? 0.5 : 1,
                    transition:
                      "transform 460ms var(--ease-out-strong-css), background-color 150ms ease-out, opacity 200ms ease-out",
                  }}
                />
              </span>
              {hour % 6 === 0 ? (
                <span className="text-ui-xs tabular-nums text-ink-3">{hour}</span>
              ) : (
                <span style={{ height: HOUR_LABEL_BAND - 3 }} />
              )}
            </button>
          );
        })}

        {hover !== null && width > 0 ? (
          <ChartTip
            x={hover * slot + slot / 2}
            y={HOUR_HEIGHT * (1 - Math.max(0.06, hours[hover] / peak))}
            hostWidth={width}
          >
            <div className="mb-1 text-ui-xs tabular-nums text-ink-3">{hourLabel(hover)}</div>
            <TipLine label={t("tokens")} value={compactTokens(hours[hover])} />
          </ChartTip>
        ) : null}
      </div>
    </div>
  );
}
