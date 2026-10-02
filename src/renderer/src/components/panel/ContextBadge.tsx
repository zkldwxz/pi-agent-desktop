import { useEffect, useRef, useState } from "react";
import type { HostState } from "@shared/types";
import { pressureFor } from "../../lib/context-pressure";
import { t, tf } from "../../lib/i18n";

/**
 * Context pressure.
 *
 * A ring, and nothing else: the colour is the fastest read in the window, so the
 * ring carries white at zero, blue while there is room, green as it fills, yellow
 * at 80 and red above. The numbers are one click away rather than permanently
 * occupying the composer — this sits under the microphone, inches from the text
 * you are typing, and a percentage there competes with the prompt.
 *
 * Click (not hover) opens the popover, so it stays open while you read it.
 */
export function ContextBadge({ state }: { state: HostState }) {
  const [pinned, setPinned] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

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

  const usage = state.snapshot?.stats?.contextUsage;
  const percent = usage?.percent ?? null;
  const { tone, label } = pressureFor(percent);
  const size = 16;
  const stroke = 2.4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  const open = pinned;

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label={percent === null ? t("Context usage unknown") : tf("Context {percent}%", { percent: Math.round(percent) })}
        onClick={() => setPinned((value) => !value)}
        className="pressable flex size-5 items-center justify-center rounded-chip hover:bg-hover"
      >
        <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="absolute inset-0 -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={percent === null ? "var(--line-strong)" : tone}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference * filled} ${circumference}`}
              style={{ transition: "stroke-dasharray 420ms var(--ease-out-strong-css), stroke 240ms ease-out" }}
            />
          </svg>
        </span>
      </button>

      {open ? (
        <span
          role="dialog"
          className="absolute bottom-full right-0 z-30 mb-2 w-64 overflow-hidden rounded-card bg-surface shadow-overlay"
          style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both", transformOrigin: "bottom right" }}
        >
          <span className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: tone }} />
            <span className="min-w-0 flex-1 text-ui-caption font-medium text-ink">{tf("Context {percent}", { percent: percent === null ? "—" : `${Math.round(percent)}%` })}</span>
            {pinned ? <span className="font-mono text-ui-xs text-ink-3">{t("pinned · Esc")}</span> : null}
          </span>
          <span className="flex flex-col gap-1.5 px-3 py-2">
            <Row
              label="Used"
              value={usage?.tokens != null ? usage.tokens.toLocaleString() : "—"}
              tone={tone}
            />
            <Row
              label="Window"
              value={usage ? usage.contextWindow.toLocaleString() : "—"}
              tone="var(--ink-2)"
            />
            {state.snapshot?.stats ? (
              <Row label="Session total" value={state.snapshot.stats.tokens.total.toLocaleString()} tone="var(--ink-2)" />
            ) : null}
            <span className="mt-1 border-t border-line pt-1.5 text-ui-sm leading-snug text-ink-3">{t(label)}</span>
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
      <span className="font-mono text-ui-sm tabular-nums" style={{ color: tone }}>
        {value}
      </span>
    </span>
  );
}
