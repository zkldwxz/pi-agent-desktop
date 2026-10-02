import { useEffect, useState } from "react";
import type { QueueState } from "@shared/types";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import { Collapse, GlideList } from "../motion";
import { ArrowUpIcon, ChevronDownIcon, ClockIcon, PencilIcon, XIcon } from "../icons";

export type QueueBehavior = "steer" | "followUp";
export type QueueMode = "all" | "one-at-a-time";

/** How many queued messages a section lists before folding the rest behind a
 *  count. The card sits directly above the composer, so an unbounded list would
 *  push the editor down the window. */
const SHOWN = 3;

/**
 * The message queue, stripped to the minimum.
 *
 * pi holds messages sent while the agent is running in two queues — steering
 * and follow-up — and which one a send lands in is a *setting* now (智能体 ·
 * 消息发送), not a switch on this card. What remains per message is exactly
 * three actions: load it back into the editor, fire it immediately, or drop
 * it. The kind labels stay tiny; everything else went away.
 *
 * Clearing hands the text back to the composer, which is what pi's own Esc does.
 */
export function QueueBar({
  queue,
  onRemove,
  onClear,
  onEdit,
  onSendNow,
}: {
  queue: QueueState;
  onRemove: (kind: "steering" | "followUp", index: number) => void;
  onClear: () => void;
  /** load a queued message back into the composer for editing */
  onEdit: (kind: "steering" | "followUp", index: number, text: string) => void;
  /** fire one queued message right now, ahead of the rest */
  onSendNow: (kind: "steering" | "followUp", index: number, text: string) => void;
}) {
  const total = queue.steering.length + queue.followUp.length;
  const [expanded, setExpanded] = useState(false);

  /* an emptied queue is a fresh queue — the next batch must not arrive already
     unfolded from wherever the last one was left */
  useEffect(() => {
    if (!total) setExpanded(false);
  }, [total]);

  const visible = (texts: string[]) => (expanded ? texts : texts.slice(0, SHOWN));

  return (
    <Collapse open={total > 0}>
      <div className="mx-auto mb-2 w-full max-w-[720px]">
        <div className="flex flex-col gap-1 rounded-window border border-line bg-surface px-3 py-2 shadow-card">
          <div className="flex items-center gap-2 px-0.5">
            <ClockIcon size={12} className="shrink-0 text-ink-3" />
            <span className="text-ui-sm font-medium text-ink">
              {tf(total === 1 ? "{count} message queued" : "{count} messages queued", { count: total })}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClear}
              title={t("Clear the queue and put the text back in the editor")}
              className="pressable shrink-0 rounded-chip px-1.5 py-0.5 text-ui-xs text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              {t("Clear")}
            </button>
          </div>

          {queue.steering.length ? (
            <Section kind="steering" count={queue.steering.length}>
              {visible(queue.steering).map((text, index) => (
                <Chip
                  key={`s-${index}`}
                  text={text}
                  tone="accent"
                  onEdit={() => onEdit("steering", index, text)}
                  onSendNow={() => onSendNow("steering", index, text)}
                  onRemove={() => onRemove("steering", index)}
                />
              ))}
              <Rest count={queue.steering.length} shown={Math.min(queue.steering.length, SHOWN)} onExpand={() => setExpanded(true)} expanded={expanded} />
            </Section>
          ) : null}

          {queue.followUp.length ? (
            <Section kind="followUp" count={queue.followUp.length}>
              {visible(queue.followUp).map((text, index) => (
                <Chip
                  key={`f-${index}`}
                  text={text}
                  tone="neutral"
                  onEdit={() => onEdit("followUp", index, text)}
                  onSendNow={() => onSendNow("followUp", index, text)}
                  onRemove={() => onRemove("followUp", index)}
                />
              ))}
              <Rest count={queue.followUp.length} shown={Math.min(queue.followUp.length, SHOWN)} onExpand={() => setExpanded(true)} expanded={expanded} />
            </Section>
          ) : null}
        </div>
      </div>
    </Collapse>
  );
}

function Section({
  kind,
  count,
  children,
}: {
  kind: "steering" | "followUp";
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-0.5 pt-1">
        <span className={cn("size-1.5 shrink-0 rounded-full", kind === "steering" ? "bg-accent" : "bg-line-strong")} />
        <span className="shrink-0 text-ui-xs text-ink-3">{t(kind === "steering" ? "Interrupt" : "After the run")}</span>
        <span className="shrink-0 font-mono text-ui-xs tabular-nums text-ink-3">{count}</span>
      </div>
      <GlideList className="flex flex-col gap-px">{children}</GlideList>
    </div>
  );
}

/** The folded tail of a section, and the way back to it. */
function Rest({
  count,
  shown,
  expanded,
  onExpand,
}: {
  count: number;
  shown: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  if (count <= shown) return null;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="pressable flex items-center gap-1 rounded-chip px-2 py-1 text-ui-xs text-ink-3 hover:bg-hover hover:text-ink-2"
    >
      <ChevronDownIcon size={10} className={cn("shrink-0 transition-transform duration-200", expanded && "rotate-180")} />
      {tf("{count} more in this queue", { count: count - shown })}
    </button>
  );
}

function Chip({
  text,
  tone,
  onEdit,
  onSendNow,
  onRemove,
}: {
  text: string;
  tone: "accent" | "neutral";
  onEdit: () => void;
  onSendNow: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-row
      className={cn(
        "glide-row group/queued flex items-center gap-2 rounded-chip px-2 py-1.5",
        tone === "accent" ? "bg-accent-tint" : "bg-inset",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-ui-sm",
          tone === "accent" ? "text-accent-ink" : "text-ink-2",
        )}
      >
        {text}
      </span>
      {/* exactly three actions, icons only, on hover — the row itself stays text */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/queued:opacity-100">
        <IconAction label="Load into the editor" onClick={onEdit}>
          <PencilIcon size={11} />
        </IconAction>
        <IconAction label="Send now" onClick={onSendNow}>
          <ArrowUpIcon size={11} />
        </IconAction>
        <IconAction label="Remove from queue" onClick={onRemove}>
          <XIcon size={11} />
        </IconAction>
      </span>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(label)}
      title={t(label)}
      className="pressable flex size-5 shrink-0 items-center justify-center rounded-tiny text-ink-3 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}
