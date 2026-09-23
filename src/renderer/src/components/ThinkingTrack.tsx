import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";

/** the thumb sets the rail's inset: its centre has to reach both ends */
const THUMB = 28;
const HALF = THUMB / 2;
const RAIL = 22;

/** the two levels that mean "delegate proactively" — they get the purple end */
const HOT = new Set(["max", "ultra"]);
/** the levels just under it, which get the blue */
const COOL = new Set(["high", "xhigh"]);

/* Two states, not a ramp along the rail: below Max the bar is only blue, and at
   Max it goes purple past a short light-blue tail. The stops are percentages of
   the *fill* (see backgroundSize below), so the tail stays a tail at every depth
   instead of stretching with the bar. */
const TAIL = `color-mix(in oklab, var(--accent) 52%, var(--surface))`;
const FILL_COOL = `linear-gradient(90deg, ${TAIL} 0%, var(--accent) 34%, var(--accent) 100%)`;
const FILL_HOT = `linear-gradient(90deg, ${TAIL} 0%, var(--accent) 8%, var(--ultra) 22%, var(--ultra) 100%)`;

/* Fixed so the field does not shuffle on every render: dots and four-point stars
   at hand-placed spots, in % of the rail. They ride inside the clipped fill, so
   they appear only where the bar has actually been painted. */
const SPARKS: Array<[x: number, y: number, size: number, alpha: number, star?: boolean]> = [
  [4, 62, 3, 0.55],
  [9, 28, 2, 0.8],
  [14, 74, 2.5, 0.5],
  [19, 40, 5, 0.9, true],
  [25, 68, 2, 0.7],
  [31, 30, 3, 0.5],
  [37, 58, 2, 0.85],
  [43, 24, 4, 0.7, true],
  [48, 70, 2.5, 0.5],
  [55, 44, 2, 0.8],
  [61, 22, 3, 0.45],
  [66, 66, 6, 0.9, true],
  [72, 36, 2, 0.6],
  [78, 58, 3, 0.5],
  [84, 26, 2.5, 0.8],
  [89, 64, 4, 0.65, true],
  [94, 40, 2, 0.7],
];

/**
 * The colour a level is written in, wherever it appears as text.
 *
 * Depth is a ramp, so the label runs from plain ink through the accent blue to
 * the purple the top of the track ends on. Reading the word "Max" in the same
 * colour as the fill it sits on makes the choice legible without the track.
 */
export function thinkingLevelClass(level: string): string {
  if (HOT.has(level)) return "text-ultra-ink";
  if (COOL.has(level)) return "text-accent-ink";
  return "text-ink-2";
}

/** The same ramp as a chip behind the word, for the composer's trigger. */
export function thinkingBadgeClass(level: string): string {
  if (HOT.has(level)) return "bg-ultra-tint text-ultra-ink";
  if (COOL.has(level)) return "bg-accent-tint text-accent-ink";
  return "bg-field text-ink-2";
}

/**
 * Thinking depth as a slider you drag.
 *
 * The fill is clipped to the thumb and its gradient is measured against that same
 * length, so the thumb, the clip, the colour and every dot hang off one number and
 * cannot drift apart mid-flight.
 *
 * Depth is not a colour ramp: the bar stays blue until Max, and only Max and Ultra
 * turn it purple and light the field. That is the step that changes what a run
 * costs, so it is the step the bar is willing to look different for.
 *
 * While the pointer is down the thumb is at the pointer, not at the nearest step —
 * that continuous follow is what makes it feel like a slider rather than a row of
 * buttons you have to aim at. The step under it is what the label reports, and
 * releasing is the only moment anything is written: travelling over a depth
 * previews it, landing on it commits it.
 */
