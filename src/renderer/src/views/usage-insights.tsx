import { useMemo } from "react";
import { promptTokens } from "@shared/cache-usage";
import type { UsageBucket, UsageStats } from "@shared/types";
import { t, tf } from "../lib/i18n";
import InsightCards, { type InsightPage } from "../components/beautiful/primitives/InsightCards";
import RecordsTable, { type RecordRow, type Strength } from "../components/beautiful/primitives/RecordsTable";

/* ─────────────────────────────────────────────────────────
 * Sparkline
 * A tiny chart component, built to be handed to InsightCards as its `Card`.
 * No chart library: the data is a short daily series and an SVG polyline is
 * both smaller and sharper than anything a library would draw here.
 * ───────────────────────────────────────────────────────── */

function Sparkline({ values, tone = "var(--accent)" }: { values: number[]; tone?: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const width = 100;
    const height = 32;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values]);

  if (!path) return <div className="h-8 text-[11px] text-ink-3">{t("Not enough data yet.")}</div>;

  return (
    <div className="w-full">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-16 w-full">
        <path d={`${path} L100,32 L0,32 Z`} fill={tone} opacity={0.12} />
        <path d={path} fill="none" stroke={tone} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(Math.round(value));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.995 ? 0 : 1)}%`;
}

/** Daily series for one slice of the ledger. */
function series(buckets: UsageBucket[], pick: (bucket: UsageBucket) => number): number[] {
  const byDay = new Map<string, number>();
  for (const bucket of buckets) byDay.set(bucket.date, (byDay.get(bucket.date) ?? 0) + pick(bucket));
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, value]) => value);
}

/**
 * Insights.
 *
 * Every page is derived from the scanned session ledger — the same numbers the
 * tables below show, phrased as something to act on. Nothing here is invented:
 * if there is no data, the page says so.
 */
export function UsageInsights({ stats, buckets }: { stats: UsageStats; buckets: UsageBucket[] }) {
  const pages = useMemo<InsightPage[]>(() => {
    const tokenSeries = series(buckets, (bucket) => bucket.total);
    const cacheSeries = series(buckets, (bucket) => bucket.cacheRead);
    const costSeries = series(buckets, (bucket) => bucket.cost);
    const hitRate = stats.cache.hitRate;

    const topModel = [...stats.models].sort((a, b) => b.total - a.total)[0];
    const worstCache = [...stats.models].sort((a, b) => a.cacheRate - b.cacheRate)[0];
    const busiestDay = [...stats.days].sort((a, b) => b.tokens - a.tokens)[0];

    const out: InsightPage[] = [
      {
        key: "tokens",
        pill: t("Tokens"),
        prose: (
          <>
            {tf(
              stats.sessionCount === 1
                ? "Across {count} session you have moved"
                : "Across {count} sessions you have moved",
              { count: stats.sessionCount },
            )}{" "}
            <strong className="font-medium text-ink">{compact(stats.totals.total)}</strong> {t("tokens")}.{" "}
            {t("The busiest day was")} <strong className="font-medium text-ink">{busiestDay?.date ?? "—"}</strong>{" "}
            {t("at")} {compact(busiestDay?.tokens ?? 0)}.
          </>
        ),
        Card: () => <Sparkline values={tokenSeries} />,
      },
      {
        key: "cache",
        pill: t("Cache"),
        prose: (
          <>
            <strong className="font-medium text-ink">{percent(hitRate)}</strong>{" "}
            {t("of prompt tokens came from cache")} ({compact(stats.cache.cacheRead)} {t("of")}{" "}
            {compact(promptTokens(stats.cache))}).{" "}
            {worstCache && worstCache.cacheRate < hitRate
              ? tf("{name} is the weakest at {percent} — the usual cause is a changing prefix.", {
                  name: worstCache.model,
                  percent: percent(worstCache.cacheRate),
                })
              : t("No channel is dragging the average down.")}
          </>
        ),
        Card: () => <Sparkline values={cacheSeries} tone="var(--green)" />,
      },
    ];

    if (topModel) {
      out.push({
        key: "model",
        pill: t("Model"),
        prose: (
          <>
            <strong className="font-medium text-ink">{topModel.model}</strong> {t("does most of the work")} —{" "}
            {tf("{tokens} tokens over {count} calls on {provider}.", {
              tokens: compact(topModel.total),
              count: topModel.calls,
              provider: topModel.provider,
            })}
          </>
        ),
        Card: () => <Sparkline values={series(buckets, (bucket) => (bucket.model === topModel.model ? bucket.total : 0))} />,
      });
    }

    if (stats.totals.cost > 0) {
      out.push({
        key: "cost",
        pill: t("Cost"),
        prose: (
          <>
            {t("Estimated spend")} <strong className="font-medium text-ink">${stats.totals.cost.toFixed(4)}</strong>{" "}
            {t("across the scanned range.")}
          </>
        ),
        Card: () => <Sparkline values={costSeries} tone="var(--orange)" />,
      });
    }

    return out;
  }, [stats, buckets]);

  return <InsightCards pages={pages} />;
}

/* ─────────────────────────────────────────────────────────
 * Records
 * The per-model ledger as a sortable record table instead of a hand-rolled
 * table — tags, last use, and a strength that maps to share of token volume.
 * ───────────────────────────────────────────────────────── */

/** Share of total tokens → the table's strength scale. */
function strengthFor(share: number): Strength {
  if (share >= 0.4) return "strong";
  if (share >= 0.15) return "weak";
  if (share > 0) return "veryweak";
  return "none";
}

export function UsageRecords({ stats, buckets }: { stats: UsageStats; buckets: UsageBucket[] }) {
  const rows = useMemo<RecordRow[]>(() => {
    const byModel = new Map<string, { tokens: number; calls: number; last: number }>();
    for (const bucket of buckets) {
      const key = `${bucket.provider}/${bucket.model}`;
      const entry = byModel.get(key) ?? { tokens: 0, calls: 0, last: 0 };
      entry.tokens += bucket.total;
      entry.calls += bucket.calls;
      entry.last = Math.max(entry.last, Date.parse(`${bucket.date}T12:00:00`));
      byModel.set(key, entry);
    }
    const total = [...byModel.values()].reduce((sum, entry) => sum + entry.tokens, 0) || 1;

    return [...byModel.entries()]
      .map(([key, entry]) => {
        const [provider, ...rest] = key.split("/");
        const model = rest.join("/");
        const info = stats.models.find((candidate) => candidate.provider === provider && candidate.model === model);
        return {
          id: key,
          name: model,
          tags: [provider, ...(info && info.cacheRate > 0.5 ? [t("cache-friendly")] : [])],
          last: entry.last ? new Date(entry.last).toLocaleDateString() : "—",
          strength: strengthFor(entry.tokens / total),
          website: `${compact(entry.tokens)} tok · ${entry.calls} ${t("calls")}`,
        } satisfies RecordRow;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stats, buckets]);

  if (!rows.length) {
    return <div className="px-3 py-6 text-center text-[12px] text-ink-3">{t("No model usage in this slice.")}</div>;
  }

  return <RecordsTable rows={rows} />;
}
