import { Fragment, useMemo, useState } from "react";
import { cacheHitRate } from "@shared/cache-usage";
import type { UsageBucket, UsageStats } from "@shared/types";
import { compactTokens, formatContext, percent } from "../lib/format";
import { cn } from "../lib/cn";
import { localeTag, t, tf } from "../lib/i18n";
import { ClockIcon, RefreshIcon } from "../components/icons";
import { Card, Chip, EmptyState, Skeleton, StatCard, ViewHeader } from "../components/ui";
import { GlideList, SlidingGroup } from "../components/motion";
import {
  ActivityHeatmap,
  HourBars,
  ModelShareChart,
  ModelTrendChart,
  type HeatmapMode,
} from "../components/charts/usage-charts";
import { ChartBoundary } from "../components/charts/ChartBoundary";
import { UsageInsights, UsageRecords } from "./usage-insights";

const MOBY_DICK_TOKENS = 268_000;

interface Aggregate {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  hitRate: number;
}

/** The headline figures: one surface, five cells, hairline dividers. The value
 *  is the loudest thing in the cell and the label the quietest — ZCode's own
 *  summary strip, which reads as one sentence rather than eight competing
 *  cards. */
function SummaryStrip({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-surface shadow-hairline sm:flex-row sm:items-center">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? <div aria-hidden className="hidden h-7 w-px shrink-0 bg-line sm:block" /> : null}
          <div className="min-w-0 flex-1 px-4 py-3 text-center">
            <div className="truncate text-ui-lg font-medium tabular-nums text-ink">{item.value}</div>
            <div className="mt-1 truncate text-ui-base text-ink-3">{item.label}</div>
          </div>
        </Fragment>
      ))}
    </section>
  );
}

