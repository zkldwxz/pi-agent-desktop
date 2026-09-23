import { useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@shared/types";
import { buildTurns } from "../../lib/agent-view";
import { asProse } from "../../lib/format";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

/** the pointer has to mean it — crossing the strip on the way to the window edge should not flash a card */
const HOVER_DELAY = 90;

/** the dash is short; the row it lives in is the target */
function tickWidth(prompt: string): number {
  return 6 + Math.min(9, Math.round(prompt.trim().length / 24));
}

/**
 * The conversation's minimap.
 *
 * One tick per turn down the right edge of the transcript, so a long session has
 * a shape you can aim at. Hovering a tick floats out what was asked and what
 * came back; clicking jumps the transcript to that turn.
 *
 * The rows share the column's height evenly rather than sitting at fixed
 * intervals: five turns spread out, sixty turns compress, and the strip never
 * needs a scrollbar of its own.
 */
export function SessionStrip({
  messages,
  onJump,
}: {
  messages: ChatMessage[];
  onJump: (key: string) => void;
}) {
  const turns = useMemo(() => buildTurns(messages, []).filter((turn) => turn.prompt), [messages]);
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef(0);

  if (turns.length < 2) return null;

  const arm = (index: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(index), HOVER_DELAY);
  };
  const disarm = () => {
    window.clearTimeout(timer.current);
    setHover(null);
  };

  return (
    <nav
      aria-label={t("Conversation map")}
      onPointerLeave={disarm}
      className="flex w-4 shrink-0 flex-col items-center justify-center overflow-hidden py-4"
    >
      {turns.map((turn, index) => {
        const query = (turn.prompt ?? "").trim();
        const reply = asProse(turn.fullText);
        /* a card above the top tick or below the bottom one would leave the
         * window, so the column flips at its own midpoint */
        const above = index > turns.length / 2;
        return (
          <div
            key={turn.key}
            className="relative flex min-h-[7px] w-full flex-1 basis-0 items-center justify-center max-h-[18px]"
          >
            <button
              type="button"
              aria-label={query.slice(0, 60)}
              onPointerEnter={() => arm(index)}
              onPointerLeave={() => window.clearTimeout(timer.current)}
              onFocus={() => setHover(index)}
              onBlur={disarm}
              onClick={() => onJump(turn.key)}
              className="group flex h-full w-full items-center justify-center"
            >
              <span
                className={cn(
                  "h-[2.5px] rounded-full transition-[width,background-color] duration-150",
                  turn.streaming ? "bg-accent" : hover === index ? "bg-accent" : "bg-line-strong group-hover:bg-ink-3",
                )}
                style={{ width: tickWidth(query) }}
              />
            </button>
            {hover === index ? (
              <div
                className={cn(
                  "pointer-events-none absolute right-full z-30 w-64 rounded-card border border-line bg-surface px-2.5 py-2 shadow-overlay",
                  above ? "bottom-0" : "top-0",
                )}
                style={{ animation: "fade-in 140ms ease-out both" }}
              >
                <p className="line-clamp-3 break-words text-[12px] font-medium leading-snug text-ink">{query}</p>
                {reply ? (
                  <p className="mt-1 line-clamp-3 break-words text-[11.5px] leading-snug text-ink-3">{reply}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
