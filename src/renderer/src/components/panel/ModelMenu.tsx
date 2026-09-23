import { useMemo, useState } from "react";
import type { HostState } from "@shared/types";
import { cn } from "../../lib/cn";
import { GlideList, Popover } from "../motion";
import { ThinkingTrack, ThinkingTrackEnds } from "../ThinkingTrack";
import { BrainIcon, ChevronDownIcon, GlobeIcon, LayersIcon } from "../icons";
import { pressureFor } from "../../lib/context-pressure";
import { t, tf } from "../../lib/i18n";

/** A ring painted in the pressure band's colour, with the percentage inside. */
function ContextRing({ percent, size = 30 }: { percent: number | null; size?: number }) {
  const { tone, label } = pressureFor(percent);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      title={percent === null ? t("Context usage unknown") : tf("Context {percent}% — {pressure}", { percent, pressure: t(label) })}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          style={{ transition: "stroke-dasharray 420ms cubic-bezier(0.23,1,0.32,1), stroke 240ms ease-out" }}
        />
      </svg>
      <span className="font-mono text-[8.5px] tabular-nums" style={{ color: percent === null ? "var(--ink-3)" : tone }}>
        {percent === null ? "—" : Math.round(percent)}
      </span>
    </span>
  );
}

export { ContextRing };

/**
 * Model, thinking depth and context pressure.
 *
 * All three in one popover at the right end of the chat header, in this order:
 * **model → thinking → context**. They belong together (depth is a property of
 * the model, and the ring measures the model's window), and the header is the
 * one place that is always visible — putting them behind a dock panel that is
 * collapsed by default meant they could not be found at all.
 *
 * Context is a ring rather than a number because it is a proportion, and its
 * colour is the fastest read in the UI: white at zero, blue, green, yellow at
 * 80 and red above.
 */
export function ModelMenu({
  state,
  onSetModel,
  onSetThinking,
}: {
  state: HostState;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = state.snapshot?.model;
  const levels = state.snapshot?.thinkingLevels ?? ["off"];
  const level = state.snapshot?.thinkingLevel ?? "off";

  const percent = state.snapshot?.stats?.contextUsage?.percent ?? null;
  const { tone } = pressureFor(percent);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof state.models>();
    for (const model of state.models) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.models]);

  return (
    <div className="relative">
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={t("Model, thinking depth and context")}
        className={cn(
          "pressable inline-flex h-6 items-center gap-2 rounded-chip bg-field pl-1.5 pr-1",
          open ? "text-ink" : "text-ink-2 hover:bg-hover-2",
        )}
      >
        {/* the pressure dot keeps the current state visible without opening the menu */}
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: percent === null ? "var(--line-strong)" : tone }} />
        <span className="max-w-[170px] truncate text-[11.5px]">{current?.name ?? t("No model")}</span>
        {current ? (
          <span className="font-mono text-[10px] text-ink-3">{level === "off" ? "" : `· ${t(level)}`}</span>
        ) : null}
        <ChevronDownIcon
          size={11}
          className="text-ink-3 transition-transform duration-300 ease-out-strong"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor="bottom-right" className="w-72">
        <div className="scrollbar-thin max-h-[70vh] overflow-y-auto p-2">
          {/* 1 — model */}
          <div className="px-1 pb-1 text-[10px] tracking-[0.4px] text-ink-3">{t("MODEL")}</div>
          {grouped.map(([provider, models]) => (
            <div key={provider} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-1 pb-0.5">
                <GlobeIcon size={10} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{provider}</span>
                <span className="font-mono text-[9.5px] tabular-nums text-ink-3">{models.length}</span>
              </div>
              <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
                {models.map((model) => {
                  const active = current?.provider === model.provider && current?.id === model.id;
                  return (
                    <button
                      key={model.id}
                      data-row
                      type="button"
                      onClick={() => {
                        onSetModel(model.provider, model.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "glide-row pressable flex items-center gap-2 rounded-[6px] px-2 py-1 text-left",
                        active && "bg-surface shadow-hairline",
                      )}
                    >
                      <span className={cn("min-w-0 flex-1 truncate text-[11.5px]", active ? "text-ink" : "text-ink-2")}>
                        {model.name}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] text-ink-3">
                        {Math.round(model.contextWindow / 1000)}K
                      </span>
                      {active ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                    </button>
                  );
                })}
              </GlideList>
            </div>
          ))}

          {/* 2 — thinking */}
          <div className="mt-1 border-t border-line pt-2">
            <div className="flex items-center gap-1.5 px-1 pb-1">
              <BrainIcon size={11} className="text-ink-3" />
              <span className="text-[10px] tracking-[0.4px] text-ink-3">{t("THINKING")}</span>
              <span className="flex-1" />
              <span className="font-mono text-[10.5px] text-ink-2">{t(level)}</span>
            </div>
            {levels.length > 1 ? (
              <div className="px-2 pt-2 pb-2">
                <ThinkingTrack levels={levels} value={level} onPick={onSetThinking} />
                <ThinkingTrackEnds levels={levels} />
              </div>
            ) : (
              <div className="px-1.5 pb-2 text-[11px] text-ink-3">{t("This model does not expose thinking levels.")}</div>
            )}
          </div>

          {/* 3 — context */}
          <div className="border-t border-line pt-2">
            <div className="flex items-center gap-2.5 px-1 pb-0.5">
              <ContextRing percent={percent} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-ink">{t("Context window")}</span>
                <span className="block font-mono text-[10px] text-ink-3">
                  {current ? tf("{size}K tokens", { size: Math.round(current.contextWindow / 1000) }) : "—"}
                </span>
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: percent === null ? "var(--ink-3)" : tone }}>
                {percent === null ? "—" : `${Math.round(percent)}%`}
              </span>
            </div>
            {state.snapshot?.stats?.contextUsage ? (
              <div className="px-1 pt-1 font-mono text-[10px] text-ink-3 tabular-nums">
                {tf("{used} of {total}", {
                  used: state.snapshot.stats.contextUsage.tokens?.toLocaleString() ?? "—",
                  total: state.snapshot.stats.contextUsage.contextWindow.toLocaleString(),
                })}
              </div>
            ) : null}
          </div>
        </div>
      </Popover>
    </div>
  );
}
