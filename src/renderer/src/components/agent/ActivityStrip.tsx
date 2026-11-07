import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import { ChevronRightIcon } from "../icons";

export interface RunningTask {
  id: string;
  /** the shell command, or the tool's name when it has none */
  command: string;
  startedAt: number;
}

/**
 * The commands running now, over the composer — baocode's activity strip
 * (lib/chat/panels/activity_strip.dart:131-521), in place of a terminal chip:
 *   10px in from the composer's edges, the composer's fill and 1px line,
 *   radius 10, 3px top and bottom; rows 28 high, 3px in, 7 inside, radius 5,
 *   the bubble hover when they open something. A row: the terminal glyph 14
 *   faint, 8, the command at 11.5 in mono, 8, "Running · 12s" muted, 8, a stop
 *   14 faint. Four or more fold under a header; at most four rows show
 *   (112px), the rest scroll.
 *
 * pi stops a run, not one command, so the stop says so.
 */
export function ActivityStrip({
  tasks,
  onOpen,
  onStop,
}: {
  tasks: RunningTask[];
  onOpen?: () => void;
  onStop?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [folded, setFolded] = useState(true);
  useEffect(() => {
    if (!tasks.length) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tasks.length]);

  if (!tasks.length) return null;
  const foldable = tasks.length >= 4;
  const shown = foldable && folded ? [] : tasks;

  return (
    <div className="mx-2.5 mb-2 rounded-[10px] border border-line-strong bg-field py-[3px]">
      {foldable ? (
        <button
          type="button"
          onClick={() => setFolded((value) => !value)}
          className="mx-[3px] flex h-7 w-[calc(100%-6px)] items-center gap-1 rounded-[5px] px-[7px] text-left text-ui-meta text-ink transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]"
        >
          <ChevronRightIcon
            size={16}
            className="shrink-0 text-ink-2 transition-transform duration-150"
            style={{ transform: folded ? undefined : "rotate(90deg)" }}
          />
          {tf("{count} commands running", { count: tasks.length })}
        </button>
      ) : null}
      <div className="scrollbar-thin max-h-[112px] overflow-y-auto">
        {shown.map((task) => {
          const seconds = Math.max(0, Math.round((now - task.startedAt) / 1000));
          return (
            <div
              key={task.id}
              role={onOpen ? "button" : undefined}
              tabIndex={onOpen ? 0 : undefined}
              onClick={onOpen}
              onKeyDown={(event) => {
                if (onOpen && (event.key === "Enter" || event.key === " ")) onOpen();
              }}
              title={task.command}
              className={cn(
                "mx-[3px] flex h-7 items-center gap-2 rounded-[5px] px-[7px]",
                onOpen && "cursor-pointer transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]",
              )}
            >
              <span className="codicon codicon-terminal shrink-0 text-[14px] text-ink-4" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-ink">{task.command}</span>
              <span className="shrink-0 text-ui-sm text-ink-2 tabular-nums">
                {t("Running")} · {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
              </span>
              {onStop ? (
                <button
                  type="button"
                  title={t("Stop the run")}
                  aria-label={t("Stop the run")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStop();
                  }}
                  className="flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-ink-4 transition-colors duration-100 hover:bg-hover hover:text-ink"
                >
                  <span className="size-[8px] rounded-[1.5px] bg-current" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
