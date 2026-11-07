import { memo, useState } from "react";
import { ChevronRightIcon } from "../icons";
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

  /* thinking_section.dart: "Thought 2s", or "Thought briefly" */
  const settled =
    durationMs && durationMs >= 1000
      ? tf("Thought {duration}", { duration: formatDuration(durationMs) })
      : t("Thought briefly");

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual((current) => !(current ?? working))}
        /* step_header.dart: 13px, vertical padding 3, no icon; the chevron
           (16) after the text, shown while hovered or open, a quarter turn
           when open */
        className="group/step flex w-fit items-center gap-0.5 py-[3px]"
      >
        {working ? (
          <span className="shimmer-text text-ui-step whitespace-nowrap">{t("Thinking")}</span>
        ) : (
          <span className="text-ui-step whitespace-nowrap text-ink-2" style={{ animation: "fade-in 300ms ease-out both" }}>
            {settled}
          </span>
        )}
        <ChevronRightIcon
          size={16}
          className={cn(
            "shrink-0 text-ink-2 transition-[transform,opacity] duration-150 group-hover/step:text-ink",
            expanded ? "rotate-90 opacity-100" : "opacity-0 group-hover/step:opacity-100",
          )}
        />
      </button>

      {/* the trace — open while the beat is live, one click away afterwards */}
      <div className="collapse-grid" data-open={expanded}>
        <div className="min-h-0 overflow-hidden">
          <div
            className="mt-1.5 mb-0.5 text-ui-step leading-[1.6] text-ink-2"
            style={{ animation: "fade-up 300ms var(--ease-out-strong-css) both" }}
          >
            {working ? <StreamText markdown text={text} done={false} caret={false} /> : <Markdown>{text}</Markdown>}
          </div>
        </div>
      </div>
    </div>
  );
});
