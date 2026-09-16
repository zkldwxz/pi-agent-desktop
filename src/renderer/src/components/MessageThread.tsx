import { useMemo } from "react";
import type { ChatMessage, ToolActivity } from "@shared/types";
import { buildTurns, type TurnView } from "../lib/agent-view";
import { stagger } from "./motion";
import { AgentAnswer } from "./agent/AgentAnswer";
import { AgentToolRun } from "./agent/AgentToolRun";
import { AgentTrace } from "./agent/AgentTrace";
import { AgentWorking } from "./agent/AgentWorking";

/** stable empty array — a fresh one would defeat the buildTurns cache key */
const NO_LIVE_TOOLS: ToolActivity[] = [];

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
  onFork,
}: {
  messages: ChatMessage[];
  tools: ToolActivity[];
  streaming: boolean;
  /** branch the session from a turn's prompt */
  onFork?: (userIndex: number) => void;
}) {
  const turns = useMemo(
    () => buildTurns(messages, streaming ? tools : NO_LIVE_TOOLS),
    [messages, tools, streaming],
  );

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
      {turns.map((turn, index) => (
        <section
          key={turn.key}
          data-turn={turn.key}
          className="group/turn flex scroll-mt-4 flex-col gap-3"
          style={index >= turns.length - 3 ? stagger(0) : undefined}
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

          {turn.items.map((item, itemIndex) => {
            const isLast = itemIndex === turn.items.length - 1;
            if (item.kind === "thinking") {
              return <AgentTrace key={item.key} text={item.text} working={turn.streaming && isLast} />;
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
          })}

          {/* the persistent status line: names the beat the transcript itself
              cannot — a tool still running, or the model composing its next
              move after one */}
          {turn.streaming && statusLabel(turn) ? <AgentWorking label={statusLabel(turn)!} /> : null}
        </section>
      ))}

      {awaitingFirstToken ? <AgentWorking /> : null}
    </div>
  );
}
