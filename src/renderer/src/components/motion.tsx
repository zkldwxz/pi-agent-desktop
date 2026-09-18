import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import { Markdown } from "./Markdown";

/** Capped stagger index — after the fifth item every row enters together. */
export function stagger(index: number): CSSProperties {
  return { "--i": Math.min(index, 4) } as CSSProperties;
}

/**
 * One shared surface that glides between rows.
 *
 * Hover and keyboard focus drive the same layer, so tabbing through a list moves
 * the highlight exactly like the pointer does. Rows opt in with `data-row`
 * (or a custom `rowSelector`) and must not paint their own hover background.
 */
export function GlideList({
  children,
  className,
  highlightClassName = "bg-hover-2",
  rowSelector = "[data-row]",
  radius = 7,
}: {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
  radius?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);

  const moveTo = useCallback(
    (target: EventTarget | null) => {
      const host = hostRef.current;
      if (!(target instanceof Element) || !host) return;
      const row = target.closest(rowSelector);
      if (!(row instanceof HTMLElement) || !host.contains(row)) return;
      const hostRect = host.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      setBox({ top: rect.top - hostRect.top, height: rect.height });
      setVisible(true);
    },
    [rowSelector],
  );

  return (
    <div
      ref={hostRef}
      className={cn("relative", className)}
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        if (!hostRef.current?.contains(event.relatedTarget as Node | null)) setVisible(false);
      }}
    >
      <span
        aria-hidden
        className={cn("glide-layer", highlightClassName)}
        style={{
          borderRadius: radius,
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: visible && box ? 1 : 0,
        }}
      />
      {children}
    </div>
  );
}

/**
 * A sliding pill for segmented controls and rails. It follows both the active
 * index and keyboard focus, so arrowing or tabbing moves the pill with the
 * pointer would.
 */
export function SlidingGroup({
  children,
  className,
  activeIndex,
  itemSelector = "[data-slide-item]",
  inset = 0,
  pillClassName = "bg-surface shadow-hairline",
}: {
  children: ReactNode;
  className?: string;
  activeIndex: number;
  itemSelector?: string;
  inset?: number;
  pillClassName?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const index = focusIndex ?? activeIndex;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const items = host.querySelectorAll<HTMLElement>(itemSelector);
    const target = items[index];
    if (!target) return;
    const hostRect = host.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const next = {
      top: rect.top - hostRect.top + inset,
      left: rect.left - hostRect.left + (inset ? inset : 0),
      width: rect.width - inset * 2,
      height: rect.height - inset * 2,
    };
    setBox((current) =>
      current && current.top === next.top && current.height === next.height && current.left === next.left
        ? current
        : next,
    );
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [index, itemSelector, inset]);

  return (
    <div
      ref={hostRef}
      className={cn("relative", className)}
      onFocusCapture={(event) => {
        const items = [...(hostRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? [])];
        const found = items.findIndex((item) => item.contains(event.target as Node));
        if (found >= 0) setFocusIndex(found);
      }}
      onBlurCapture={(event) => {
        if (!hostRef.current?.contains(event.relatedTarget as Node | null)) setFocusIndex(null);
      }}
    >
      <span
        aria-hidden
        className={cn("pointer-events-none absolute rounded-control", pillClassName)}
        style={{
          top: box?.top ?? 0,
          left: box?.left ?? 0,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          opacity: ready && box ? 1 : 0,
          transition: ready
            ? "top 280ms cubic-bezier(0.23,1,0.32,1), left 280ms cubic-bezier(0.23,1,0.32,1), width 240ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 140ms ease-out"
            : "opacity 140ms ease-out",
        }}
      />
      {children}
    </div>
  );
}

/**
 * Anchored popover with the site's pop-in grammar: scale from the
 * anchor corner, fade the backdrop, close on outside pointer / Escape.
 */
export function Popover({
  open,
  onClose,
  anchor = "bottom-right",
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchor?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      // the trigger itself toggles; without this the close-then-reopen race wins
      if (target.closest("[data-popover-trigger]")) return;
      if (!ref.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const origin =
    anchor === "bottom-right"
      ? "bottom right"
      : anchor === "bottom-left"
        ? "bottom left"
        : anchor === "top-right"
          ? "top right"
          : "top left";

  return (
    <div
      ref={ref}
      role="dialog"
      className={cn(
        "absolute z-30 overflow-hidden rounded-[10px] bg-surface shadow-overlay",
        anchor.startsWith("bottom") ? "bottom-full mb-2" : "top-full mt-1.5",
        anchor.endsWith("right") ? "right-0" : "left-0",
        className,
      )}
      style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: origin }}
    >
      {children}
    </div>
  );
}

/** Reveal helper for expand/collapse regions (0fr → 1fr). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="collapse-grid" data-open={open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Character-by-character reveal for a *live* token stream.
 *
 * Providers deliver text in bursts, so raw output lands in jagged jumps. This
 * keeps its own cursor and consumes the growing target instead of restarting on
 * every update: the reveal step adapts to the backlog so it never falls more than
 * a few frames behind, and the last few characters carry a masked blur so the
 * leading edge resolves. The caret stays solid while streaming and blinks once
 * the text settles.
 */
