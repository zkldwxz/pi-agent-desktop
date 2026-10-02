import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@shared/types";
import { buildTurns } from "../../lib/agent-view";
import { asProse } from "../../lib/format";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";

/* ─────────────────────────────────────────────────────────
 * THE TURN RAIL
 *
 * One mark per turn, in its own 28px column to the left of the transcript's
 * scrollbar — not floating on the bar, and not a second scrollbar. A long
 * session gets a shape you can aim at; hovering a mark floats out what was asked
 * and what came back; clicking puts that turn below the top of the scrollport.
 *
 * Both reference implementations of this rail were read before it was written,
 * and it is a fusion of the two:
 *
 *   · AT REST, LENGTH IS THE TURN'S STATE (DeepSeek Harness). The current turn
 *     is the long mark; every other mark is short. Hovering does not change that
 *     — the shape of the session is readable without touching anything.
 *   · UNDER THE POINTER, LENGTH IS DISTANCE (ZCode). The mark under the pointer
 *     grows and its two neighbours grow less, so the column forms a peak that
 *     says where the pointer is and what is next to it. ZCode's own rail is the
 *     mirror of this one — left edge, bars growing rightwards from `origin-left`;
 *     this one is on the right, growing leftwards from `origin-right`, into the
 *     gutter rather than over the text.
 *   · RIGHT-ANCHORED either way, so a short mark still ends where every other
 *     mark ends and the column reads as one edge.
 *   · THE RAIL SCROLLS ITSELF. Marks are 10px apart, so a hundred-turn session
 *     is 1000px of them in a band that is usually shorter. The rail clips and
 *     scrolls, keeps the current mark in view and fades its own ends; it never
 *     grows into the composer and never takes a scrollbar of its own.
 * ───────────────────────────────────────────────────────── */

/** the pointer has to mean it — crossing the rail on the way to the window edge should not flash a card */
const HOVER_DELAY = 90;
/** one mark per turn, ten pixels apart: a 2px bar in an 8px gap */
const MARK_PITCH = 10;
/** the bar's drawn width; every length below is a multiple of it, via scaleX */
const BAR_WIDTH = 12;
/** the longest a bar may get — the column, less the 2px it keeps off the edge */
const BAR_MAX = 26;

/** How long a mark is, in px, and how solid.
 *
 *  At rest the current turn is long and everything else is short (the harness's
 *  ladder, rescaled to this column: 0.6 / 1.0 of a 20px bar). Under the pointer
 *  the column becomes ZCode's peak — the hovered mark at full length, its
 *  neighbours at 1.25 and 1.08 of the base. Lengths, not scale factors, because
 *  the two rules have different bases and one clamp has to hold both. */
function markVisual(index: number, active: boolean, focus: number | null) {
  if (focus === null) {
    return { length: active ? 20 : 12, opacity: active ? 1 : 0.58 };
  }
  const distance = Math.abs(index - focus);
  if (distance === 0) return { length: BAR_MAX, opacity: 1 };
  if (distance === 1) return { length: 18, opacity: 0.86 };
  if (distance === 2) return { length: 15, opacity: 0.72 };
  return { length: active ? 20 : 12, opacity: active ? 0.9 : 0.58 };
}

