import type { QueueState } from "@shared/types";
import { cn } from "../../lib/cn";
import { Collapse, GlideList, SlidingGroup } from "../motion";
import { ArrowUpIcon, ClockIcon, XIcon } from "../icons";

export type QueueBehavior = "steer" | "followUp";
export type QueueMode = "all" | "one-at-a-time";

const MODES: Array<{ key: QueueMode; label: string; title: string }> = [
  { key: "one-at-a-time", label: "one at a time", title: "Hand pi one queued message at a time" },
  { key: "all", label: "all at once", title: "Hand pi every queued message together" },
];

/**
 * The message queue.
 *
 * pi holds messages sent while the agent is running, and it distinguishes two
 * kinds: **steering**, delivered at the next turn boundary, and **follow-up**,
 * delivered only once the agent stops. That difference decides whether you are
 * correcting the current run or adding to the next one, so both are shown
 * separately and the send behaviour is a visible choice rather than a setting
 * buried in a config file.
 *
 * Each section also carries pi's own delivery mode for that kind. It was
 * previously printed as read-only text; it is a real session setting
 * (`setSteeringMode` / `setFollowUpMode`), so it is a control here.
 *
 * The card is the width of the prompt bar below it, so the two read as one
 * stack: queue first, then the editor.
 *
 * Clearing hands the text back to the composer, which is what pi's own Esc does.
 */
export function QueueBar({
  queue,
  behavior,
  onBehavior,
  onMode,
  onRemove,
  onClear,
}: {
  queue: QueueState;
  behavior: QueueBehavior;
  onBehavior: (behavior: QueueBehavior) => void;
  onMode: (kind: "steering" | "followUp", mode: QueueMode) => void;
  onRemove: (kind: "steering" | "followUp", index: number) => void;
  onClear: () => void;
}) {
  const total = queue.steering.length + queue.followUp.length;

  return (
    <Collapse open={total > 0}>
      <div className="mx-auto mb-2 w-full max-w-[720px]">
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface px-3 py-2.5 shadow-card">
          <div className="flex items-center gap-2">
            <ClockIcon size={12} className="shrink-0 text-ink-3" />
            <span className="text-[11.5px] font-medium text-ink">
              {total} message{total === 1 ? "" : "s"} queued
            </span>
            <span className="flex-1" />
            <span className="hidden text-[10.5px] text-ink-3 sm:inline">next message will</span>
            <SlidingGroup
              activeIndex={behavior === "steer" ? 0 : 1}
              className="flex items-center gap-0.5 rounded-chip bg-field p-[3px]"
              pillClassName="bg-surface shadow-hairline"
            >
              {(
                [
                  { key: "steer", label: "Interrupt", title: "Delivered at the next turn boundary" },
                  { key: "followUp", label: "Wait", title: "Delivered once the agent stops" },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.key}
                  data-slide-item
                  type="button"
                  title={entry.title}
                  onClick={() => onBehavior(entry.key)}
                  className={cn(
                    "pressable relative z-10 h-5 rounded-[4px] px-2 text-[10.5px]",
                    behavior === entry.key ? "text-ink" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </SlidingGroup>
            <button
              type="button"
              onClick={onClear}
              title="Clear the queue and put the text back in the editor"
              className="pressable shrink-0 rounded-chip px-1.5 py-0.5 text-[10.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              Clear
            </button>
          </div>

          {queue.steering.length ? (
            <Section
              kind="steering"
              label="Interrupt"
              hint="delivered at the next turn boundary"
              mode={queue.steeringMode}
              onMode={onMode}
              tone="accent"
            >
              {queue.steering.map((text, index) => (
                <Chip key={`s-${index}`} text={text} tone="accent" onRemove={() => onRemove("steering", index)} />
              ))}
            </Section>
          ) : null}

          {queue.followUp.length ? (
            <Section
              kind="followUp"
              label="After the run"
              hint="delivered once the agent stops"
              mode={queue.followUpMode}
              onMode={onMode}
              tone="neutral"
            >
              {queue.followUp.map((text, index) => (
                <Chip key={`f-${index}`} text={text} tone="neutral" onRemove={() => onRemove("followUp", index)} />
              ))}
            </Section>
          ) : null}
        </div>
      </div>
    </Collapse>
  );
}

function Section({
  kind,
  label,
  hint,
  mode,
  onMode,
  tone,
  children,
}: {
  kind: "steering" | "followUp";
  label: string;
  hint: string;
  mode: QueueMode;
  onMode: (kind: "steering" | "followUp", mode: QueueMode) => void;
  tone: "accent" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2">
      <div className="flex items-center gap-2 px-0.5">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "accent" ? "bg-accent" : "bg-line-strong",
          )}
        />
        <span className="shrink-0 text-[11.5px] font-medium text-ink-2">{label}</span>
        <span className="hidden min-w-0 truncate text-[10.5px] text-ink-3 md:inline">{hint}</span>
        <span className="flex-1" />
        <SlidingGroup
          activeIndex={mode === "all" ? 1 : 0}
          className="flex items-center gap-0.5 rounded-chip bg-field p-[3px]"
          pillClassName="bg-surface shadow-hairline"
        >
          {MODES.map((entry) => (
            <button
              key={entry.key}
              data-slide-item
              type="button"
              title={entry.title}
              onClick={() => onMode(kind, entry.key)}
              className={cn(
                "pressable relative z-10 h-[18px] rounded-[4px] px-1.5 text-[10px]",
                mode === entry.key ? "text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {entry.label}
            </button>
          ))}
        </SlidingGroup>
      </div>
      <GlideList className="flex flex-col gap-px">{children}</GlideList>
    </div>
  );
}

function Chip({
  text,
  tone,
  onRemove,
}: {
  text: string;
  tone: "accent" | "neutral";
  onRemove: () => void;
}) {
  return (
    <div
      data-row
      className={cn(
        "glide-row pressable flex items-center gap-2 rounded-[7px] px-2 py-1.5",
        tone === "accent" ? "bg-accent-tint" : "bg-inset",
      )}
      style={{ animation: "pop-in 220ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <span className={cn("shrink-0", tone === "accent" ? "text-accent-ink" : "text-ink-3")}>
        <ArrowUpIcon size={10} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11.5px]",
          tone === "accent" ? "text-accent-ink" : "text-ink-2",
        )}
      >
        {text}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from queue"
        className="pressable flex size-4 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-hover hover:text-ink"
      >
        <XIcon size={10} />
      </button>
    </div>
  );
}
