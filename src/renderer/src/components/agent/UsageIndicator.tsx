import { useCallback, useEffect, useRef, useState } from "react";
import type { HostState } from "@shared/types";
import { cacheHitRate, promptTokens } from "@shared/cache-usage";
import { effectiveUsed, tightestWindow, type PlanQuota, type QuotaWindow } from "@shared/quota";
import { cn } from "../../lib/cn";
import { compactTokens, relativeTime } from "../../lib/format";
import { t, tf, useLocale } from "../../lib/i18n";
import { RefreshIcon } from "../icons";

/**
 * The composer's one usage indicator.
 *
 * It replaces two unlabeled 16px rings (context pressure, cache hit rate) and
 * carries the subscription plan quota, the way baocode's quota pill does: the
 * button reads "5h 62% left" when the chat's provider is a plan, else just the
 * context ring; the panel lays out context, cache and every plan's windows.
 *
 * Colour is the tokens' only: muted ink normally, orange from 70% used, red
 * from 90% (baocode's `_QuotaLine` thresholds).
 */

const POLL_MS = 5 * 60 * 1000;

/** what a quota window is called: Claude's ids, or Codex's by length */
export function windowName(window: QuotaWindow): string {
  switch (window.id) {
    case "five_hour":
      return t("5-hour");
    case "seven_day":
      return t("Weekly");
    case "seven_day_opus":
      return t("Weekly Opus");
    case "seven_day_sonnet":
      return t("Weekly Sonnet");
  }
  const minutes = window.minutes;
  if (!minutes) return window.id === "primary" ? t("Short window") : t("Long window");
  if (minutes === 10080) return t("Weekly");
  if (minutes % 1440 === 0) return tf("{count}-day", { count: minutes / 1440 });
  return tf("{count}-hour", { count: Math.round(minutes / 60) });
}

/** "in 2h 24m" / "in 3 days" — until a window starts over */
export function resetsIn(resetsAt: number | undefined, now = Date.now()): string | null {
  if (resetsAt === undefined) return null;
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60000));
  if (minutes < 60) return tf("resets in {time}", { time: tf("{count} min", { count: Math.max(1, minutes) }) });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return tf("resets in {time}", {
      time: rest ? tf("{hours} h {minutes} min", { hours, minutes: rest }) : tf("{count} h", { count: hours }),
    });
  }
  return tf("resets in {time}", { time: tf("{count} days", { count: Math.round(hours / 24) }) });
}

export function usedTone(used: number): string {
  return used >= 90 ? "text-red" : used >= 70 ? "text-orange" : "text-ink-3";
}

function barTone(used: number): string {
  return used >= 90 ? "bg-red" : used >= 70 ? "bg-orange" : "bg-ink-3";
}

/** plan quota for the signed-in subscriptions, refreshed every five minutes,
 *  after each run, and on demand */
export function usePlanQuota(streaming: boolean): {
  quotas: PlanQuota[];
  loading: boolean;
  refresh: (force?: boolean) => void;
} {
  const [quotas, setQuotas] = useState<PlanQuota[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback((force = false) => {
    if (!window.pi?.planQuota) return;
    setLoading(true);
    void window.pi
      .planQuota(force)
      .then((next) => setQuotas(next))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);
  /* a finished run has just spent quota: ask again (the cache keeps this cheap) */
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) refresh();
    wasStreaming.current = streaming;
  }, [streaming, refresh]);
  return { quotas, loading, refresh };
}

function Meter({ used }: { used: number }) {
  return (
    <span className="relative block h-1 w-full overflow-hidden rounded-full bg-field">
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", barTone(used))}
        style={{ width: `${Math.max(2, used)}%`, transition: "width 420ms var(--ease-out-strong-css)" }}
      />
    </span>
  );
}

/** baocode's ContextMeter: a 13px ring, stroke 2 with round caps, inset 1;
 *  the track disabled-grey, the arc muted ink from 12 o'clock clockwise */
function Ring({ percent }: { percent: number | null }) {
  const size = 13;
  const stroke = 2;
  const radius = (size - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  const tone = percent !== null && percent >= 80 ? "var(--orange)" : "var(--ink-2)";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--ink-4)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        style={{ transition: "stroke-dasharray 400ms var(--ease-out-strong-css)" }}
      />
    </svg>
  );
}

/** one plan's windows: name, % used, a meter, when it starts over */
function QuotaWindows({ quota }: { quota: PlanQuota }) {
  return (
    <>
      {quota.windows.length ? (
        quota.windows.map((window) => {
          const used = effectiveUsed(window);
          const reset = resetsIn(window.resetsAt);
          return (
            <span key={window.id} className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-2 text-ui-sm">
                <span className="text-ink-2">{windowName(window)}</span>
                <span className={cn("tabular-nums", usedTone(used))}>
                  {tf("{percent}% used", { percent: Math.round(used) })}
                </span>
              </span>
              <Meter used={used} />
              {reset ? <span className="text-ui-xs text-ink-4">{reset}</span> : null}
            </span>
          );
        })
      ) : (
        <span className="text-ui-sm text-ink-3">{t("Quota not known yet")}</span>
      )}
      {quota.limited ? <span className="text-ui-sm text-red">{t("Out of quota")}</span> : null}
      {quota.error ? <span className="text-ui-xs break-words text-ink-4 select-text">{quota.error}</span> : null}
    </>
  );
}

function planTitle(quota: PlanQuota): string {
  return `${quota.label}${quota.plan ? ` ${quota.plan[0].toUpperCase()}${quota.plan.slice(1)}` : ""}`;
}

/**
 * Settings ▸ Usage: every signed-in plan side by side, with a refresh that
 * skips the five-minute cache (baocode's "Refresh All Quotas"). Renders nothing
 * when no subscription is signed in — the token charts below stand alone.
 */
