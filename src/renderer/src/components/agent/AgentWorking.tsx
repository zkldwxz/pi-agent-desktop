import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";

/* baocode's ThinkingSpark (widgets/thinking_spark.dart): six shapes cycled
   every 120ms, the whole glyph turning once every 12s, in its terracotta */
const SPARK_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/* a handful of its musings; a known step's own label wins */
const MUSINGS = ["Thinking", "Pondering", "Noodling", "Working", "Mulling it over", "Reading context"];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * The working indicator, baocode's activity row (widgets/activity_row.dart):
 * left-aligned, 9px above and 3 below, the spark at 15, 6px, then the phrase
 * at 13 in ink. Reduced motion holds the spark still on ✻.
 */
export function AgentWorking({ label }: { label?: string; variant?: "Drive" | "Dots" | "Orbit" }) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(4);
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setFrame((value) => (value + 1) % SPARK_FRAMES.length), 120);
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => {
    if (label) return;
    const id = window.setInterval(() => setPhrase((value) => (value + 1) % MUSINGS.length), 6000);
    return () => window.clearInterval(id);
  }, [label]);

  return (
    <div className="flex items-center gap-1.5 pt-[9px] pb-[3px]" style={{ animation: "fade-in 220ms ease-out both" }}>
      <span
        aria-hidden
        className="flex size-[15px] shrink-0 items-center justify-center text-[15px] leading-none text-spark"
        style={reduced ? undefined : { animation: "spark-turn 12s linear infinite" }}
      >
        {reduced ? "✻" : SPARK_FRAMES[frame]}
      </span>
      <span key={label ?? phrase} className="text-ui-step text-ink" style={{ animation: "fade-in 240ms ease-out both" }}>
        {label ?? t(MUSINGS[phrase])}
      </span>
    </div>
  );
}
