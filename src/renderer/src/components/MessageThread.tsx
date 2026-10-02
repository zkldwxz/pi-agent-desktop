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
        /* the turn block carries px-6 inside the column while the composer
           dock insets px-4 — ZCode's exact pairing, which leaves the prompt
           shell overhanging the text block by 8px on both edges. The column
           itself is ZCode's responsive measure, not a fixed width. */
        CONVERSATION_COLUMN,
        "flex flex-col gap-8 px-6",
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
          className="group/turn flex scroll-mt-4 flex-col gap-3"
          style={globalIndex >= turns.length - 3 ? stagger(0) : undefined}
        >
          {turn.boundary ? <TurnBoundary text={turn.boundary} /> : null}

          {turn.prompt ? (
            <div className="group/prompt flex items-center justify-end gap-1.5">
              {/* hover affordances, Cursor-style: edit drops the text back
                  into the composer, retry restarts the turn */}
              <div className="flex items-center gap-0.5">
                {onEditPrompt ? (
                  <button
                    type="button"
                    title={t("Edit this prompt")}
                    aria-label={t("Edit this prompt")}
                    onClick={() => onEditPrompt(turn.prompt ?? "", turn.userIndex)}
                    className="pressable flex size-5.5 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
                  >
                    <PencilIcon size={12} />
                  </button>
                ) : null}
                {onFork ? (
                  <button
                    type="button"
                    title="Retry from here"
                    aria-label="Retry from here"
                    onClick={() => onFork(turn.userIndex)}
                    className="pressable flex size-5.5 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
                  >
                    <RefreshIcon size={12} />
                  </button>
                ) : null}
              </div>
              <PromptBubble text={turn.prompt} />
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

          <TurnItems turn={turn} onFork={onFork} live={isLive} />

          {/* the gap line — only the beat the transcript itself cannot show */}
          {isLive && liveStatusLabel(turn, isLive) ? <AgentWorking label={liveStatusLabel(turn, isLive)!} /> : null}

          {/* the completion line, Cursor-style: duration and cost on the left,
              copy / retry affordances and the timestamp on the right */}
          {!isLive && turn.fullText.trim() ? (
            <TurnFooter
              turn={turn}
              onFork={onFork}
              stopped={Boolean(stopped) && globalIndex === turns.length - 1}
            />
          ) : null}
        </section>
        );
      })}

      {awaitingFirstToken ? <AgentWorking /> : null}
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
 * The user's message.
 *
 * Pasted logs and long prompts used to push the whole turn off screen, so the
 * bubble now clamps to about eight lines; the footer says how much is hidden
 * and one click opens it. (`whitespace-pre-wrap` also keeps the line breaks
 * the user typed — they used to collapse into a single paragraph.)
 */
function PromptBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n").length;
  const long = lines > 8 || text.length > 520;

  return (
    <div className="relative max-w-[520px] overflow-hidden rounded-card bg-field px-3.5 py-2 text-ui-base leading-5 text-ink shadow-hairline">
      <div className={cn("whitespace-pre-wrap break-words", !expanded && long && "max-h-[152px] overflow-hidden")}>
        {text}
      </div>

      {long ? (
        <>
          {!expanded ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-field to-transparent"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={cn(
              "pressable relative mt-1 flex w-full items-center justify-center gap-1 rounded-chip py-0.5 text-ui-sm text-ink-3 hover:text-ink",
              !expanded && "absolute inset-x-0 bottom-0 pt-3",
            )}
          >
            {expanded ? t("Show less") : tf("Show the full message ({count} lines)", { count: lines })}
          </button>
        </>
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
    <div className="group/footer flex items-center gap-2 pt-0.5 text-ui-sm text-ink-3">
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
        <span className="font-mono tabular-nums">
          {long ? "· " : ""}
          {turn.usage.total >= 1000 ? `${(turn.usage.total / 1000).toFixed(1)}k` : turn.usage.total} tokens
          {turn.usage.cacheRead
            ? ` (${Math.round(cacheHitRate(turn.usage) * 100)}% ${t("cached")})`
            : ""}
        </span>
      ) : null}
      <span className="flex-1" />
      {/* persistent, mute actions — Cursor keeps them visible on every turn
          rather than hiding them behind hover */}
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
 * The settled run, folded into one row.
 *
 * The collapsed row tallies the work by kind — reads, searches, terminals,
 * edits, thinking beats — ZCode's own buckets, which keep a terminal and an
 * edit distinct even when one turn fires several. Expanding lays the segment
 * back out in production order with every beat and every call as its own row:
 * nothing merges on the way out, each row opens its own detail on click.
 */
const TurnRunSummary = memo(function TurnRunSummary({ turn }: { turn: TurnView }) {
  const [open, setOpen] = useState(false);
  useLocale();
  const work = turn.items.filter((item) => item.kind !== "text");
  const runs = work.flatMap((item) => (item.kind === "tools" ? item.runs : []));
  const tally = summarizeWork(runs);
  const thinking = work.filter((item) => item.kind === "thinking").length;

  const parts: string[] = [];
  if (tally.reads) parts.push(tf("{count} reads", { count: tally.reads }));
  if (tally.searches) parts.push(tf("{count} searches", { count: tally.searches }));
  if (tally.edits) parts.push(tf("{count} edits", { count: tally.edits }));
  if (tally.commands) parts.push(tf("{count} terminals", { count: tally.commands }));
  if (thinking) parts.push(tf("{count} thinking", { count: thinking }));

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
      className="pressable -mx-1.5 flex w-fit items-center gap-1.5 rounded-chip px-1.5 py-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
      style={{ animation: "pop-in 260ms var(--ease-out-strong-css) both" }}
    >
      <CheckIcon size={11} className="shrink-0 text-ink-3" />
      <span className="font-medium text-ink-2">{t("Ran")}</span>
      {parts.length ? <span className="truncate">{parts.join(" · ")}</span> : null}
      <span className="shrink-0 font-mono text-ui-xs tabular-nums">{tally.calls}</span>
      <ChevronDownIcon size={11} className="shrink-0" />
    </button>
  );
});
