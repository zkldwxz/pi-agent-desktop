import { useMemo } from "react";
import type { HostState } from "@shared/types";
import { cn } from "../../lib/cn";
import { GlideList } from "../motion";
import { BrainIcon, GlobeIcon, LayersIcon } from "../icons";
import { pressureFor } from "../../lib/context-pressure";

/** A ring painted in the pressure band's colour, with the percentage inside. */
function ContextRing({ percent, size = 34 }: { percent: number | null; size?: number }) {
  const { tone, label } = pressureFor(percent);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      title={percent === null ? "Context usage unknown" : `Context ${percent}% — ${label}`}
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
      <span className="font-mono text-[9px] tabular-nums" style={{ color: percent === null ? "var(--ink-3)" : tone }}>
        {percent === null ? "—" : Math.round(percent)}
      </span>
    </span>
  );
}

/**
 * Model and thinking depth.
 *
 * Both live here, in the right dock, rather than in the composer: they describe
 * *how* the session runs, not what you are typing, and the picker was competing
 * with the input for attention.
 *
 * The context ring sits immediately left of the model, because "how full is the
 * window" only means anything about the model that owns that window.
 *
 * Thinking depth is a track, not a row of pills — the levels are ordered, so a
 * position on a line says more than a highlighted chip does. `max` is the top of
 * the track and fires the prompt bar's sweep.
 */
export function ModelControl({
  state,
  onSetModel,
  onSetThinking,
}: {
  state: HostState;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
}) {
  const current = state.snapshot?.model;
  const levels = state.snapshot?.thinkingLevels ?? ["off"];
  const level = state.snapshot?.thinkingLevel ?? "off";
  const index = Math.max(0, levels.indexOf(level));
  const contextPercent = state.snapshot?.stats?.contextUsage?.percent ?? null;

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
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
      <div className="px-1 pb-1 text-[10.5px] tracking-[0.4px] text-ink-3">MODEL</div>

      {/* context ring · medium gap · the model it belongs to */}
      <div className="mb-2 flex items-center gap-3 rounded-[7px] bg-surface px-2.5 py-2 shadow-hairline">
        <ContextRing percent={contextPercent} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink">{current?.name ?? "No model"}</span>
          <span className="block truncate font-mono text-[10px] text-ink-3">
            {current
              ? `${current.provider} · ${Math.round(current.contextWindow / 1000)}K ctx`
              : "—"}
          </span>
        </span>
      </div>

      <div className="mb-1 flex items-center gap-1.5 px-1">
        <BrainIcon size={11} className="text-ink-3" />
        <span className="text-[10.5px] tracking-[0.4px] text-ink-3">THINKING</span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-ink-2">{level}</span>
      </div>

      {levels.length > 1 ? (
        <div className="mb-3 px-1.5 pt-1 pb-2">
          <div className="relative h-1.5 rounded-full bg-field">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{
                width: `${(index / (levels.length - 1)) * 100}%`,
                transition: "width 320ms cubic-bezier(0.23,1,0.32,1)",
              }}
            />
            {levels.map((entry, position) => {
              const reached = position <= index;
              return (
                <button
                  key={entry}
                  type="button"
                  title={entry}
                  aria-label={`Thinking depth ${entry}`}
                  onClick={() => {
                    onSetThinking(entry);
                    // max is the one setting that changes the character of a run
                    if (entry === "max") window.dispatchEvent(new CustomEvent("pi:celebrate"));
                  }}
                  className="group/step absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${(position / (levels.length - 1)) * 100}%` }}
                >
                  <span
                    className={cn(
                      "rounded-full transition-[width,height,background-color] duration-200",
                      position === index
                        ? "size-3 bg-ink shadow-[0_0_0_2px_var(--surface)]"
                        : reached
                          ? "size-2 bg-accent group-hover/step:size-2.5"
                          : "size-1.5 bg-line-strong group-hover/step:size-2.5 group-hover/step:bg-ink-3",
                    )}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between">
            <span className="font-mono text-[9.5px] text-ink-3">{levels[0]}</span>
            <span className="font-mono text-[9.5px] text-ink-3">{levels.at(-1)}</span>
          </div>
        </div>
      ) : (
        <div className="mb-3 px-1.5 text-[11px] text-ink-3">This model does not expose thinking levels.</div>
      )}

      {grouped.map(([provider, models]) => (
        <div key={provider} className="mb-1.5">
          <div className="flex items-center gap-1.5 px-1 pb-0.5">
            <GlobeIcon size={10} className="text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{provider}</span>
            <span className="font-mono text-[9.5px] text-ink-3 tabular-nums">{models.length}</span>
          </div>
          <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
            {models.map((model) => {
              const active = current?.provider === model.provider && current?.id === model.id;
              return (
                <button
                  key={model.id}
                  data-row
                  type="button"
                  onClick={() => onSetModel(model.provider, model.id)}
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
    </div>
  );
}
