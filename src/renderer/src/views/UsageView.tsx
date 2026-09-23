import { useMemo, useState } from "react";
import { cacheHitRate } from "@shared/cache-usage";
import type { UsageBucket, UsageStats } from "@shared/types";
import { formatContext } from "../lib/format";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import {
  BrainIcon,
  ChartBarIcon,
  ClockIcon,
  DatabaseIcon,
  FlameIcon,
  MessageIcon,
  RefreshIcon,
} from "../components/icons";
import { Card, Chip, EmptyState, Skeleton, StatCard, ViewHeader } from "../components/ui";
import { GlideList, SlidingGroup } from "../components/motion";
import { EntityChip } from "../components/beautiful/atoms/EntityChip";
import { ProgressRing } from "../components/beautiful/atoms/ProgressRing";
import { UsageInsights, UsageRecords } from "./usage-insights";
import { ValuePill } from "../components/beautiful/atoms/ValuePill";

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

/** Stable colour per provider, so a channel keeps its identity across panels. */
const PROVIDER_COLORS = ["#2f6fec", "#1f7a5f", "#e56d24", "#8a5cf0", "#3cb8c8", "#c2455f", "#b58a2b"];
function providerColor(provider: string): string {
  let hash = 0;
  for (let i = 0; i < provider.length; i += 1) hash = (hash * 31 + provider.charCodeAt(i)) % 997;
  return PROVIDER_COLORS[hash % PROVIDER_COLORS.length];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.995 || value === 0 ? 0 : 1)}%`;
}

function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
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

  const heatmap = useMemo(() => {
    const days = stats?.days ?? [];
    if (!days.length) return { weeks: [] as Array<Array<{ date: string; tokens: number; calls: number } | null>>, max: 1, months: [] as Array<{ index: number; label: string }> };
    const byDate = new Map(days.map((day) => [day.date, day]));
    const first = new Date(`${days[0].date}T00:00:00`);
    const last = new Date();
    // align to the Sunday on or before the first day
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const weeks: Array<Array<{ date: string; tokens: number; calls: number } | null>> = [];
    const months: Array<{ index: number; label: string }> = [];
    let lastMonth = -1;
    const cursor = new Date(start);
    while (cursor <= last) {
      const week: Array<{ date: string; tokens: number; calls: number } | null> = [];
      for (let index = 0; index < 7; index += 1) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
          cursor.getDate(),
        ).padStart(2, "0")}`;
        const entry = byDate.get(key);
        week.push(entry ? { date: entry.date, tokens: entry.tokens, calls: entry.calls } : null);
        if (index === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth();
          months.push({ index: weeks.length, label: cursor.toLocaleDateString(undefined, { month: "short" }) });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    const max = Math.max(1, ...days.map((day) => day.tokens));
    return { weeks, max, months };
  }, [stats]);

  const levelFor = (tokens: number, max: number): number => {
    if (tokens <= 0) return 0;
    const ratio = tokens / max;
    if (ratio > 0.6) return 4;
    if (ratio > 0.3) return 3;
    if (ratio > 0.12) return 2;
    return 1;
  };

  const LEVEL_BG = [
    "bg-field",
    "bg-[color-mix(in_oklch,var(--accent)_22%,var(--surface))]",
    "bg-[color-mix(in_oklch,var(--accent)_42%,var(--surface))]",
    "bg-[color-mix(in_oklch,var(--accent)_65%,var(--surface))]",
    "bg-accent",
  ];

  const hourMax = Math.max(1, ...hourTotals);

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
        {subtitle ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{subtitle}</span> : <span className="flex-1" />}
        {actions}
      </div>
    ) : (
      <ViewHeader title={t("Usage")} subtitle={subtitle} actions={actions} />
    );

  const rangePicker = (
    <div className="flex items-center gap-1.5">
      <SlidingGroup
        activeIndex={([0, 30, 7] as Range[]).indexOf(range)}
        className="flex items-center gap-0.5 rounded-chip bg-field p-0.5"
        pillClassName="bg-surface shadow-hairline"
      >
        {([0, 30, 7] as Range[]).map((value) => (
          <button
            key={value}
            data-slide-item
            type="button"
            onClick={() => onRange(value)}
            className={cn(
              "pressable relative z-10 h-5 rounded-[4px] px-2 text-[11.5px] tabular-nums",
              range === value ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {value === 0 ? t("All") : `${value}d`}
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
                  "h-6 rounded-chip px-2 text-[12px] transition-colors duration-100",
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
              className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-card bg-accent-tint px-3 py-2 text-[12px] text-ink"
              style={{ animation: "pop-in 220ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top left" }}
            >
              <span className="font-medium">{t("Selected slice")}</span>
              <span className="tabular-nums">{selection.calls} {t("calls")}</span>
              <span className="tabular-nums">{compact(selection.total)} {t("tokens")}</span>
              <span className="tabular-nums">{t("cache hit")} {percent(selection.hitRate)}</span>
              <span className="tabular-nums">{t("in")} {compact(selection.input)}</span>
              <span className="tabular-nums">{t("out")} {compact(selection.output)}</span>
              <span className="tabular-nums">{t("cache read")} {compact(selection.cacheRead)}</span>
              {selection.cost > 0 ? <span className="tabular-nums">${selection.cost.toFixed(4)}</span> : null}
            </div>
          ) : null}

          {tab === "overview" ? (
            <div key="overview" className="view-enter flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-3">
                <StatCard index={0} label={t("Sessions")} value={kpis.sessions} icon={<DatabaseIcon size={12} />} hint={`${stats.scannedFiles} ${t("files scanned")}`} />
                <StatCard index={1} label={t("Messages")} value={kpis.messages.toLocaleString()} icon={<MessageIcon size={12} />} hint={`${selection.calls} ${t("calls in slice")}`} />
                <StatCard
                  index={2}
                  label={t("Total tokens")}
                  value={compact(stats.totals.total)}
                  icon={<ChartBarIcon size={12} />}
                  hint={`${formatContext(stats.totals.input)} ${t("in")} · ${formatContext(stats.totals.output)} ${t("out")}`}
                />
                <StatCard index={3} label={t("Active days")} value={kpis.activeDays} icon={<ClockIcon size={12} />} hint={`${kpis.currentStreak}d ${t("streak")}`} />
                <StatCard index={4} label={t("Current streak")} value={`${kpis.currentStreak}d`} icon={<FlameIcon size={12} />} hint={`${t("longest")} ${kpis.longestStreak}d`} />
                <StatCard index={5} label={t("Longest streak")} value={`${kpis.longestStreak}d`} icon={<FlameIcon size={12} />} />
                <StatCard
                  index={6}
                  label={t("Peak hour")}
                  value={kpis.peakHour !== null ? hourLabel(kpis.peakHour) : "—"}
                  icon={<ClockIcon size={12} />}
                  hint={kpis.peakHour !== null ? `${compact(stats.hours[kpis.peakHour])} ${t("tokens")}` : undefined}
                />
                <StatCard
                  index={7}
                  label={t("Favorite model")}
                  value={kpis.favoriteModel ? kpis.favoriteModel.split("/").at(-1) : "—"}
                  icon={<BrainIcon size={12} />}
                  hint={kpis.favoriteModel?.split("/")[0]}
                />
              </div>

              <Card index={8} className="flex flex-col gap-3 p-3">
                <div className="flex items-center gap-2">
                  <div className="text-[12.5px] font-medium text-ink">{t("Activity")}</div>
                  <div className="text-[11.5px] text-ink-3">{t("click a day or an hour to inspect that slice")}</div>
                  <span className="flex-1" />
                  <div className="flex items-center gap-1 text-[10.5px] text-ink-3">
                    {t("less")}
                    {LEVEL_BG.map((bg, index) => (
                      <span key={index} className={cn("size-2.5 rounded-[2px]", bg)} />
                    ))}
                    {t("more")}
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  <div className="flex shrink-0 flex-col justify-between pt-4 text-[9.5px] leading-none text-ink-3">
                    {["", t("Mon"), "", t("Wed"), "", t("Fri"), ""].map((label, index) => (
                      <span key={index} className="h-2.5">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col">
                    <div className="relative flex h-4 gap-[3px]">
                      {heatmap.months.map((month) => (
                        <span
                          key={`${month.label}-${month.index}`}
                          className="absolute text-[9.5px] text-ink-3"
                          style={{ left: `${month.index * 13}px` }}
                        >
                          {month.label}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-[3px] py-0.5 pl-0.5">
                      {heatmap.weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="flex flex-col gap-[3px]">
                          {week.map((day, dayIndex) => {
                            if (!day) {
                              return <span key={dayIndex} className="size-2.5 rounded-[2px] bg-transparent" />;
                            }
                            const active = drillDate === day.date;
                            return (
                              <button
                                key={dayIndex}
                                type="button"
                                title={`${dayLabel(day.date)} · ${compact(day.tokens)} ${t("tokens")} · ${day.calls} ${t("calls")}`}
                                onClick={() => {
                                  setDrillHour(null);
                                  setDrillDate(active ? null : day.date);
                                }}
                                className={cn(
                                  "size-2.5 rounded-[2px] transition-[transform,box-shadow,opacity] duration-150 ease-out hover:scale-[1.35]",
                                  LEVEL_BG[levelFor(day.tokens, heatmap.max)],
                                  active && "scale-[1.35] shadow-[0_0_0_1.5px_var(--surface),0_0_0_3px_var(--accent-ink)]",
                                  drillDate && !active && "opacity-50",
                                )}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-end gap-[3px] border-t border-line pt-3">
                  {hourTotals.map((tokens, hour) => {
                    const ratio = tokens / hourMax;
                    const active = drillHour === hour;
                    return (
                      <button
                        key={hour}
                        type="button"
                        title={`${hourLabel(hour)} · ${compact(tokens)} ${t("tokens")}`}
                        onClick={() => setDrillHour(active ? null : hour)}
                        className="group flex flex-1 flex-col items-center justify-end gap-1"
                      >
                        <span className="relative flex h-12 w-full items-end overflow-hidden">
                          <span
                            className={cn(
                              "pointer-events-none absolute inset-x-0 bottom-0 h-full origin-bottom rounded-[2px]",
                              active
                                ? "bg-accent"
                                : tokens > 0
                                  ? "bg-[color-mix(in_oklch,var(--ink-3)_55%,var(--surface))] group-hover:bg-accent"
                                  : "bg-field",
                            )}
                            style={{
                              transform: `scaleY(${tokens > 0 ? Math.max(0.06, ratio) : 0.05})`,
                              opacity: drillDate && !tokens ? 0.5 : 1,
                              transition:
                                "transform 460ms cubic-bezier(0.23,1,0.32,1), background-color 150ms ease-out, opacity 200ms ease-out",
                            }}
                          />
                        </span>
                        {hour % 6 === 0 ? (
                          <span className="text-[9px] text-ink-3 tabular-nums">{hour}</span>
                        ) : (
                          <span className="h-[11px]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="text-[12px] text-ink-3">
                  {tf(
                    "You've used ~{count}× more tokens than Moby-Dick — with {percent} of prompt tokens served from cache.",
                    {
                      count: Math.max(1, Math.round(stats.totals.total / MOBY_DICK_TOKENS)).toLocaleString(),
                      percent: percent(stats.cache.hitRate),
                    },
                  )}
                </div>
              </Card>

                <div className="grid grid-cols-2 gap-3">
                <Card index={9} className="flex flex-col gap-2 p-3">
                  <div className="text-[12.5px] font-medium text-ink">{t("Top models in slice")}</div>
                  {modelRows.length === 0 ? (
                    <div className="text-[12px] text-ink-3">{t("No calls in this slice.")}</div>
                  ) : (
                    modelRows.slice(0, 6).map((row) => (
                      <div key={`${row.provider}/${row.model}`} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate text-ink">{row.model}</span>
                        <span className="font-mono text-[10.5px] text-ink-3">{row.provider}</span>
                        <span className="w-14 text-right tabular-nums text-ink-2">{compact(row.total)}</span>
                        <span className="w-12 text-right tabular-nums text-ink-3">{percent(row.hitRate)}</span>
                      </div>
                    ))
                  )}
                </Card>
                <Card index={10} className="flex flex-col gap-2 p-3">
                  <div className="text-[12.5px] font-medium text-ink">{t("Cache share by channel")}</div>
                  {providerRows.length === 0 ? (
                    <div className="text-[12px] text-ink-3">{t("No calls in this slice.")}</div>
                  ) : (
                    providerRows.slice(0, 6).map((row) => (
                      <div key={row.provider} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="min-w-0 flex-1 truncate text-ink">{row.providerName}</span>
                          <span className="tabular-nums text-ink-2">{compact(row.total)}</span>
                          <span className="w-12 text-right tabular-nums text-ink-3">{percent(row.hitRate)}</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-field">
                          <div
                            className="h-full origin-left rounded-full bg-accent"
                            style={{
                              transform: `scaleX(${row.hitRate})`,
                              transition: "transform 460ms cubic-bezier(0.23,1,0.32,1)",
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </Card>
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
                <StatCard index={1} label={t("Cache read")} value={compact(selection.cacheRead)} hint={t("tokens served from cache")} />
                <StatCard index={2} label={t("Cache write")} value={compact(selection.cacheWrite)} hint={t("tokens written to cache")} />
                <StatCard index={3} label={t("Fresh input")} value={compact(selection.input)} hint={t("uncached prompt tokens")} />
              </div>
              <Card index={4} className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <div className="text-[12.5px] font-medium text-ink">{t("Cache by channel")}</div>
                  <div className="text-[11.5px] text-ink-3">{t("each provider/model pair is counted separately")}</div>
                </div>
                <GlideList rowSelector="tbody tr" highlightClassName="bg-hover" radius={0}>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-3">
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
                          <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-[10.5px] text-ink-2">
                            {row.provider}
                          </span>
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-2 text-ink">{row.model}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.calls}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green">{compact(row.cacheRead)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange">{compact(row.cacheWrite)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{compact(row.input)}</td>
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
            <Card className="p-3 text-[11.5px] text-red" style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}>{tf("Skipped {count} unreadable session file(s).", { count: stats.errors.length })}</Card>
          ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
