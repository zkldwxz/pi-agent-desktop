import { useState } from "react";
import { ChevronDownIcon, SparkIcon } from "../icons";
import { formatDuration } from "../../lib/format";
import { cn } from "../../lib/cn";

/**
 * One reasoning beat, rendered like the registry's ThinkingState:
 *
 *   · a sparkle, a label that shimmers while the model is producing it, and a
 *     chevron — "Thinking" → "Thought for 12s"
 *   · the reasoning paragraphs as soft rows behind a trace line, revealed with
 *     a short cascade
 *   · open while the beat is live, collapsed to the single line once it
 *     settles, reopenable at any time
 *
 * The earlier version defaulted to collapsed and revealed nothing while the
 * model worked, which read as a stuck spinner.
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
  const [manual, setManual] = useState<boolean | null>(null);
  const rows = text
    .split(/\n{2,}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!rows.length) return null;

  const expanded = manual ?? working;

  const settled =
    durationMs && durationMs >= 2000 ? `Thought for ${formatDuration(durationMs)}` : "Thought briefly";

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual((current) => !(current ?? working))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-[6px] px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <SparkIcon
          size={13}
          className={cn("shrink-0 transition-colors duration-200", working ? "text-ink-2" : "text-ink-3")}
        />
        {working ? (
          <span className="shimmer-text text-[13px] font-medium whitespace-nowrap">Thinking</span>
        ) : (
          <span
            className="text-[13px] font-medium whitespace-nowrap text-ink-2"
            style={{ animation: "fade-in 300ms ease-out both" }}
          >
            {settled}
          </span>
        )}
        <ChevronDownIcon
          size={12}
          className={cn("shrink-0 text-ink-3 transition-transform duration-200", expanded ? "rotate-180" : "rotate-0")}
        />
      </button>

      {/* the trace — open while the beat is live, one click away afterwards */}
      <div className="collapse-grid" data-open={expanded}>
        <div className="min-h-0 overflow-hidden">
          <div className="relative mt-0.5 ml-[6px] border-l border-line pl-3.5">
            <div className="flex flex-col gap-1 py-1">
              {rows.map((row, index) => (
                <div
                  key={index}
                  className="flex min-h-6 items-start gap-2"
                  style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 5) * 110}ms both` }}
                >
                  <span className="text-[12.5px] leading-relaxed text-ink-2">{row}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