export function PlanQuotaCard() {
  useLocale();
  const { quotas, loading, refresh } = usePlanQuota(false);
  if (!quotas.length) return null;
  const fetchedAt = Math.max(...quotas.map((quota) => quota.fetchedAt));
  return (
    /* a settings group: the heading (with when and a refresh) over its card */
    <section className="mb-3 flex flex-col">
      <header className="flex items-center gap-2 pr-1 pb-2 pl-2">
        <span className="text-ui-caption font-medium text-settings-muted">{t("Plan usage")}</span>
        <span className="flex-1 text-ui-xs text-ink-4">
          {tf("Last updated {time}", { time: relativeTime(new Date(fetchedAt).toISOString()) })}
        </span>
        <button
          type="button"
          onClick={() => refresh(true)}
          className="pressable flex h-6 items-center gap-1.5 rounded-chip px-2 text-ui-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          <RefreshIcon size={12} className={loading ? "spin-fast" : undefined} />
          {t("Refresh all quotas")}
        </button>
      </header>
      <div className="grid grid-cols-1 divide-[color-mix(in_srgb,var(--ink)_4%,transparent)] overflow-hidden rounded-[12px] bg-settings-card sm:grid-cols-2 sm:divide-x">
        {quotas.map((quota) => (
          <div key={quota.provider} className="flex flex-col gap-2.5 px-3.5 py-3">
            <span className="text-ui-sm font-medium text-ink-2">{planTitle(quota)}</span>
            <QuotaWindows quota={quota} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PanelSection({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-2 px-3.5 py-3">
      <span className="flex items-center justify-between gap-2">
        <span className="text-ui-sm font-medium text-ink-2">{title}</span>
        {trailing}
      </span>
      {children}
    </span>
  );
}

export function UsageIndicator({
  state,
  quotas,
  loading,
  onRefresh,
}: {
  state: HostState;
  quotas: PlanQuota[];
  loading: boolean;
  onRefresh: (force?: boolean) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    onRefresh();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onRefresh]);

  const stats = state.snapshot?.stats;
  const context = stats?.contextUsage;
  const contextPercent = context?.percent ?? null;
  const tokens = stats?.tokens;
  const cacheRate = tokens && promptTokens(tokens) > 0 ? cacheHitRate(tokens) : null;

  const provider = state.snapshot?.model?.provider;
  /* the chat's own plan first; the others follow in the panel */
  const ordered = [...quotas].sort((a, b) => Number(b.provider === provider) - Number(a.provider === provider));
  const current = quotas.find((quota) => quota.provider === provider && quota.windows.length > 0);
  const worst = current ? tightestWindow(current) : undefined;
  const worstUsed = worst ? effectiveUsed(worst) : 0;

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        title={t("Usage")}
        aria-label={t("Usage")}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          /* ContextMeter's box: 23×22, radius 5; with a plan, the label */
          "pressable flex h-[22px] min-w-[23px] items-center justify-center gap-[5px] rounded-[5px] px-[5px] text-ui-meta tabular-nums transition-colors duration-[120ms] hover:bg-hover",
          open && "bg-hover-2",
        )}
      >
        {/* an empty ring read as a loading spinner: with nothing measured yet
            the button shows a gauge glyph instead */}
        <Ring percent={contextPercent} />
        {worst ? (
          <span className={usedTone(worstUsed)}>
            {tf("{window} {percent}% left", { window: windowName(worst), percent: Math.round(100 - worstUsed) })}
          </span>
        ) : null}
      </button>

      {open ? (
        <span
          role="dialog"
          aria-label={t("Usage")}
          className="absolute right-0 bottom-full z-30 mb-2 flex w-80 flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-overlay"
          style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both", transformOrigin: "bottom right" }}
        >
          <PanelSection
            title={t("Context")}
            trailing={
              <span className="text-ui-sm text-ink-3 tabular-nums">
                {context?.tokens != null ? `${compactTokens(context.tokens)} / ${compactTokens(context.contextWindow)}` : "—"}
              </span>
            }
          >
            <Meter used={contextPercent ?? 0} />
            {cacheRate !== null ? (
              <span className="flex items-center justify-between text-ui-sm text-ink-3">
                <span>{t("Cache hit rate")}</span>
                <span className="tabular-nums">{Math.round(cacheRate * 100)}%</span>
              </span>
            ) : null}
          </PanelSection>

          {ordered.length ? (
            ordered.map((quota) => (
              <PanelSection
                key={quota.provider}
                title={`${t("Plan usage")} · ${planTitle(quota)}`}
                trailing={
                  quota.provider === provider ? (
                    <span className="rounded-chip bg-field px-1.5 text-ui-xs text-ink-3">{t("This chat")}</span>
                  ) : undefined
                }
              >
                <QuotaWindows quota={quota} />
              </PanelSection>
            ))
          ) : (
            <PanelSection title={t("Plan usage")}>
              <span className="text-ui-sm leading-snug text-ink-3">
                {t("Sign in with a Claude or ChatGPT subscription to see its quota here.")}
              </span>
            </PanelSection>
          )}

          {ordered.length ? (
            <span className="flex items-center justify-between gap-2 px-3.5 py-2 text-ui-xs text-ink-4">
              <span>
                {tf("Last updated {time}", {
                  time: relativeTime(new Date(Math.max(...ordered.map((quota) => quota.fetchedAt))).toISOString()),
                })}
              </span>
              <button
                type="button"
                onClick={() => onRefresh(true)}
                title={t("Refresh quota")}
                aria-label={t("Refresh quota")}
                className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
              >
                <RefreshIcon size={12} className={loading ? "spin-fast" : undefined} />
              </button>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
