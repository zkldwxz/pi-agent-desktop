import { useMemo } from "react";
import type { ChatMessage } from "@shared/types";
import { buildTurns } from "../../lib/agent-view";
import { cn } from "../../lib/cn";
import { CheckIcon, ClockIcon, LoaderIcon, XIcon } from "../icons";

/**
 * Session outline.
 *
 * The session file is a tree of turns; this is the flat reading of it — every
 * prompt with the work it produced, so a long run stays navigable. Clicking a
 * row scrolls the transcript to that turn.
 *
 * Note: this is an outline of *what happened*. If "Plans" should instead mean
 * authored plan documents (a planning skill writing files under `.pi/plans/`),
 * that is a different panel and a small change to swap in.
 */
export function SessionOutline({
  messages,
  activeKey,
  onJump,
}: {
  messages: ChatMessage[];
  activeKey?: string;
  onJump: (key: string) => void;
}) {
  const turns = useMemo(() => buildTurns(messages, []), [messages]);

  if (!turns.length) {
    return (
      <div className="px-3 py-6 text-[11.5px] text-ink-3">
        No turns yet. Each prompt and the work it produced will be listed here.
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <div className="flex flex-col gap-px">
        {turns.map((turn, index) => {
          const active = turn.key === activeKey;
          const tools = turn.toolRuns.length;
          const failed = turn.toolRuns.some((run) => run.status === "error");
          const running = turn.streaming;
          return (
            <button
              key={turn.key}
              type="button"
              onClick={() => onJump(turn.key)}
              style={{ animation: `row-enter 380ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 4) * 35}ms both` }}
              className={cn(
                "pressable flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left",
                active ? "bg-surface shadow-hairline" : "hover:bg-hover",
              )}
            >
              <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] text-ink-3 tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[12px]", active ? "font-medium text-ink" : "text-ink-2")}>
                  {turn.prompt || turn.lead.split("\n")[0] || "Session start"}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
                  {running ? (
                    <>
                      <LoaderIcon size={9} className="spin-fast text-accent" />
                      running
                    </>
                  ) : failed ? (
                    <>
                      <XIcon size={9} className="text-red" />
                      failed
                    </>
                  ) : (
                    <>
                      <CheckIcon size={9} />
                      {tools ? `${tools} tool${tools === 1 ? "" : "s"}` : "answer"}
                    </>
                  )}
                  <ClockIcon size={9} />
                  {new Date(turn.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