function aggregate(buckets: UsageBucket[]): Aggregate {
  const out: Aggregate = {
    calls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    hitRate: 0,
  };
  for (const bucket of buckets) {
    out.calls += bucket.calls;
    out.input += bucket.input;
    out.output += bucket.output;
    out.cacheRead += bucket.cacheRead;
    out.cacheWrite += bucket.cacheWrite;
    out.total += bucket.total;
    out.cost += bucket.cost;
  }
  out.hitRate = cacheHitRate(out);
  return out;
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(localeTag(), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type Tab = "overview" | "insights" | "models" | "cache";
type Range = 0 | 7 | 30;

export function UsageView({
  stats,
  loading,
  range,
  onRange,
  onRefresh,
  embedded = false,
}: {
  stats: UsageStats | null;
  loading: boolean;
  range: Range;
  onRange: (range: Range) => void;
  onRefresh: () => void;
  /** rendered inside Settings, which supplies its own section chrome */
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [heatMode, setHeatMode] = useState<HeatmapMode>("daily");
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [drillHour, setDrillHour] = useState<number | null>(null);

  const buckets = stats?.buckets ?? [];

  const dayTotals = useMemo(() => {
    const map = new Map<string, { tokens: number; calls: number; cacheRead: number; input: number }>();
    for (const bucket of buckets) {
      const current = map.get(bucket.date) ?? { tokens: 0, calls: 0, cacheRead: 0, input: 0 };
      current.tokens += bucket.total;
      current.calls += bucket.calls;
      current.cacheRead += bucket.cacheRead;
      current.input += bucket.input;
      map.set(bucket.date, current);
    }
    return map;
  }, [buckets]);

  const hourTotals = useMemo(() => {
    const hours = new Array(24).fill(0) as number[];
    for (const bucket of buckets) {
      if (drillDate && bucket.date !== drillDate) continue;
      hours[bucket.hour] += bucket.total;
    }
    return hours;
  }, [buckets, drillDate]);

  const filtered = useMemo(
    () =>
      buckets.filter(
        (bucket) => (!drillDate || bucket.date === drillDate) && (drillHour === null || bucket.hour === drillHour),
      ),
    [buckets, drillDate, drillHour],
  );

  const selection = useMemo(() => aggregate(filtered), [filtered]);

  const modelRows = useMemo(() => {
    const map = new Map<string, { provider: string; providerName: string; model: string } & Aggregate>();
    for (const bucket of filtered) {
      const key = `${bucket.provider}/${bucket.model}`;
      const row = map.get(key) ?? {
        provider: bucket.provider,
        providerName: bucket.providerName,
        model: bucket.model,
        calls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        cost: 0,
        hitRate: 0,
      };
      row.calls += bucket.calls;
      row.input += bucket.input;
      row.output += bucket.output;
      row.cacheRead += bucket.cacheRead;
      row.cacheWrite += bucket.cacheWrite;
      row.total += bucket.total;
      row.cost += bucket.cost;
      map.set(key, row);
    }
    const rows = [...map.values()].map((row) => ({ ...row, hitRate: cacheHitRate(row) }));
    return rows.sort((a, b) => b.total - a.total);
  }, [filtered]);

  const providerRows = useMemo(() => {
    const map = new Map<string, { provider: string; providerName: string; models: Set<string> } & Aggregate>();
    for (const bucket of filtered) {
      const row = map.get(bucket.provider) ?? {
        provider: bucket.provider,
        providerName: bucket.providerName,
        models: new Set<string>(),
        calls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        cost: 0,
        hitRate: 0,
      };
      row.models.add(bucket.model);
      row.calls += bucket.calls;
      row.input += bucket.input;
      row.output += bucket.output;
      row.cacheRead += bucket.cacheRead;
      row.cacheWrite += bucket.cacheWrite;
      row.total += bucket.total;
      row.cost += bucket.cost;
      map.set(bucket.provider, row);
    }
    return [...map.values()]
      .map((row) => ({ ...row, hitRate: cacheHitRate(row) }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  /* The reference always draws a full year — 52 columns of seven days ending
     with the current week — because the grid itself is the chart: days the
     scanner has no log for paint as the dim tile, and the eye reads the shape
     of the year, not of the data we happen to have. */
  const heatmap = useMemo(() => {
    const days = stats?.days ?? [];
    const byDate = new Map(days.map((day) => [day.date, day]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // weeks run Sunday-start; the last column is the week in progress, its
    // future days drawn as the empty tile like the reference's
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()));
    const start = new Date(weekEnd);
    start.setDate(start.getDate() - 52 * 7 + 1);

    const weeks: Array<Array<{ date: string; tokens: number; calls: number } | null>> = [];
    const months: Array<{ index: number; label: string }> = [];
    let lastMonth = -1;
    const cursor = new Date(start);
    while (cursor <= weekEnd) {
      const week: Array<{ date: string; tokens: number; calls: number } | null> = [];
      for (let index = 0; index < 7; index += 1) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
          cursor.getDate(),
        ).padStart(2, "0")}`;
        const entry = byDate.get(key);
        week.push(entry ? { date: entry.date, tokens: entry.tokens, calls: entry.calls } : { date: key, tokens: 0, calls: 0 });
        if (index === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth();
          months.push({ index: weeks.length, label: cursor.toLocaleDateString(localeTag(), { month: "short" }) });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    /* a year produces ~13 month boundaries; the reference keeps the most recent
       twelve labelled and blanks the rest — the spans still hold the columns,
       the gutter just stops growing crowded */
    const labelledMonths = months.map((month, index) => ({
      ...month,
      label: index < months.length - 12 ? "" : month.label,
    }));
    const max = Math.max(1, ...days.map((day) => day.tokens));
    return { weeks, max, months: labelledMonths };
  }, [stats]);

  const peakDay = useMemo(() => {
    const days = stats?.days ?? [];
    return days.reduce<{ date: string; tokens: number } | null>(
      (best, day) => (!best || day.tokens > best.tokens ? { date: day.date, tokens: day.tokens } : best),
      null,
    );
  }, [stats]);

  /* Embedded in Settings, this view supplies no page header — Settings already
   * has one, and a second full-bleed bar inside a scrolling section reads as a
   * different page. The range control and the subtitle move into the body. */
  const Header = ({
    subtitle,
    actions,
  }: {
    subtitle?: string;
    actions?: React.ReactNode;
  }) =>
    embedded ? (
      <div className="flex flex-wrap items-center gap-2">
        {subtitle ? <span className="min-w-0 flex-1 truncate text-ui-caption text-ink-3">{subtitle}</span> : <span className="flex-1" />}
        {actions}
      </div>
    ) : (
      <ViewHeader title={t("Usage")} subtitle={subtitle} actions={actions} />
    );

  /* ZCode's range control: a pill of round tabs on the card surface, the active
     one painted in the page colour. Our SlidingGroup keeps the animation; only
     the shapes and the labels are the reference's. */
  const rangePicker = (
    <div className="flex items-center gap-1.5">
      <SlidingGroup
        activeIndex={([7, 30, 0] as Range[]).indexOf(range)}
        className="flex h-7 items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-hairline"
        pillClassName="rounded-full bg-page shadow-none"
      >
        {([7, 30, 0] as Range[]).map((value) => (
          <button
            key={value}
            data-slide-item
            type="button"
            onClick={() => onRange(value)}
            className={cn(
              "pressable relative z-10 h-6 flex-none rounded-full px-2.5 text-ui-sm font-medium",
              range === value ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {value === 0 ? t("All time") : value === 7 ? t("Last 7 days") : t("Last 30 days")}
          </button>
        ))}
      </SlidingGroup>
      <Chip onClick={onRefresh} title={t("Rescan sessions")}>
        <RefreshIcon size={12} />
        {t("Rescan")}
      </Chip>
    </div>
  );

  if (loading && !stats) {
    return (
      <>
        <Header subtitle={t("Reading local session logs")} actions={rangePicker} />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[68px]" />
          ))}
        </div>
        <Skeleton className="h-[220px]" />
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <Header actions={rangePicker} />
        <EmptyState
          title={t("No usage data")}
          body={t("Start a conversation and token usage will show up here.")}
        />
      </>
    );
  }

  const kpis = stats.kpis;
  const drilled = drillDate !== null || drillHour !== null;

  return (
    <>
      <Header
        subtitle={tf("{count} session files · {sessions} sessions · {messages} assistant messages", {
          count: stats.scannedFiles,
          sessions: stats.sessionCount,
          messages: stats.messageCount,
        })}
        actions={rangePicker}
      />
      <div className="flex flex-col gap-3">
        <div className={embedded ? "" : "scrollbar-thin min-h-0 flex-1 overflow-y-auto"}>
          <div className={embedded ? "" : "mx-auto flex w-full max-w-[1180px] flex-col gap-3 p-4"}>
          <div className="flex items-center gap-1">
            {(
              [
                ["overview", "Overview"],
                ["insights", "Insights"],
                ["models", "Models"],
                ["cache", "Cache"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "h-6 rounded-chip px-2 text-ui-caption transition-colors duration-100",
                  tab === key ? "bg-field font-medium text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {t(label)}
              </button>
            ))}
            <span className="flex-1" />
            {drilled ? (
              <Chip
                active
                onClick={() => {
                  setDrillDate(null);
                  setDrillHour(null);
                }}
              >
                <ClockIcon size={12} />
                {drillDate ? dayLabel(drillDate) : ""}
                {drillHour !== null ? ` ${hourLabel(drillHour)}` : ""} · {t("clear")}
              </Chip>
            ) : null}
          </div>

          {drilled ? (
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-card bg-accent-tint px-3 py-2 text-ui-caption text-ink"
              style={{ animation: "pop-in 220ms var(--ease-out-strong-css) both", transformOrigin: "top left" }}
            >
              <span className="font-medium">{t("Selected slice")}</span>
              <span className="tabular-nums">{selection.calls} {t("calls")}</span>
              <span className="tabular-nums">{compactTokens(selection.total)} {t("tokens")}</span>
              <span className="tabular-nums">{t("cache hit")} {percent(selection.hitRate)}</span>
              <span className="tabular-nums">{t("in")} {compactTokens(selection.input)}</span>
              <span className="tabular-nums">{t("out")} {compactTokens(selection.output)}</span>
              <span className="tabular-nums">{t("cache read")} {compactTokens(selection.cacheRead)}</span>
              {selection.cost > 0 ? <span className="tabular-nums">${selection.cost.toFixed(4)}</span> : null}
            </div>
          ) : null}

          {tab === "overview" ? (
            <div key="overview" className="view-enter flex flex-col gap-5">
              {/* ZCode's reading order: the lifetime strip, then when the work
                  happened (token activity), then how much over the chosen range
                  (trend), how it splits (share), and what the split served from
                  cache. Each is full width — two half-width charts side by side
                  is two charts nobody can hover without nudging the other. */}
              <SummaryStrip
                items={[
                  { label: t("Total tokens"), value: compactTokens(stats.totals.total) },
                  { label: t("Peak tokens"), value: compactTokens(heatmap.max) },
                  { label: t("Active days"), value: kpis.activeDays },
                  { label: t("Current streak"), value: tf("{count}d", { count: kpis.currentStreak }) },
                  { label: t("Longest streak"), value: tf("{count}d", { count: kpis.longestStreak }) },
                ]}
              />
              <Card index={8} className="flex flex-col gap-3 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-ui-base font-medium text-ink">{t("Token activity")}</div>
                  {/* daily colours every day; weekly and cumulative fill each
                      column bottom-up, the reference's own three modes */}
                  <SlidingGroup
                    activeIndex={(["daily", "weekly", "cumulative"] as HeatmapMode[]).indexOf(heatMode)}
                    className="flex h-7 flex-none items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-hairline"
                    pillClassName="rounded-full bg-page shadow-none"
                  >
                    {(["daily", "weekly", "cumulative"] as HeatmapMode[]).map((value) => (
                      <button
                        key={value}
                        data-slide-item
                        type="button"
                        onClick={() => setHeatMode(value)}
                        className={cn(
                          "pressable relative z-10 h-6 flex-none rounded-full px-2.5 text-ui-sm font-medium",
                          heatMode === value ? "text-ink" : "text-ink-2 hover:text-ink",
                        )}
                      >
                        {value === "daily" ? t("Daily") : value === "weekly" ? t("Weekly") : t("Cumulative")}
                      </button>
                    ))}
                  </SlidingGroup>
                </div>

                <ChartBoundary bare>
                  <ActivityHeatmap
                    weeks={heatmap.weeks}
                    months={heatmap.months}
                    peak={heatmap.max}
                    mode={heatMode}
                    selected={drillDate}
                    onSelect={(date) => {
                      setDrillHour(null);
                      setDrillDate(date);
                    }}
                  />
                </ChartBoundary>

                <div className="text-ui-caption text-ink-3">
                  {peakDay && peakDay.tokens > 0
                    ? tf("The busiest day was {day}, with about {tokens} tokens.", {
                        day: dayLabel(peakDay.date),
                        tokens: compactTokens(peakDay.tokens),
                      })
                    : t("No usage in the scanned logs yet.")}
                </div>

                <ChartBoundary bare>
                  <HourBars
                    hours={hourTotals}
                    selected={drillHour}
                    faded={drillDate !== null}
                    onSelect={setDrillHour}
                  />
                </ChartBoundary>

                <div className="text-ui-caption text-ink-3">
                  {tf(
                    "You've used ~{count}× more tokens than Moby-Dick — with {percent} of prompt tokens served from cache.",
                    {
                      count: Math.max(1, Math.round(stats.totals.total / MOBY_DICK_TOKENS)).toLocaleString(),
                      percent: percent(stats.cache.hitRate),
                    },
                  )}
                </div>
              </Card>

              {/* the range row owns its own line, like the reference: what the
                  two charts below it are filtered to */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-ui-base font-medium text-ink">{t("Time range")}</div>
                {rangePicker}
              </div>

              <ChartBoundary title={t("Daily token trend")}>
                <ModelTrendChart buckets={filtered} />
              </ChartBoundary>
              <ChartBoundary title={t("Model usage")}>
                <ModelShareChart buckets={filtered} />
              </ChartBoundary>

              {/* ours, kept: the reference has no per-channel cache readout, and
                  the cache share is what the strip's totals are made of */}
              <Card index={9} className="flex flex-col gap-2 p-3">
                <div className="text-ui-caption font-medium text-ink">{t("Cache share by channel")}</div>
                {providerRows.length === 0 ? (
                  <div className="text-ui-caption text-ink-3">{t("No calls in this slice.")}</div>
                ) : (
                  providerRows.slice(0, 6).map((row) => (
                    <div key={row.provider} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-ui-caption">
                        <span className="min-w-0 flex-1 truncate text-ink">{row.providerName}</span>
                        <span className="tabular-nums text-ink-2">{compactTokens(row.total)}</span>
                        <span className="w-12 text-right tabular-nums text-ink-3">{percent(row.hitRate)}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-field">
                        <div
                          className="h-full origin-left rounded-full bg-accent"
                          style={{
                            transform: `scaleX(${row.hitRate})`,
                            transition: "transform 460ms var(--ease-out-strong-css)",
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </Card>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onRefresh}
                  className="pressable flex h-8 items-center gap-1.5 rounded-control border border-line bg-page px-2.5 text-ui-sm text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <RefreshIcon size={14} />
                  {t("Refresh")}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "models" ? (
            <div key="models" className="view-enter">
              <UsageRecords stats={stats} buckets={buckets} />
            </div>
          ) : null}

          {tab === "insights" ? (
            <div key="insights" className="view-enter">
              <UsageInsights stats={stats} buckets={buckets} />
            </div>
          ) : null}

          {tab === "cache" ? (
            <div key="cache" className="view-enter flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-3">
                <StatCard index={0} label={t("Cache hit rate")} value={percent(selection.hitRate)} hint={t("cache read ÷ (fresh input + cache read + cache write)")} />
                <StatCard index={1} label={t("Cache read")} value={compactTokens(selection.cacheRead)} hint={t("tokens served from cache")} />
                <StatCard index={2} label={t("Cache write")} value={compactTokens(selection.cacheWrite)} hint={t("tokens written to cache")} />
                <StatCard index={3} label={t("Fresh input")} value={compactTokens(selection.input)} hint={t("uncached prompt tokens")} />
              </div>
              <Card index={4} className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <div className="text-ui-caption font-medium text-ink">{t("Cache by channel")}</div>
                  <div className="text-ui-sm text-ink-3">{t("each provider/model pair is counted separately")}</div>
                </div>
                <GlideList rowSelector="tbody tr" highlightClassName="bg-hover" radius={0}>
                <table className="w-full border-collapse text-ui-caption">
                  <thead>
                    <tr className="border-b border-line text-left text-ui-sm text-ink-3">
                      <th className="px-3 py-2 font-medium">{t("Channel")}</th>
                      <th className="px-3 py-2 font-medium">{t("Model")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Calls")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Cache read")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Cache write")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Fresh input")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Hit rate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((row) => (
                      <tr key={`${row.provider}/${row.model}`} data-row className="border-b border-line last:border-0">
                        <td className="px-3 py-2">
                          <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-ui-xs text-ink-2">
                            {row.provider}
                          </span>
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-2 text-ink">{row.model}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.calls}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green">{compactTokens(row.cacheRead)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange">{compactTokens(row.cacheWrite)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{compactTokens(row.input)}</td>
                        <td className="px-3 py-2 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-1 w-16 overflow-hidden rounded-full bg-field">
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(row.hitRate * 100)}%` }} />
                            </span>
                            <span className="tabular-nums text-ink">{percent(row.hitRate)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {modelRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-ink-3">
                          {t("No cached usage in this slice.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                </GlideList>
              </Card>
            </div>
          ) : null}

          {stats.errors.length ? (
            <Card className="p-3 text-ui-sm text-red" style={{ animation: "fade-up 320ms var(--ease-out-strong-css) both" }}>{tf("Skipped {count} unreadable session file(s).", { count: stats.errors.length })}</Card>
          ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