export function ThinkingTrack({
  levels,
  value,
  onPick,
  onSlide,
}: {
  levels: string[];
  value: string;
  /** commits a level: released pointer, or arrow key */
  onPick: (level: string) => void;
  /** reports the level under the pointer, for the label to follow */
  onSlide?: (level: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  /** the pointer's position along the rail as a ratio, or null when it is gone */
  const [drag, setDrag] = useState<number | null>(null);

  const last = levels.length - 1;
  const resting = last ? Math.max(0, levels.indexOf(value)) / last : 0;
  const progress = drag ?? resting;
  const shown = Math.round(progress * last);
  /** the two depths the bar changes character for — purple body, and the field */
  const hot = HOT.has(levels[shown]);
  /** a point along the rail, measured from its left edge */
  const at = (ratio: number) => `calc(${HALF}px + (100% - ${THUMB}px) * ${ratio})`;

  const ratioAt = (clientX: number) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || last === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - box.left - HALF) / (box.width - THUMB)));
  };

  const travel = (clientX: number) => {
    const ratio = ratioAt(clientX);
    setDrag(ratio);
    onSlide?.(levels[Math.round(ratio * last)]);
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (drag === null) return;
    const picked = levels[Math.round(drag * last)];
    setDrag(null);
    if (picked === value) return;
    onPick(picked);
    /* the top of the ramp is the one choice that changes the character of a run,
       so it asks the composer for its sweep */
    if (HOT.has(picked)) window.dispatchEvent(new CustomEvent("pi:celebrate"));
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? last
      : step === undefined ? null
      : Math.min(last, Math.max(0, shown + step));
    if (next === null) return;
    event.preventDefault();
    if (levels[next] !== value) onPick(levels[next]);
  };

  const glide = drag === null;
  /* 260ms out-quint: the settle from the finger onto the grid has to be over
     before you notice it. Anything slower, or with overshoot, reads as wobble. */
  const snap = "260ms cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div
      ref={rail}
      role="slider"
      tabIndex={0}
      aria-label={t("Thinking depth")}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={shown}
      aria-valuetext={t(levels[shown])}
      onKeyDown={key}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        travel(event.clientX);
      }}
      onPointerMove={(event) => {
        if (drag !== null) travel(event.clientX);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      className="relative cursor-grab touch-none select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/45"
      style={{ height: THUMB, borderRadius: HALF }}
    >
      <div
        className="absolute rounded-full bg-field"
        style={{ top: (THUMB - RAIL) / 2, height: RAIL, left: 0, right: 0 }}
      />
      <div
        className="pointer-events-none absolute overflow-hidden rounded-full"
        style={{ top: (THUMB - RAIL) / 2, height: RAIL, left: 0, width: "100%" }}
      >
        <span
          className="absolute inset-y-0 left-0 w-full"
          style={{
            backgroundImage: hot ? FILL_HOT : FILL_COOL,
            /* one length, used twice: the clip stops here and the gradient is
               measured against it, so the tail never stretches as the bar grows */
            backgroundSize: `${at(progress)} 100%`,
            backgroundRepeat: "no-repeat",
            clipPath: `inset(0 calc(100% - ${at(progress)}) 0 0)`,
            transition: glide
              ? `clip-path ${snap}, background-size ${snap}, background-image 260ms linear`
              : "background-image 260ms linear",
          }}
        >
          {/* the field fades in with the purple and drifts; pausing it off-screen
              keeps a closed popover from animating 17 elements forever */}
          <span
            className="absolute inset-y-0 left-0 w-full"
            style={{
              opacity: hot ? 1 : 0,
              transition: "opacity 260ms linear",
            }}
          >
            {SPARKS.map(([x, y, size, alpha, star], i) => (
              <span
                key={i}
                className="thinking-spark absolute rounded-full bg-surface"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: size,
                  height: size,
                  opacity: alpha,
                  animation: `spark-drift ${1500 + (i % 5) * 380}ms ease-in-out ${-(i * 431) % 1500}ms infinite alternate`,
                  animationPlayState: hot ? "running" : "paused",
                  /* a four-point star is a square pinched on all four sides */
                  clipPath: star
                    ? "polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%)"
                    : undefined,
                }}
              />
            ))}
          </span>
        </span>
      </div>
      {levels.map((entry, position) =>
        position === shown ? null : (
          <span
            key={entry}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: at(last ? position / last : 0),
              /* the dot fades as the thumb comes near and goes inside the fill
                 once the bar has passed it — both off the same continuous ratio,
                 so the grid breathes with the drag instead of flipping per step */
              background: position / last < progress ? "rgb(255 255 255 / 0.7)" : "var(--ink-3)",
              opacity: Math.min(1, Math.max(0, (Math.abs(position - progress * last) - 0.45) / 0.6)),
              transition: glide ? "background-color 200ms linear" : "none",
            }}
          />
        ),
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.16),0_4px_10px_rgb(0_0_0/0.10)] ring-1 ring-ink/5"
        style={{
          left: at(progress),
          width: THUMB,
          height: THUMB,
          transform: `translate(-50%, -50%) scale(${drag === null ? 1 : 1.08})`,
          transition: glide ? `left ${snap}, transform 160ms var(--ease-link)` : "transform 160ms var(--ease-link)",
        }}
      />
    </div>
  );
}

/** The two ends named under the track, so the extremes are legible without hovering. */
export function ThinkingTrackEnds({ levels }: { levels: string[] }) {
  return (
    <div className="mt-1 flex justify-between px-1">
      <span className="font-mono text-[9.5px] text-ink-3">{t(levels[0])}</span>
      <span className={cn("font-mono text-[9.5px]", thinkingLevelClass(levels.at(-1) ?? ""))}>
        {t(levels.at(-1) ?? "")}
      </span>
    </div>
  );
}
