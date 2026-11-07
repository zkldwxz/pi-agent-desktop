import { memo, useEffect, useMemo, useState } from "react";
import { cacheHitRate } from "@shared/cache-usage";
import type { ChatMessage, ToolActivity } from "@shared/types";
import { buildTurns, CONVERSATION_COLUMN, liveStatusLabel, summarizeWork, type TurnView } from "../lib/agent-view";
import { formatDuration, relativeTime } from "../lib/format";
import { stagger } from "./motion";
import { AgentAnswer } from "./agent/AgentAnswer";
import { AgentToolRun } from "./agent/AgentToolRun";
import { AgentTrace } from "./agent/AgentTrace";
import { AgentWorking } from "./agent/AgentWorking";
import { CheckIcon, ChevronDownIcon, CopyIcon, ListChecksIcon, PencilIcon, RefreshIcon } from "./icons";
import { t, tf, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";

/** stable empty array — a fresh one would defeat the buildTurns cache key */
const NO_LIVE_TOOLS: ToolActivity[] = [];

/* transcript mounts newest-first, then batches of this size per frame */
const FIRST_BATCH = 8;
const BATCH = 12;

/**
 * The transcript.
 *
 * Each turn is composed from the Beautiful UI primitives that match the state
 * the agent is actually in: a reasoning/tool trace, a tool run with diff chips,
 * the answer, and the pixel-grid loader while it works. Turns enter with the
 * capped cascade so a long history reveals in one coordinated beat.
 */
export function MessageThread({
  messages,
  tools,
  streaming,
  stopped,
  sessionKey,
  onFork,
  onEditPrompt,
}: {
  messages: ChatMessage[];
  tools: ToolActivity[];
  streaming: boolean;
  /** the last run was interrupted by the user — the final turn reads "Stopped" */
  stopped?: boolean;
  /** which session this transcript is — switching it restarts incremental reveal */
  sessionKey: string;
  /** branch the session from a turn's prompt */
  onFork?: (userIndex: number) => void;
  /** rewind to before this turn's prompt and drop it back into the composer */
  onEditPrompt?: (text: string, userIndex: number) => void;
}) {
  useLocale();
  const turns = useMemo(
    () => buildTurns(messages, streaming ? tools : NO_LIVE_TOOLS),
    [messages, tools, streaming],
  );

  /* A long history mounts in slices: the newest turns first, then the rest a
   * batch per frame. Mounting hundreds of markdown blocks in one commit was
   * the stutter you felt when clicking a conversation. The browser's scroll
   * anchoring keeps the viewport pinned while older turns land above it. */
  const [visibleCount, setVisibleCount] = useState(FIRST_BATCH);
  useEffect(() => setVisibleCount(FIRST_BATCH), [sessionKey]);
  const hiddenCount = Math.max(0, turns.length - visibleCount);
  useEffect(() => {
    if (!hiddenCount) return;
    const id = requestAnimationFrame(() => {
      setVisibleCount((current) => current + BATCH);
    });
    return () => cancelAnimationFrame(id);
  }, [hiddenCount]);
  const shown = hiddenCount ? turns.slice(-visibleCount) : turns;

  const lastTurn = turns.at(-1);
  const awaitingFirstToken = streaming && (!lastTurn || lastTurn.items.length === 0);

  if (!turns.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div
          className="text-ui-display font-semibold tracking-[-0.03em] text-ink"
          style={{ animation: "fade-up 460ms var(--ease-out-strong-css) both" }}
        >
          {t("What should Pi do next?")}
        </div>
        <p
          className="max-w-md text-ui-base text-ink-3"
          style={{ animation: "fade-up 460ms var(--ease-out-strong-css) 80ms both" }}
        >
          {t("This window talks to the Pi agent already installed on this machine. Sessions, models, and credentials stay in ~/.pi/agent.")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        /* px-4, the composer's inset: prompt cards and the prompt shell share
           both edges. Everything a turn produces sits a further px-3.5 in, on
           the same line as the text inside the prompt card (baocode). */
        CONVERSATION_COLUMN,
        "flex flex-col gap-8 px-4",
      )}
    >

      {hiddenCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount(turns.length)}
          className="pressable mx-auto flex items-center gap-1.5 rounded-chip bg-surface px-2.5 py-1 text-ui-sm text-ink-3 shadow-hairline hover:text-ink"
        >
          {tf(hiddenCount === 1 ? "Show {count} earlier turn" : "Show {count} earlier turns", { count: hiddenCount })}
        </button>
      ) : null}
      {shown.map((turn, index) => {
        const globalIndex = index + hiddenCount;
        /* a tool can be running with no streaming assistant message yet — the
           app-level flag covers that gap, so "Worked for" waits for the run */
        const isLive = turn.streaming || (streaming && globalIndex === turns.length - 1);
        return (
        <section
          key={turn.key}
          data-turn={turn.key}
          className="group/turn flex scroll-mt-4 flex-col gap-3.5"
          style={globalIndex >= turns.length - 3 ? stagger(0) : undefined}
        >
          {turn.boundary ? <TurnBoundary text={turn.boundary} /> : null}

          {turn.prompt ? (
            /* The prompt is a full-width card that sticks to the top while its
               turn scrolls past (baocode's "sticky" style): you always see what
               the text under it answers. The wrapper paints the page colour
               above the card so prose never shows through the gap. It is sticky
               inside its own <section>, so the next prompt pushes it away. */
            /* -top-6 cancels the scroller's pt-6: Chrome sticks to the
               padding edge, which left a 1.5rem band of prose showing above
               the card. Stuck, the mask starts at the very top. */
            <div className="sticky -top-6 z-10 -mt-3 bg-page pt-3">
              <PromptCard
                text={turn.prompt}
                onEdit={onEditPrompt ? () => onEditPrompt(turn.prompt ?? "", turn.userIndex) : undefined}
                onRetry={onFork ? () => onFork(turn.userIndex) : undefined}
              />
            </div>
          ) : null}

          {turn.notes.map((note, noteIndex) => (
            <div
              key={noteIndex}
              className="flex items-center gap-2 rounded-card bg-inset px-3 py-2 text-ui-caption text-ink-2"
              style={{ animation: "fade-up 320ms var(--ease-out-strong-css) both" }}
            >
              <span className="inline-flex h-4 items-center rounded-chip bg-field px-1.5 font-mono text-ui-xs text-ink-3">
                {note.tone === "compaction" ? t("compacted") : t("branch")}
              </span>
              <span className="truncate">{note.text || t("Context compacted")}</span>
            </div>
          ))}

          {/* relative: the hover footer hangs below, in the 32px gap before
              the next prompt, instead of taking height of its own */}
          <div className="relative flex flex-col gap-2.5 px-3">
            <TurnItems turn={turn} onFork={onFork} live={isLive} />

            {/* the gap line — only the beat the transcript itself cannot show */}
            {isLive && liveStatusLabel(turn, isLive) ? <AgentWorking label={liveStatusLabel(turn, isLive)!} /> : null}

            {/* the completion line: shown on hover only, except "Stopped" */}
            {!isLive && turn.fullText.trim() ? (
              <TurnFooter
                turn={turn}
                onFork={onFork}
                stopped={Boolean(stopped) && globalIndex === turns.length - 1}
              />
            ) : null}
          </div>
        </section>
        );
      })}

      {awaitingFirstToken ? (
        <div className="px-3">
          <AgentWorking />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The seam between two tasks that no prompt divides.
 *
 * Plan mode plans in one task and builds in the next; only the second has no
 * prompt of its own, because the user's answer to a plan is the button, not a
 * sentence. Without this row the build simply continues the planning turn and
 * the transcript reads as one enormous task — which is exactly what it used to
 * do. It is a divider, not a bubble: nothing here is editable or forkable, so it
 * takes the quiet left-aligned treatment rather than a prompt's shape.
 */
function TurnBoundary({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-2 pt-1"
      style={{ animation: "fade-up 360ms var(--ease-out-strong-css) both" }}
    >
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span className="flex items-center gap-1.5 rounded-chip bg-field px-2 py-0.5 text-ui-caption font-medium text-ink-2 shadow-hairline">
        <ListChecksIcon size={11} className="shrink-0 text-green" />
        <span className="whitespace-pre-wrap">{plainBoundary(text)}</span>
      </span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * The boundary sentence without the markdown it was written in.
 *
 * The extension writes `**Building the plan — X** (4 steps)` because the same
 * string is what the CLI prints as markdown. Here it is a one-line divider, and
 * rendering asterisks literally would be worse than stripping them — there is no
 * markdown renderer in this row and no room for a paragraph anyway.
 */
function plainBoundary(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The user's message: a full-width card, the composer's width and edges.
 *
 * Long prompts clamp to four lines (the card is sticky, so a pasted log must
 * not cover the screen); one click opens the rest. `whitespace-pre-wrap` keeps
 * the user's own line breaks. Edit and retry appear on hover, in the corner.
 */
function PromptCard({ text, onEdit, onRetry }: { text: string; onEdit?: () => void; onRetry?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n").length;
  /* folded to three lines, as baocode folds it */
  const long = lines > 3 || text.length > 240;

  return (
    /* baocode's sticky prompt: the composer's fill and 1px border, radius 8,
       padding 12 / 10 / 12 / 11, 13.5px at 1.5 */
    <div className="group/prompt relative overflow-hidden rounded-card border border-line-strong bg-field px-3 pt-2.5 pb-[11px] text-ui-base leading-[1.5] text-ink">
      <div
        className={cn(
          "scrollbar-thin whitespace-pre-wrap break-words pr-12",
          long && !expanded && "max-h-[61px] overflow-hidden",
          long && expanded && "max-h-[40vh] overflow-y-auto",
        )}
      >
        {text}
      </div>

      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="pressable mt-1 flex items-center gap-1 rounded-chip text-ui-sm text-ink-3 hover:text-ink"
        >
          <ChevronDownIcon size={11} className={cn("transition-transform duration-150", expanded && "rotate-180")} />
          {expanded ? t("Show less") : tf("Show the full message ({count} lines)", { count: lines })}
        </button>
      ) : null}

      {onEdit || onRetry ? (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/prompt:opacity-100 focus-within:opacity-100">
          {onEdit ? (
            <button
              type="button"
              title={t("Edit this prompt")}
              aria-label={t("Edit this prompt")}
              onClick={onEdit}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
            >
              <PencilIcon size={12} />
            </button>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              title={t("Retry from here")}
              aria-label={t("Retry from here")}
              onClick={onRetry}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
            >
              <RefreshIcon size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The row that closes a settled turn.
 *
 * Left: how long the turn ran and what it cost. Right: the affordances Cursor
 * puts on every answer — copy the prose, retry from this turn — plus when it
 * happened. The actions stay invisible until the pointer is over the row.
 */
function TurnFooter({
  turn,
  onFork,
  stopped,
}: {
  turn: TurnView;
  onFork?: (userIndex: number) => void;
  /** this run was interrupted — say so instead of "Worked for" */
  stopped?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(turn.fullText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const long = turn.endedAt > turn.timestamp + 5000;
  return (
    /* Housekeeping, not content: duration, tokens, cache share and the
       actions show on hover (or keyboard focus). Only "Stopped" stays — it
       changes how the answer above should be read. */
    <div
      className={cn(
        "group/footer absolute inset-x-3 top-full mt-1 flex h-6 items-center gap-2 text-ui-sm text-ink-3",
        "transition-opacity duration-150 focus-within:opacity-100",
        stopped ? "" : "opacity-0 group-hover/turn:opacity-100",
      )}
    >
      {stopped ? (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-ink-3" />
          <span>{t("Stopped")}</span>
        </span>
      ) : long ? (
        <>
          <CheckIcon size={11} className="text-green" />
          <span>{tf("Worked for {duration}", { duration: formatDuration(turn.endedAt - turn.timestamp) })}</span>
        </>
      ) : null}
      {turn.usage && turn.usage.total > 0 ? (
        <span className="tabular-nums text-ink-4">
          {long || stopped ? "· " : ""}
          {turn.usage.total >= 1000 ? `${(turn.usage.total / 1000).toFixed(1)}k` : turn.usage.total} tokens
          {turn.usage.cacheRead
            ? ` · ${tf("{percent}% cached", { percent: Math.round(cacheHitRate(turn.usage) * 100) })}`
            : ""}
          {turn.usage.cost ? ` · $${turn.usage.cost.toFixed(4)}` : ""}
          {/* output speed, the other half of "how did that feel" — only worth
              showing once the answer ran long enough to have a real rate */}
          {long && turn.usage.output > 0 && turn.endedAt > turn.timestamp
            ? ` · ${(turn.usage.output / ((turn.endedAt - turn.timestamp) / 1000)).toFixed(0)} tok/s`
            : ""}
        </span>
      ) : null}
      <span className="flex-1" />
      <span className="flex items-center gap-0.5">
        <button
          type="button"
          title={copied ? t("Copied") : t("Copy answer")}
          aria-label={t("Copy answer")}
          onClick={copy}
          className="pressable flex size-5.5 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
        >
          {copied ? <CheckIcon size={12} className="text-green" /> : <CopyIcon size={12} />}
        </button>
        {onFork ? (
          <button
            type="button"
            title={t("Retry from here")}
            aria-label={t("Retry from here")}
            onClick={() => onFork(turn.userIndex)}
            className="pressable flex size-5.5 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <RefreshIcon size={12} />
          </button>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums">{relativeTime(new Date(turn.timestamp).toISOString())}</span>
    </div>
  );
}

/**
 * The beats of one turn, in production order.
 *
 * A reasoning beat is "working" only while it is literally the newest thing in
 * the turn: the moment a tool row or prose follows it, the beat settles to
 * "Thought for Xs" and collapses — a trace that kept shimmering under the
 * answer streaming past it read as the model still deciding what to say.
 * Every beat keeps its own trace, so a run that thinks before each tool call
 * shows one per call instead of a single frozen block at the top.
 */
const TurnItems = memo(function TurnItems({
  turn,
  onFork,
  live,
}: {
  turn: TurnView;
  onFork?: (userIndex: number) => void;
  /** the run is still going — the last turn keeps its working affordances */
  live: boolean;
}) {
  /* ZCode's collapse: once the run settles, the whole work segment — every
   * thinking beat and every tool call, however interleaved — folds into one
   * summary row. Expanding it lays everything back out individually, one row
   * per call: a terminal never merges with a terminal, an edit never merges
   * with an edit. Live turns keep the running rows so progress stays visible. */
  const workCount = turn.items.filter((item) => item.kind !== "text").length;
  const collapseWork = !live && workCount >= 2;
  let summaryShown = false;

  return turn.items.map((item, itemIndex) => {
    const isLast = itemIndex === turn.items.length - 1;
    if (collapseWork && item.kind !== "text") {
      if (summaryShown) return null;
      summaryShown = true;
      return <TurnRunSummary key={`run-summary-${turn.key}`} turn={turn} />;
    }
    if (item.kind === "thinking") {
      return (
        <AgentTrace
          key={item.key}
          text={item.text}
          durationMs={item.durationMs}
          working={live && isLast}
        />
      );
    }
    if (item.kind === "tools") {
      return <AgentToolRun key={item.key} runs={item.runs} />;
    }
    return (
      <AgentAnswer key={item.key} turn={turn} item={item} isLast={isLast} streaming={live && isLast} />
    );
  });
});

/**
 * One clause of the run summary — "Read 2 files" — with the number set bold,
 * the way baocode writes it. The template is translated whole (word order
 * differs between languages) and split on `{count}`.
 */
function Clause({ one, many, count, first }: { one: string; many: string; count: number; first: boolean }) {
  const translated = t(count === 1 ? one : many);
  const [before, after] = (first ? capitalise(translated) : translated).split("{count}");
  return (
    <>
      {before}
      <span className="font-semibold text-ink">{count}</span>
      {after}
    </>
  );
}

/**
 * The settled run, folded into one row.
 *
 * It reads as a sentence, baocode's "Read 2 files, ran 1 command · thought 2s":
 * the tallies by kind (reads, searches, edits, terminals, anything else), then
 * how long the model spent thinking. Expanding lays the segment back out in
 * production order, one row per beat and per call.
 */
const TurnRunSummary = memo(function TurnRunSummary({ turn }: { turn: TurnView }) {
  const [open, setOpen] = useState(false);
  useLocale();
  const work = turn.items.filter((item) => item.kind !== "text");
  const runs = work.flatMap((item) => (item.kind === "tools" ? item.runs : []));
  const tally = summarizeWork(runs);
  const other = tally.calls - tally.reads - tally.searches - tally.edits - tally.commands;
  const thoughtMs = work.reduce((sum, item) => sum + (item.kind === "thinking" ? (item.durationMs ?? 0) : 0), 0);

  const clauses: Array<{ key: string; one: string; many: string; count: number }> = [];
  if (tally.reads) clauses.push({ key: "r", one: "read {count} file", many: "read {count} files", count: tally.reads });
  if (tally.searches)
    clauses.push({ key: "s", one: "searched {count} time", many: "searched {count} times", count: tally.searches });
  if (tally.edits) clauses.push({ key: "e", one: "edited {count} file", many: "edited {count} files", count: tally.edits });
  if (tally.commands)
    clauses.push({ key: "c", one: "ran {count} command", many: "ran {count} commands", count: tally.commands });
  if (other > 0) clauses.push({ key: "o", one: "used {count} tool", many: "used {count} tools", count: other });

  if (open) {
    return (
      <div className="flex w-full flex-col gap-3">
        {work.map((item) =>
          item.kind === "thinking" ? (
            <AgentTrace key={item.key} text={item.text} durationMs={item.durationMs} working={false} />
          ) : (
            item.runs.map((run) => <AgentToolRun key={run.toolCallId} runs={[run]} />)
          ),
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pressable -ml-1.5 flex w-fit items-center gap-1.5 rounded-chip px-1.5 py-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          <ChevronDownIcon size={12} className="rotate-180" />
          {t("Collapse run")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group/run pressable -mx-1.5 flex w-fit max-w-full items-center gap-1 rounded-chip px-1.5 py-1 text-left text-ui-base text-ink-2 hover:bg-hover-2"
      style={{ animation: "fade-in 260ms ease-out both" }}
    >
      <span className="min-w-0 truncate">
        {clauses.length
          ? clauses.map((clause, index) => (
              <span key={clause.key}>
                {index ? t(", ") : ""}
                <Clause one={clause.one} many={clause.many} count={clause.count} first={index === 0} />
              </span>
            ))
          : t("Thought")}
        {thoughtMs >= 1000 && clauses.length ? (
          <span className="text-ink-3"> · {tf("thought {duration}", { duration: formatDuration(thoughtMs) })}</span>
        ) : null}
      </span>
      <ChevronDownIcon size={12} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/run:opacity-100" />
    </button>
  );
});

/** The first clause starts the sentence; the templates are lower-case, so
 *  English needs its first letter raised after translation. CJK is unchanged. */
function capitalise(template: string): string {
  return template.charAt(0).toUpperCase() + template.slice(1);
}
