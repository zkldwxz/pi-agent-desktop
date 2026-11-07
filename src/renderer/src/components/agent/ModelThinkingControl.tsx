import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { HostState, ModelInfo } from "@shared/types";
import { cn } from "../../lib/cn";
import { formatContext } from "../../lib/format";
import { t, tf } from "../../lib/i18n";
import { GlideList, Popover } from "../motion";
import { ThinkingTrack, ThinkingTrackEnds, thinkingLevelClass } from "../ThinkingTrack";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ImageIcon, RefreshIcon } from "../icons";

/**
 * The one composer chip that qualifies a prompt: which model reads it, and how
 * hard that model thinks.
 *
 * Model and depth are the same decision — you pick a model and then decide how
 * much to spend on it — so they live in one control, and the card the chip opens
 * is small enough to read without looking up: the depth, the name, the track.
 * The model list is a second state behind the name, because switching the model
 * is the rarer half of the job and it is the only thing that needs a scroll.
 *
 * Both halves are optimistic: the pick moves the chip on the same frame as the
 * click and the host's state takes over when it arrives. A depth is committed when
 * the drag ends, not as it crosses each step, so sliding across the ramp does not
 * write to the host six times.
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
  /** `card` is the depth and the name, `list` is the models behind the name */
  const [view, setView] = useState<"card" | "list">("card");
  const hostModelKey = state.snapshot?.model
    ? `${state.snapshot.model.provider}/${state.snapshot.model.id}`
    : "";
  const [pendingModelKey, setPendingModelKey] = useState<string | null>(null);
  const modelKey = pendingModelKey ?? hostModelKey;
  const current =
    state.models.find((model) => `${model.provider}/${model.id}` === modelKey) ?? state.snapshot?.model ?? null;

  useEffect(() => {
    if (pendingModelKey === null) return;
    if (hostModelKey === pendingModelKey) {
      setPendingModelKey(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingModelKey(null), 3000);
    return () => window.clearTimeout(timer);
  }, [pendingModelKey, hostModelKey]);

  const pickModel = useCallback(
    (provider: string, id: string) => {
      setPendingModelKey(`${provider}/${id}`);
      onSetModel(provider, id);
      setOpen(false);
    },
    [onSetModel],
  );

  const hostLevel = state.snapshot?.thinkingLevel ?? "off";
  const [pendingLevel, setPendingLevel] = useState<string | null>(null);
  /* what the pointer is over right now — the label follows it, the host does not
     hear until the drag is released */
  const [slideLevel, setSlideLevel] = useState<string | null>(null);

  useEffect(() => {
    if (pendingLevel === null) return;
    if (hostLevel === pendingLevel) {
      setPendingLevel(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingLevel(null), 1500);
    return () => window.clearTimeout(timer);
  }, [pendingLevel, hostLevel]);

  const commitLevel = useCallback(
    (next: string) => {
      setSlideLevel(null);
      setPendingLevel(next);
      onSetThinking(next);
    },
    [onSetThinking],
  );

  /* The ramp comes from the session, not from the model row. The catalogue's own
     list is derived in `thinkingLevelsFor`, which hands every reasoning model the
     full seven steps unless its entry declares a `thinkingLevelMap` — so a proxy
     that stops at `high` got offered `max`, and the host then refused
     it, which read as the chip snapping back on its own. */
  const levels = state.snapshot?.thinkingLevels ?? current?.thinkingLevels ?? ["off"];
  const canThink = levels.length > 1;
  /* the track is told what is committed, never what the pointer is hovering —
     otherwise a release would compare against its own preview and skip the write */
  const committed = levels.includes(pendingLevel ?? hostLevel) ? (pendingLevel ?? hostLevel) : "off";
  const shown = slideLevel ?? committed;
  const short = current?.name?.replace(/\(.*\)/, "").trim() ?? t("No model");

  /* The reset is only worth a button while the session is running at something
     other than the depth the settings file would have started this model on. */
  const fallback = state.settings.defaultThinkingLevel;
  const resetTo = fallback && fallback !== committed && levels.includes(fallback) ? fallback : null;
  const resetLabel = resetTo ? tf("Back to {level}", { level: t(resetTo) }) : "";

  const toggle = () => {
    if (open) {
      setOpen(false);
      setSlideLevel(null);
      return;
    }
    /* a model that cannot think has no card to show — go straight to its list */
    setView(canThink ? "card" : "list");
    setOpen(true);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of state.models) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.models]);

  return (
    <div className="relative flex min-w-0 items-center">
      <button
        type="button"
        data-popover-trigger
        aria-expanded={open}
        onClick={toggle}
        title={tf("Model — {model}", { model: current?.name ?? t("No model") })}
        className={cn(
          /* baocode's composer pill: 22px, fully round, muted 12px text, a
             faint chevron; the depth rides as plain text ("· High") */
          "pressable inline-flex h-[22px] min-w-0 items-center gap-1 rounded-full py-0 pr-[3px] pl-1.5 text-ui-meta transition-colors duration-[120ms]",
          open ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover",
        )}
      >
        {/* the same pill as the mode's: icon 13, then "model · depth" in one
            muted run, as baocode writes "deepseek-v4.1-flash · 400K · High" */}
        <span className="flex size-[13px] shrink-0 items-center justify-center">
          <span className="codicon codicon-sparkle text-[13px]" aria-hidden />
        </span>
        <span className="min-w-0 truncate">
          {short}
          {canThink ? ` · ${t(shown)}` : ""}
        </span>
        <ChevronDownIcon
          size={15}
          className="shrink-0 text-ink-4 transition-transform duration-300 ease-out-strong"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          /* a drag that never committed must not leave its preview on the chip */
          setSlideLevel(null);
        }}
        anchor="bottom-right"
        className="w-80"
      >
        {view === "card" ? (
          <div className="px-3 pb-2 pt-1.5">
            {/* row 1 — the depth, in its own colour, with the way back out of it */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-ui-base font-medium transition-colors duration-300",
                  thinkingLevelClass(shown),
                )}
              >
                {t(shown)}
              </span>
              {resetTo ? (
                <button
                  type="button"
                  onClick={() => commitLevel(resetTo)}
                  title={resetLabel}
                  aria-label={resetLabel}
                  className="pressable shrink-0 rounded-chip p-1 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                >
                  <RefreshIcon size={12} />
                </button>
              ) : null}
            </div>
            {/* row 2 — the model, and the only way into the list */}
            <button
              type="button"
              onClick={() => setView("list")}
              title={t("Switch model")}
              className={cn(
                "-mx-1.5 mt-1 flex w-[calc(100%+12px)] items-center gap-1.5 rounded-chip px-1.5 py-1 text-left",
                "text-ink transition-colors hover:bg-hover-2",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-ui-sm">
                <span className="text-ink-3">{current?.providerName ?? ""} · </span>
                {current?.name ?? t("No model")}
              </span>
              <ChevronDownIcon
                size={11}
                className="shrink-0 text-ink-3"
                style={{ transform: "rotate(-90deg)" }}
              />
            </button>
            {/* row 3 — the track */}
            <div className="mt-1">
              <ThinkingTrack levels={levels} value={committed} onPick={commitLevel} onSlide={setSlideLevel} />
              <ThinkingTrackEnds levels={levels} />
            </div>
          </div>
        ) : (
          /* The list is the only part of this control that scrolls, and it gets
             the whole height for it. */
          <div className="flex max-h-[min(420px,62vh)] flex-col">
            <div className="flex shrink-0 items-center gap-1 px-1.5 pb-1 pt-1.5">
              {canThink ? (
                <button
                  type="button"
                  onClick={() => setView("card")}
                  aria-label={t("Back to depth")}
                  title={t("Back to depth")}
                  className="pressable -ml-0.5 shrink-0 rounded-chip p-1 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                >
                  <ArrowLeftIcon size={12} />
                </button>
              ) : null}
              <span className="text-ui-xs tracking-[0.4px] text-ink-3">{t("MODEL")}</span>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {/* Memoised: the glide highlight moves on every pointer move, and
                  re-rendering a hundred model rows for that is what made the menu
                  feel like it lagged behind the cursor. */}
              <ModelGroups grouped={grouped} currentKey={modelKey} onPick={pickModel} />
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

/** A model row's right-hand marker. Small enough to sit on the 4px radius floor. */
const MODEL_BADGE =
  "shrink-0 rounded-tiny bg-field px-1 py-px font-mono text-ui-2xs leading-[13px] text-ink-3";

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
  const showsVision = useMemo(
    () => grouped.some(([, models]) => models.some((model) => !model.supportsImages)),
    [grouped],
  );

  return (
    <>
      {grouped.map(([provider, models]) => (
        <div key={provider} className="pb-1">
          {/* Sticky, because with every channel in the catalogue the list is
              long enough to lose track of which one you are inside. The count
              it used to print is gone: the rows are right below it. */}
          <div className="sticky top-0 z-10 -mx-2 bg-surface px-2 pb-1 pt-1.5">
            <div className="truncate text-ui-2xs font-medium uppercase tracking-[0.5px] text-ink-3">
              {models[0]?.providerName ?? provider}
            </div>
          </div>
          <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
            {models.map((model) => {
              const active = currentKey === `${model.provider}/${model.id}`;
              const size = formatContext(model.contextWindow);
              return (
                <button
                  key={model.id}
                  data-row
                  type="button"
                  onClick={() => onPick(model.provider, model.id)}
                  title={model.name}
                  /* `pr-7` reserves the checkmark's column, and the mark is
                     faded rather than removed when off: a list whose rows shift
                     12px as you hover them is worse than one that never marks
                     the hover at all. */
                  className="glide-row pressable relative flex h-8 w-full items-center gap-1.5 rounded-chip py-0 pl-2 pr-7 text-left"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-ui-caption",
                      active ? "font-medium text-ink" : "text-ink-2",
                    )}
                  >
                    {model.name}
                  </span>
                  {/* A marker every row carries says nothing, so it is drawn
                      only once something in the list lacks it. */}
                  {showsVision && model.supportsImages ? (
                    <ImageIcon size={10} className="shrink-0 text-ink-3" />
                  ) : null}
                  {/* Half the catalogue names its own window — "DeepSeek V4 Flash
                      1M" does not need a second 1M sitting next to it. */}
                  {model.name.includes(size) ? null : <span className={MODEL_BADGE}>{size}</span>}
                  <CheckIcon
                    size={12}
                    className={cn(
                      "absolute right-2 shrink-0 text-ink transition-opacity duration-150",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </GlideList>
        </div>
      ))}
    </>
  );
});

