import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ContextBreakdown, HostState, ModelInfo } from "@shared/types";
import { cn } from "../../lib/cn";
import { formatContext } from "../../lib/format";
import { GlideList, Popover } from "../motion";
import { BrainIcon, ChevronDownIcon, GlobeIcon, LayersIcon } from "../icons";

/**
 * Model and thinking depth, as one control in the prompt bar.
 *
 * Both sit on the prompt bar's bottom row, immediately right of the attach
 * button, because they qualify the prompt you are about to write — the model
 * decides how it is read, the depth how hard it thinks. The context ring that
 * used to sit beside the model lives in the prompt bar's footer, under
 * dictation.
 *
 * The menu carries three things: the models, the thinking track, and the context
 * ledger. The ledger answers "what is already in the window" — system prompt,
 * tool schemas, skills — with sizes rather than percentages, because the sizes
 * are what you can act on.
 *
 * Both controls are optimistic: clicking writes the pending value locally and
 * sends it to the host, so the track and the label move on the same frame as the
 * click. The host's state takes over as soon as it arrives, and the pending value
 * is dropped if it never does.
 */
export function ModelThinkingControl({
  state,
  onSetModel,
  onSetThinking,
}: {
  state: HostState;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const hostModelKey = state.snapshot?.model
    ? `${state.snapshot.model.provider}/${state.snapshot.model.id}`
    : "";
  const [pendingModelKey, setPendingModelKey] = useState<string | null>(null);
  const modelKey = pendingModelKey ?? hostModelKey;
  const current =
    state.models.find((model) => `${model.provider}/${model.id}` === modelKey) ?? state.snapshot?.model ?? null;

  const hostLevel = state.snapshot?.thinkingLevel ?? "off";
  const [pendingLevel, setPendingLevel] = useState<string | null>(null);
  const level = pendingLevel ?? hostLevel;

  const levels = state.snapshot?.thinkingLevels ?? ["off"];
  const index = Math.max(0, levels.indexOf(level));

  /* Drop the optimistic value once the host agrees, or after a beat if it does
   * not — a rejected request must not leave the control lying about the state. */
  useEffect(() => {
    if (pendingLevel === null) return;
    if (hostLevel === pendingLevel) {
      setPendingLevel(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingLevel(null), 1500);
    return () => window.clearTimeout(timer);
  }, [pendingLevel, hostLevel]);

  useEffect(() => {
    if (pendingModelKey === null) return;
    if (hostModelKey === pendingModelKey) {
      setPendingModelKey(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingModelKey(null), 3000);
    return () => window.clearTimeout(timer);
  }, [pendingModelKey, hostModelKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of state.models) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.models]);

  const pickModel = useCallback(
    (provider: string, id: string) => {
      setPendingModelKey(`${provider}/${id}`);
      onSetModel(provider, id);
      setOpen(false);
    },
    [onSetModel],
  );

  const pickLevel = useCallback(
    (next: string) => {
      setPendingLevel(next);
      onSetThinking(next);
      if (next === "max") window.dispatchEvent(new CustomEvent("pi:celebrate"));
    },
    [onSetThinking],
  );

  const short = current?.name?.replace(/\(.*\)/, "").trim() ?? "No model";

  /* the ledger is asked for when the menu opens, not on every host tick */
  const [ledger, setLedger] = useState<ContextBreakdown | null>(null);
  const messageCount = state.snapshot?.messageCount ?? 0;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pi
      .getContextBreakdown()
      .then((value) => {
        if (!cancelled) setLedger(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, messageCount]);

  return (
    <div className="relative flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`${current?.name ?? "No model"} · thinking ${level}`}
        className={cn(
          "pressable inline-flex h-6 max-w-[190px] items-center gap-1 rounded-chip px-1.5",
          open ? "bg-field text-ink" : "text-ink-2 hover:bg-hover-2",
        )}
      >
        <span className="min-w-0 truncate text-[11.5px]">{short}</span>
        {level !== "off" ? <span className="shrink-0 font-mono text-[10px] text-ink-3">{level}</span> : null}
        <ChevronDownIcon
          size={11}
          className="shrink-0 text-ink-3 transition-transform duration-300 ease-out-strong"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor="bottom-right" className="w-72">
        {/* The model list scrolls; the two controls under it do not. The ledger
            has to be visible the moment the menu opens — behind a scroll it may
            as well not exist, since nobody scrolls a menu to find an answer they
            did not know was there. */}
        <div className="flex max-h-[68vh] flex-col">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            <div className="px-1 pb-1 text-[10px] tracking-[0.4px] text-ink-3">MODEL</div>
            {/* Memoised: the glide highlight moves on every pointer move, and
                re-rendering a hundred model rows for that is what made the menu
                feel like it lagged behind the cursor. */}
            <ModelGroups grouped={grouped} currentKey={modelKey} onPick={pickModel} />
          </div>

          <div className="shrink-0 border-t border-line p-2">
            <div className="flex items-center gap-1.5 px-1 pb-1">
              <BrainIcon size={11} className="text-ink-3" />
              <span className="text-[10px] tracking-[0.4px] text-ink-3">THINKING</span>
              <span className="flex-1" />
              <span className="font-mono text-[10.5px] text-ink-2">{level}</span>
            </div>
            {levels.length > 1 ? (
              <div className="px-2.5 pt-1.5 pb-2">
                <div className="relative h-1.5 rounded-full bg-field">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent"
                    style={{
                      width: `${(index / (levels.length - 1)) * 100}%`,
                      transition: "width 220ms cubic-bezier(0.23,1,0.32,1)",
                    }}
                  />
                  {levels.map((entry, position) => (
                    <button
                      key={entry}
                      type="button"
                      title={entry}
                      aria-label={`Thinking depth ${entry}`}
                      aria-current={position === index}
                      onClick={() => pickLevel(entry)}
                      className="group/step absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                      style={{ left: `${(position / (levels.length - 1)) * 100}%` }}
                    >
                      <span
                        className={cn(
                          "rounded-full transition-[width,height,background-color] duration-200",
                          position === index
                            ? "size-3 bg-ink shadow-[0_0_0_2px_var(--surface)]"
                            : position <= index
                              ? "size-2 bg-accent group-hover/step:size-2.5"
                              : "size-1.5 bg-line-strong group-hover/step:size-2.5 group-hover/step:bg-ink-3",
                        )}
                      />
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="font-mono text-[9.5px] text-ink-3">{levels[0]}</span>
                  <span className="font-mono text-[9.5px] text-ink-3">{levels.at(-1)}</span>
                </div>
              </div>
            ) : (
              <div className="px-1.5 pb-2 text-[11px] text-ink-3">This model does not expose thinking levels.</div>
            )}

            <ContextLedger ledger={ledger} />
          </div>
        </div>
      </Popover>
    </div>
  );
}

/** The models, grouped by channel. Split out so hover never re-renders it. */
const ModelGroups = memo(function ModelGroups({
  grouped,
  currentKey,
  onPick,
}: {
  grouped: Array<[string, ModelInfo[]]>;
  currentKey: string;
  onPick: (provider: string, id: string) => void;
}) {
  return (
    <>
      {grouped.map(([provider, models]) => (
        <div key={provider} className="mb-1.5">
          <div className="flex items-center gap-1.5 px-1 pb-0.5">
            <GlobeIcon size={10} className="text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{provider}</span>
            <span className="font-mono text-[9.5px] tabular-nums text-ink-3">{models.length}</span>
          </div>
          <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
            {models.map((model) => {
              const key = `${model.provider}/${model.id}`;
              const active = currentKey === key;
              return (
                <button
                  key={model.id}
                  data-row
                  type="button"
                  onClick={() => onPick(model.provider, model.id)}
                  className={cn(
                    "glide-row pressable flex items-center gap-2 rounded-[6px] px-2 py-1 text-left",
                    active && "bg-surface shadow-hairline",
                  )}
                >
                  <span className={cn("min-w-0 flex-1 truncate text-[11.5px]", active ? "text-ink" : "text-ink-2")}>
                    {model.name}
                  </span>
                  {/* 1000000 is a megabyte of context, not "1000K" */}
                  <span className="shrink-0 font-mono text-[9.5px] text-ink-3">
                    {formatContext(model.contextWindow)}
                  </span>
                  {active ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                </button>
              );
            })}
          </GlideList>
        </div>
      ))}
    </>
  );
});

/**
 * What the window is holding, as sizes.
 *
 * Every row is a token count and a short qualifier; there are deliberately no
 * percentages, because "tool definitions cost 9k tokens" is actionable and "8%"
 * is not. The footer says the numbers are estimates.
 */
function ContextLedger({ ledger }: { ledger: ContextBreakdown | null }) {
  const hasWindow = Boolean(ledger?.contextWindow);
  return (
    <div className="mt-1 border-t border-line pt-2">
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <LayersIcon size={11} className="text-ink-3" />
        <span className="text-[10px] tracking-[0.4px] text-ink-3">CONTEXT</span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-ink-2 tabular-nums">
          {ledger?.used != null ? ledger.used.toLocaleString() : "—"}
          {hasWindow ? ` / ${ledger?.contextWindow.toLocaleString()}` : ""}
        </span>
      </div>
      {ledger?.parts.length ? (
        <div className="flex flex-col">
          {ledger.parts.map((part) => (
            <div key={part.key} className="flex items-baseline gap-2 px-1.5 py-[3px]">
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{part.label}</span>
              {part.detail ? (
                <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{part.detail}</span>
              ) : null}
              <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ink tabular-nums">
                {part.tokens.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-1.5 pb-1 text-[11px] text-ink-3">Waiting for the session…</div>
      )}
      <div className="px-1.5 pt-1 text-[10px] leading-snug text-ink-3">
        Estimates from the session&apos;s own prompt, tool schemas and skill files.
      </div>
    </div>
  );
}