export function StreamText({
  text,
  /** false while the agent is still producing tokens */
  done = true,
  className,
  caret = true,
  markdown = false,
}: {
  text: string;
  done?: boolean;
  className?: string;
  caret?: boolean;
  /** render the revealed slice through the Markdown pipeline as it grows */
  markdown?: boolean;
  blurTail?: number;
  tickMs?: number;
}) {
  const targetLength = text.length;
  const [revealed, setRevealed] = useState(() => (done ? targetLength : Math.min(targetLength, 1)));
  const targetRef = useRef(targetLength);
  targetRef.current = targetLength;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;

  // Immediately reveal all text if done or if text shrunk
  useEffect(() => {
    if (done) {
      setRevealed(targetLength);
      revealedRef.current = targetLength;
      return;
    }
    if (revealedRef.current > targetLength) {
      setRevealed(targetLength);
      revealedRef.current = targetLength;
    }
  }, [done, targetLength]);

  // High-performance rAF loop for smooth streaming without dropped frames
  useEffect(() => {
    if (done) return;

    let rafId: number | null = null;
    let lastTime = performance.now();
    let lastCommit = 0;

    const frame = (now: number) => {
      const current = revealedRef.current;
      const target = targetRef.current;

      if (current < target) {
        const delta = Math.max(1, now - lastTime);
        const backlog = target - current;
        /* Providers deliver whole paragraphs in one chunk; revealing a chunk
         * in a single frame is why the typewriter disappeared. The catch-up is
         * paced instead: a burst never takes longer than ~0.4s, a trickle still
         * types at a readable ~60 chars/s. */
        const perFrame = Math.max(1, Math.round((delta / 16.7) * 1));
        const catchUp = Math.ceil(backlog / 25);
        const step = Math.max(perFrame, Math.min(catchUp, Math.ceil(backlog / 4)));
        const next = Math.min(target, current + step);
        revealedRef.current = next;
        /* Markdown re-parses the whole prefix, so the reveal commits at ~12fps
         * there instead of every frame; plain text commits every frame. */
        if (!markdown || next === target || now - lastCommit >= 80) {
          lastCommit = now;
          setRevealed(next);
        }
        lastTime = now;
      }

      // stop the loop once caught up — the effect re-runs when new tokens
      // arrive (targetLength changes) and starts it again
      if (revealedRef.current < targetRef.current) {
        rafId = requestAnimationFrame(frame);
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [done, targetLength, markdown]);

  const settled = done && revealed >= targetLength;
  const shownText = text.slice(0, revealed);

  return (
    <span className={className}>
      {markdown ? <Markdown>{shownText}</Markdown> : shownText}
      {caret ? <span aria-hidden className={`stream-caret${settled ? "" : " is-streaming"}`} /> : null}
    </span>
  );
}

/**
 * Live agent output: real tokens revealed with the character-level 吐字 pass.
 * Never re-animates an already-settled message.
 */
export function StreamingParagraph({
  text,
  done,
  className,
}: {
  text: string;
  done?: boolean;
  className?: string;
}) {
  return <StreamText text={text} done={done} className={className} />;
}

/**
 * Word-by-word reveal for scripted/demo text where there is no real token
 * stream. Do not use this for live agent output.
 */
export function StreamLine({
  text,
  className,
  stream = false,
  onDone,
}: {
  text: string;
  className?: string;
  stream?: boolean;
  onDone?: () => void;
}) {
  const words = useMemo(() => text.split(" "), [text]);
  const [count, setCount] = useState(() => (stream ? 0 : words.length));
  const doneRef = useRef(!stream || words.length === 0);

  useEffect(() => {
    doneRef.current = !stream || words.length === 0;
    setCount(stream ? 0 : words.length);
  }, [text, stream, words.length]);

  useEffect(() => {
    if (count >= words.length) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
      return;
    }
    const timer = setTimeout(() => setCount((value) => value + 1), 34);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, words.length]);

  const streaming = count < words.length;
  const head = streaming ? words.slice(0, Math.max(0, count - 3)) : words.slice(0, count);
  const tail = streaming ? words.slice(Math.max(0, count - 3), count) : [];

  return (
    <p className={className}>
      {head.map((word, index) => (
        <span key={index}>{word} </span>
      ))}
      {tail.length ? <span>{tail.join(" ")} </span> : null}
      {streaming ? <span className="stream-caret is-streaming" /> : null}
      {!streaming && stream ? <span className="stream-caret" /> : null}
    </p>
  );
}

/**
 * Keeps Tab inside a modal surface.
 *
 * Both the command palette and the approval prompt are overlay dialogs; without
 * this, Tab walks out into the app behind them and the dialog becomes
 * unreachable without a mouse.
 */
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const host = ref.current;
    if (!host) return;
    const selector =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...host.querySelectorAll<HTMLElement>(selector)].filter(
        (item) => item.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (current === first || !host.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  return ref;
}
