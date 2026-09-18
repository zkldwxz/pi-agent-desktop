import { useEffect, useState } from "react";
import LoadingState from "../beautiful/primitives/LoadingState";
import { t } from "../../lib/i18n";

const IDLE_LABELS = ["Thinking", "Reading context", "Working"];

/**
 * The working indicator.
 *
 * `LoadingState` is the pixel-grid loader with its shimmering label and live
 * elapsed timer. Variants rotate so a long run does not read as a frozen
 * screen; `Orbit` is skipped because at 4px the ring reads as noise.
 */
export function AgentWorking({
  label,
  variant = "Drive",
}: {
  label?: string;
  variant?: "Drive" | "Dots" | "Orbit";
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (label) return;
    const timer = setInterval(() => setIndex((value) => value + 1), 6000);
    return () => clearInterval(timer);
  }, [label]);

  return (
    <div style={{ animation: "fade-in 220ms ease-out both" }}>
      <LoadingState label={label ?? t(IDLE_LABELS[index % IDLE_LABELS.length])} variant={variant} />
    </div>
  );
}
