import { useEffect, useRef, useState } from "react";
import { cacheHitRate, freshPromptTokens, promptTokens } from "@shared/cache-usage";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";

/**
 * Cache hit rate.
 *
 * The inverse of context pressure: a high number is the good outcome, so the
 * colours run the other way — red for a cold cache, green once most of the
 * window is being served from cache.
 */
const BANDS = [
  { from: 0, to: 50, tone: "#C2453B", label: "Cold — most tokens are billed fresh" },
  { from: 50, to: 80, tone: "#D9A521", label: "Warming — the prefix keeps changing" },
  { from: 80, to: 90, tone: "#E8D27A", label: "Good — most of the prompt is cached" },
  { from: 90, to: Number.POSITIVE_INFINITY, tone: "#1F7A5F", label: "Excellent — almost nothing is re-sent" },
] as const;

function bandFor(rate: number) {
  return BANDS.find((band) => rate >= band.from && rate < band.to) ?? BANDS[0];
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export interface CacheStats {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * One prompt's token accounting as a ring.
 *
 * The rate is the prompt's own: cache reads over fresh input, cache reads and
 * cache writes — the same definition the usage page uses, so the ring and the
 * ledger never disagree. Output tokens are deliberately not in it; nothing
 * about an answer comes from the prompt cache.
 *
 * Hover reveals the breakdown, and clicking pins it — the numbers are worth
 * reading without holding the pointer still, so the popover has to survive the
 * mouse leaving.
 */
export function CacheRing({ stats }: { stats: CacheStats }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const fresh = freshPromptTokens(stats);
  const prompt = promptTokens(stats);
  const rate = cacheHitRate(stats) * 100;
  const band = bandFor(rate);
  // 16px matches the context ring directly opposite it
  const size = 16;
  const stroke = 2.4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label={tf("Cache hit rate {rate}%", { rate: rate.toFixed(0) })}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((value) => !value)}
        className="pressable inline-flex items-center rounded-chip p-0.5 hover:bg-hover"
      >
        {/* ring only: the band colour is the read, the numbers are on hover */}
        <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="absolute inset-0 -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={band.tone}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference * (rate / 100)} ${circumference}`}
              style={{ transition: "stroke-dasharray 420ms var(--ease-out-strong-css)" }}
            />
          </svg>
        </span>
      </button>

      {open ? (
        <span
          role="dialog"
          className="absolute bottom-full right-0 z-30 mb-2 w-60 overflow-hidden rounded-card bg-surface shadow-overlay"
          style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both", transformOrigin: "bottom right" }}
        >
          <span className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: band.tone }} />
            <span className="min-w-0 flex-1 text-ui-caption font-medium text-ink">{tf("Cache {rate}%", { rate: Math.round(rate) })}</span>
            {pinned ? <span className="font-mono text-ui-xs text-ink-3">{t("pinned · Esc")}</span> : null}
          </span>
          <span className="flex flex-col gap-1.5 px-3 py-2">
            <Row label="From cache" value={stats.cacheRead.toLocaleString()} tone={band.tone} />
            <Row label="Billed fresh" value={fresh.toLocaleString()} tone="var(--ink-2)" />
            <Row label="Prompt total" value={prompt.toLocaleString()} tone="var(--ink)" />
            <span className="mt-1 border-t border-line pt-1.5 text-ui-sm leading-snug text-ink-3">{t(band.label)}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-ui-sm text-ink-3">{t(label)}</span>
      <span className={cn("font-mono text-ui-sm tabular-nums")} style={{ color: tone }}>
        {value}
      </span>
    </span>
  );
}
