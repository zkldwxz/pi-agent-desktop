import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, ToolActivity } from "@shared/types";
import { buildTurns, type TurnView } from "../lib/agent-view";
import { formatDuration } from "../lib/format";
import { stagger } from "./motion";
import { AgentAnswer } from "./agent/AgentAnswer";
import { AgentToolRun } from "./agent/AgentToolRun";
import { AgentTrace } from "./agent/AgentTrace";
import { AgentWorking } from "./agent/AgentWorking";
import { CheckIcon } from "./icons";

/** stable empty array — a fresh one would defeat the buildTurns cache key */
const NO_LIVE_TOOLS: ToolActivity[] = [];

/* transcript mounts newest-first, then batches of this size per frame */
const FIRST_BATCH = 8;
const BATCH = 12;

/**
 * What the agent is doing right now, in words.
 *
 * The transcript's live pieces mostly signal themselves — a streaming answer
 * has its caret, an open trace shimmers, a running tool group spins. What none
 * of them covers is the gap *between* beats: the result is in, the model has
 * not spoken yet. This line exists for that gap, and names the running tool
 * when there is one.
 */
function statusLabel(turn: TurnView): string | null {
  const last = turn.items.at(-1);
  if (!last) return null; // the loader below the thread owns the pre-first-token beat
  if (last.kind === "text" || last.kind === "thinking") return null; // caret / shimmer carry it
  const running = [...last.runs].reverse().find((run) => run.status === "running");
  if (running) return `${running.label} ${running.chip}`.trim();
  return "Thinking";
}

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
  sessionKey,
  onFork,
}: {
  messages: ChatMessage[];
  tools: ToolActivity[];
  streaming: boolean;
  /** which session this transcript is — switching it restarts incremental reveal */
  sessionKey: string;
  /** branch the session from a turn's prompt */
  onFork?: (userIndex: number) => void;
}) {
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
          className="text-[22px] font-semibold tracking-[-0.03em] text-ink"
          style={{ animation: "fade-up 460ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          What should Pi do next?
        </div>
        <p
          className="max-w-md text-[13px] text-ink-3"
          style={{ animation: "fade-up 460ms cubic-bezier(0.23,1,0.32,1) 80ms both" }}
        >
          This window talks to the Pi agent already installed on this machine. Sessions, models, and credentials stay in
          ~/.pi/agent.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">

      {hiddenCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount(turns.length)}
          className="pressable mx-auto flex items-center gap-1.5 rounded-chip bg-surface px-2.5 py-1 text-[11px] text-ink-3 shadow-hairline hover:text-ink"
        >
          Show {hiddenCount} earlier turn{hiddenCount === 1 ? "" : "s"}
        </button>
      ) : null}
      {shown.map((turn, index) => {
        const globalIndex = index + hiddenCount;
        return (
        <section
          key={turn.key}
          data-turn={turn.key}
          className="group/turn flex scroll-mt-4 flex-col gap-3"
          style={globalIndex >= turns.length - 3 ? stagger(0) : undefined}
        >
          {turn.prompt ? (
            <div className="flex justify-end">
              <div className="max-w-[500px] rounded-[10px] bg-field px-3.5 py-2 text-[13px] leading-5 text-ink">
                {turn.prompt}
              </div>
            </div>
          ) : null}

          {turn.notes.map((note, noteIndex) => (
            <div
              key={noteIndex}
              className="flex items-center gap-2 rounded-[10px] bg-inset px-3 py-2 text-[12px] text-ink-2"
              style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}
            >
              <span className="inline-flex h-4 items-center rounded-chip bg-field px-1.5 font-mono text-[10px] text-ink-3">
                {note.tone === "compaction" ? "compacted" : "branch"}
              </span>
              <span className="truncate">{note.text || "Context compacted"}</span>
            </div>
          ))}

          <TurnItems turn={turn} onFork={onFork} />

          {/* the persistent status line: names the beat the transcript itself
              cannot — a tool still running, or the model composing its next
              move after one */}
          {turn.streaming && statusLabel(turn) ? <AgentWorking label={statusLabel(turn)!} /> : null}

          {/* the Cursor/Codex completion line: how long the whole turn ran,
              plus what it cost, settled next to the fork affordance */}
          {!turn.streaming && turn.endedAt > turn.timestamp + 5000 ? (
            <div className="flex items-center gap-2 pt-0.5 text-[11px] text-ink-3">
              <CheckIcon size={11} className="text-green" />
              <span>Worked for {formatDuration(turn.endedAt - turn.timestamp)}</span>
              {turn.usage && turn.usage.total > 0 ? (
                <span className="font-mono tabular-nums">
                  · {turn.usage.total >= 1000 ? `${(turn.usage.total / 1000).toFixed(1)}k` : turn.usage.total} tokens
                  {turn.usage.cacheRead
                    ? ` (${Math.round((turn.usage.cacheRead / turn.usage.total) * 100)}% cached)`
                    : ""}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
        );
      })}

      {awaitingFirstToken ? <AgentWorking /> : null}
    </div>
  );
}

/**
 * The beats of one turn, in production order.
 *
 * The most recent reasoning beat stays open and shimmering for as long as the
 * turn is running — even when prose or tool rows follow it — and every beat
 * keeps its own trace, so a run that thinks before each tool call shows one
 * per call instead of a single frozen block at the top.
 */
function TurnItems({
  turn,
  onFork,
}: {
  turn: TurnView;
  onFork?: (userIndex: number) => void;
}) {
  let lastThinking = -1;
  for (let i = turn.items.length - 1; i >= 0; i -= 1) {
    if (turn.items[i].kind === "thinking") {
      lastThinking = i;
      break;
    }
  }

  return turn.items.map((item, itemIndex) => {
    const isLast = itemIndex === turn.items.length - 1;
    if (item.kind === "thinking") {
      return <AgentTrace key={item.key} text={item.text} working={turn.streaming && itemIndex === lastThinking} />;
    }
    if (item.kind === "tools") {
      return <AgentToolRun key={item.key} runs={item.runs} />;
    }
    return (
      <AgentAnswer
        key={item.key}
        turn={turn}
        item={item}
        isLast={isLast}
        streaming={turn.streaming && isLast}
        onFork={onFork}
      />
    );
  });
}
