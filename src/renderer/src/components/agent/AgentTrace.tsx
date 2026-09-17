import { useState } from "react";
import { ChevronDownIcon } from "../icons";
import { formatDuration } from "../../lib/format";
import { cn } from "../../lib/cn";

/**
 * One reasoning beat of the turn.
 *
 * Cursor treats thinking as a whisper, not a speech: a single muted line —
 * "Thinking…" while it streams, "Thought briefly" once it settles — and the
 * reasoning itself only appears when the row is opened. The old renderer
 * expanded every paragraph live, which poured a wall of scratch text into
 * the transcript.
 */
export function AgentTrace({
  text,
  working,
  durationMs,
}: {
  text: string;
  /** true only for the beat the agent is currently producing */
  working: boolean;
  /** how long this beat took, once it has settled */
  durationMs?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;

  /* Cursor says "Thought 20s", Zed says "Thought for 20s" — a sub-second
   * beat is not worth a number */
  const settled =
    durationMs && durationMs >= 2000 ? `Thought for ${formatDuration(durationMs)}` : "Thought briefly";

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="-mx-1 flex w-fit items-center gap-1.5 rounded-[6px] px-1 py-0.5 transition-colors duration-100 hover:bg-hover-2"
      >
        {working ? (
          <span className="shimmer-text text-[12px] italic">Thinking</span>
        ) : (
          <span className="text-[12px] italic text-ink-3">{settled}</span>
        )}
        <ChevronDownIcon
          size={11}
          className={cn("text-ink-3 transition-transform duration-200", expanded ? "rotate-180" : "rotate-0")}
        />
      </button>

      <div className="collapse-grid" data-open={expanded}>
        <div className="min-h-0 overflow-hidden">
          <div className="scrollbar-thin mt-0.5 max-h-[260px] overflow-y-auto pl-1">
            <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-3">{text}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
