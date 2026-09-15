import { SlidingGroup } from "../motion";
import { cn } from "../../lib/cn";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Thinking-depth switch.
 *
 * A segmented control with one pill that slides between levels, so changing
 * depth reads as a single object moving rather than two backgrounds swapping.
 * Only the levels this model actually maps are offered, and the group follows
 * keyboard focus the same way it follows the pointer.
 */
export function ThinkingSwitch({
  levels,
  value,
  onChange,
}: {
  levels: string[];
  value: string;
  onChange: (level: string) => void;
}) {
  const available = LEVELS.filter((level) => levels.includes(level));
  if (available.length < 2) return null;

  return (
    <SlidingGroup
      activeIndex={Math.max(0, available.indexOf(value))}
      className="flex items-center gap-0.5 rounded-chip bg-field p-[3px]"
      pillClassName="bg-surface shadow-hairline"
    >
      {available.map((level) => (
        <button
          key={level}
          data-slide-item
          type="button"
          title={`Thinking depth: ${level}`}
          onClick={() => onChange(level)}
          className={cn(
            "pressable relative z-10 h-5 rounded-[4px] px-1.5 font-mono text-[10.5px]",
            level === value ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {level === "medium" ? "med" : level === "minimal" ? "min" : level}
        </button>
      ))}
    </SlidingGroup>
  );
}
