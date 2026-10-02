import { memo, useState } from "react";
import { ChevronDownIcon, SparkIcon } from "../icons";
import { StreamText } from "../motion";
import { Markdown } from "../Markdown";
import { formatDuration } from "../../lib/format";
import { cn } from "../../lib/cn";
import { t, tf, useLocale } from "../../lib/i18n";

/**
 * One reasoning beat, rendered like the registry's ThinkingState:
 *
 *   · a sparkle, a label that shimmers while the model is producing it, and a
 *     chevron — "Thinking" → "Thought for 12s"
 *   · the reasoning as prose behind a trace line, typed in while live
 *   · open while the beat is live, collapsed to the single line once it
 *     settles, reopenable at any time
 *
 * The body goes through the same Markdown pipeline at the same metrics as the
 * answer's prose — the reasoning and the reply are one voice, so a list or a
 * bold span in the trace cannot arrive looking like something else. The live
 * beat streams through the backlog-aware reveal the answer streams through,
 * which also makes the handoff when the beat settles a non-event.
 *
 * The earlier version defaulted to collapsed and revealed nothing while the
 * model worked, which read as a stuck spinner.
 */
export const AgentTrace = memo(function AgentTrace({
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
  useLocale();
  if (!text.trim()) return null;

  const expanded = manual ?? working;

  const settled =
    durationMs && durationMs >= 2000
      ? tf("Thought for {duration}", { duration: formatDuration(durationMs) })
      : t("Thought briefly");

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual((current) => !(current ?? working))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-chip px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <SparkIcon
          size={13}
          className={cn("shrink-0 transition-colors duration-200", working ? "text-ink-2" : "text-ink-3")}
        />
        {working ? (
          <span className="shimmer-text text-ui-base font-medium whitespace-nowrap">{t("Thinking")}</span>
        ) : (
          <span
            className="text-ui-base font-medium whitespace-nowrap text-ink-2"
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
          <div
            className="relative mt-0.5 ml-[6px] border-l border-line py-1 pl-3.5"
            style={{ animation: "fade-up 300ms var(--ease-out-strong-css) both" }}
          >
            {working ? <StreamText markdown text={text} done={false} caret={false} /> : <Markdown>{text}</Markdown>}
          </div>
        </div>
      </div>
    </div>
  );
});
