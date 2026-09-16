import { useMemo, useState } from "react";
import type { ChatMessage } from "@shared/types";
import Flowchart, { type StepNode } from "../beautiful/primitives/Flowchart";
import { buildToolGroups, buildTurns, toolSignature } from "../../lib/agent-view";
import { cn } from "../../lib/cn";

const ACCENT = "var(--accent)";
const GREEN = "#1f8a5f";
const ORANGE = "#c2701c";

/** `13 tool calls, 4 files` — the one line that describes a turn's work. */
function summarize(turn: ReturnType<typeof buildTurns>[number]): string {
  const groups = buildToolGroups(turn);
  const calls = turn.toolRuns.length;
  const files = new Set(turn.toolRuns.map((run) => run.path).filter(Boolean)).size;
  const edits = groups.filter((group) => group.bucket === "edit").reduce((sum, group) => sum + group.runs.length, 0);
  if (!calls) return turn.fullText.trim() ? "answered" : "no work recorded";
  const parts = [`${calls} call${calls === 1 ? "" : "s"}`];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (edits) parts.push(`${edits} edit${edits === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Canvas.
 *
 * The session as a graph on a dotted canvas: one card per turn, joined top to
 * bottom, so the shape of the conversation is visible at a glance instead of
 * being a scroll. Picking a card opens its detail underneath — the tools it ran
 * and the files it touched.
 *
 * This is `Flowchart` doing the drawing. It was vendored for the extension-flow
 * demo and the canvas it renders (dotted grid, measured connectors, draggable
 * cards) is exactly what a session map needs, so it is fed real turns rather
 * than a second, parallel implementation being written.
 */
export function CanvasPanel({
  messages,
  onJumpToTurn,
}: {
  messages: ChatMessage[];
  onJumpToTurn: (key: string) => void;
}) {
  const turns = useMemo(() => buildTurns(messages, []), [messages]);
  const [picked, setPicked] = useState<string | null>(null);

  // the graph only redraws when the work changed; the Flowchart re-measures
  // every card, so a streaming answer rebuilding it was the dock's worst cost
  const signature = toolSignature(turns);
  const steps = useMemo<StepNode[]>(() => {
    if (!turns.length) return [];
    // the canvas is narrow, so the graph shows the last turns, not all of them
    return turns.slice(-12).map((turn, index, list) => ({
      id: turn.key,
      row: index,
      x: 0.5,
      w: 272,
      kind: {
        label: `${turns.length - list.length + index + 1}`,
        hue: turn.toolRuns.some((run) => run.icon === "write") ? GREEN : ACCENT,
      },
      hue: turn.toolRuns.some((run) => run.icon === "write") ? GREEN : ACCENT,
      title: (turn.prompt ?? "New session").replace(/\s+/g, " ").slice(0, 60),
      caption: summarize(turn),
    }));
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = useMemo(() => turns.find((turn) => turn.key === picked) ?? null, [signature, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!turns.length) {
    return (
      <div className="flex flex-col gap-1 px-3 py-6 text-[11.5px] text-ink-3">
        <span>Nothing to draw yet.</span>
        <span className="text-[11px]">A session becomes a graph here as the agent works.</span>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
      <Flowchart steps={steps} onSelect={setPicked} />

      {active ? (
        <div className="mt-2.5 flex flex-col gap-1.5" style={{ animation: "fade-up 260ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <button
            type="button"
            onClick={() => onJumpToTurn(active.key)}
            className="pressable flex items-baseline gap-2 rounded-[7px] px-1.5 py-1 text-left hover:bg-hover"
          >
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">{active.prompt ?? "New session"}</span>
            <span className="shrink-0 text-[10.5px] text-ink-3">jump →</span>
          </button>

          {buildToolGroups(active).map((group) => (
            <div key={group.key} className="flex items-center gap-2 rounded-[7px] bg-surface px-2 py-1.5 shadow-hairline">
              <span className={cn("size-1.5 shrink-0 rounded-full", group.running ? "bg-accent" : "bg-line-strong")} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{group.label}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                {group.add ? <span className="text-green">+{group.add}</span> : null}
                {group.del ? <span className="text-red"> −{group.del}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-1.5 pt-2 text-[11px] text-ink-3">Pick a card for its tools and files.</div>
      )}
    </div>
  );
}