export function SessionStrip({
  messages,
  activeKey,
  onJump,
  className,
}: {
  messages: ChatMessage[];
  /** the turn the reader is on, tracked from the transcript's scroll position */
  activeKey?: string;
  onJump: (key: string) => void;
  /** the app places the rail in the gutter it reserved for it */
  className?: string;
}) {
  const turns = useMemo(() => buildTurns(messages, []).filter((turn) => turn.prompt), [messages]);
  /* Which mark the pointer is on — the peak follows this, with no delay: it is
     the rail answering the pointer, not a surface opening. */
  const [focus, setFocus] = useState<number | null>(null);
  /* and the card's own state, which does wait — crossing the rail on the way to
     the window edge should not flash a card at whatever it passed over */
  const [hover, setHover] = useState<{ index: number; top: number; bottom: number } | null>(null);
  const [fade, setFade] = useState({ up: false, down: false });
  const timer = useRef(0);
  const rail = useRef<HTMLDivElement | null>(null);
  const marks = useRef(new Map<number, HTMLButtonElement>());

  /* Which end of the rail is clipped off. Two comparisons against scrollTop, run
     on scroll and on resize rather than on every render. */
  const syncFade = useCallback(() => {
    const node = rail.current;
    if (!node) return;
    const up = node.scrollTop > 1;
    const down = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setFade((current) => (current.up === up && current.down === down ? current : { up, down }));
  }, []);

  useEffect(() => {
    syncFade();
    const node = rail.current;
    if (!node) return;
    const observer = new ResizeObserver(syncFade);
    observer.observe(node);
    return () => observer.disconnect();
  }, [syncFade, turns.length]);

  /* Keep the current mark inside the rail — by hand, not `scrollIntoView`, which
     would scroll the transcript too: the rail sits inside the scroller's own
     subtree, so its ancestors are the transcript's. */
  const activeIndex = turns.findIndex((turn) => turn.key === activeKey);
  useEffect(() => {
    const node = rail.current;
    const mark = activeIndex >= 0 ? marks.current.get(activeIndex) : undefined;
    if (!node || !mark || hover || focus !== null) return;
    const top = mark.offsetTop;
    const bottom = top + mark.offsetHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight;
    syncFade();
  }, [activeIndex, hover, focus, syncFade]);

  if (turns.length < 2) return null;

  const show = (index: number) => {
    const host = rail.current;
    const mark = marks.current.get(index);
    const rect = mark?.getBoundingClientRect();
    const frame = host?.getBoundingClientRect();
    setHover({
      index,
      top: rect && frame ? rect.top - frame.top : 0,
      bottom: rect && frame ? frame.bottom - rect.bottom : 0,
    });
  };
  const arm = (index: number) => {
    window.clearTimeout(timer.current);
    setFocus(index);
    timer.current = window.setTimeout(() => show(index), HOVER_DELAY);
  };
  const disarm = () => {
    window.clearTimeout(timer.current);
    setFocus(null);
    setHover(null);
  };
  /** the pointer left one mark for another: the peak moves now, the card waits */
  const soften = () => window.clearTimeout(timer.current);

  const hovered = hover ? turns[hover.index] : undefined;
  const hoveredQuery = (hovered?.prompt ?? "").trim();
  const hoveredReply = hovered ? asProse(hovered.fullText) : "";
  /* a card above the top mark or below the bottom one would leave the band, so
     the column flips at its own midpoint */
  const above = hover ? hover.index > turns.length / 2 : false;

  return (
    <div className={cn(className)}>
      <nav aria-label={t("Conversation map")} onPointerLeave={disarm} className="flex max-h-full flex-col items-end">
        <div
          ref={rail}
          onScroll={() => {
            /* a card left open over a rail that has just scrolled under it points
               at the wrong mark — ZCode drops the interaction on the same event */
            setFocus(null);
            setHover(null);
            syncFade();
          }}
          /* `overflow-x-hidden` is not optional: `overflow-y-auto` alone makes the
             browser compute `overflow-x` as `auto` too, and a bar that grows
             sideways under the pointer then earns the rail a horizontal bar. */
          className="rail-scroll w-[28px] overflow-x-hidden overflow-y-auto overscroll-contain py-[6px]"
          style={{
            maskImage: `linear-gradient(to bottom, ${fade.up ? "transparent, black 24px" : "black 0"}, ${
              fade.down ? "black calc(100% - 24px), transparent" : "black 100%"
            })`,
          }}
        >
          {turns.map((turn, index) => {
            const active = turn.key === activeKey;
            const visual = markVisual(index, active, focus);
            return (
              <button
                key={turn.key}
                ref={(element) => {
                  if (element) marks.current.set(index, element);
                  else marks.current.delete(index);
                }}
                type="button"
                aria-label={tf("Jump to turn {count}", { count: index + 1 })}
                aria-current={active ? "true" : undefined}
                aria-busy={turn.streaming || undefined}
                onPointerEnter={() => arm(index)}
                onPointerLeave={soften}
                onFocus={() => {
                  setFocus(index);
                  show(index);
                }}
                onBlur={disarm}
                onClick={() => onJump(turn.key)}
                className="flex w-full shrink-0 cursor-pointer items-center justify-end"
                style={{ height: MARK_PITCH }}
              >
                <span
                  className={cn(
                    "h-[2px] origin-right rounded-[2px] transition-[transform,opacity,background-color] duration-150 ease-out motion-reduce:transition-none",
                    turn.streaming ? "rail-busy bg-accent" : active ? "bg-ink" : hover?.index === index ? "bg-ink-3" : "bg-line-strong",
                  )}
                  style={{
                    width: BAR_WIDTH,
                    transform: `scaleX(${(visual.length / BAR_WIDTH).toFixed(2)})`,
                    opacity: visual.opacity,
                  }}
                />
              </button>
            );
          })}
        </div>
      </nav>
      {hover && hovered ? (
        <div
          key={hovered.key}
          role="tooltip"
          className="pointer-events-none absolute right-[calc(100%+10px)] w-[min(300px,100cqw-120px)] max-h-[100px] overflow-hidden rounded-window bg-surface px-[12px] py-[10px] shadow-overlay"
          style={{
            ...(above ? { bottom: hover.bottom } : { top: hover.top }),
            animation: "rail-preview-in 120ms ease-out both",
          }}
        >
          <p className="line-clamp-1 text-ui-caption font-medium leading-5 text-ink">{hoveredQuery}</p>
          {hoveredReply ? (
            <p className="mt-[4px] line-clamp-3 text-ui-sm leading-[18px] text-ink-3">{hoveredReply}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
