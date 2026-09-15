import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * One navigation row, shared by the session pane and the settings rail.
 *
 * Both rails answer the same question — "where am I, and where else can I go" —
 * so they use one row: a 16px icon, a 13px label, an optional trailing hint or
 * glyph, and the same press grammar. The only difference is how the current row
 * reads: the session pane paints it flat, and the settings rail lifts it onto its
 * own surface, because the rail has no workspace row above it to anchor the eye.
 */
export function NavRow({
  icon,
  label,
  hint,
  active = false,
  raised = false,
  trailing,
  className,
  copyClassName,
  iconSize = 16,
  title,
  disabled = false,
  onClick,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  /** trailing text, e.g. a shortcut or a count */
  hint?: ReactNode;
  active?: boolean;
  /** the current row on its own raised surface rather than a flat fill */
  raised?: boolean;
  /** trailing glyph, e.g. the arrow on a row that opens something */
  trailing?: ReactNode;
  className?: string;
  /** applied to the label and the hint — the session pane fades both when it collapses */
  copyClassName?: string;
  iconSize?: number;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      data-nav-row
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      className={cn(
        "pressable flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left",
        raised ? "glide-row" : "",
        raised
          ? active
            ? "bg-surface font-medium text-ink shadow-hairline"
            : "text-ink-2"
          : active
            ? "bg-hover-2"
            : "hover:bg-hover-2",
        disabled && "opacity-40",
        className,
      )}
      {...rest}
    >
      <span
        className={cn("flex shrink-0 items-center justify-center", active ? "text-ink" : "text-ink-3")}
        style={{ width: iconSize, height: iconSize }}
      >
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[12.5px]",
          active && !raised ? "font-medium text-ink" : "",
          copyClassName,
        )}
      >
        {label}
      </span>
      {hint ? (
        <span className={cn("shrink-0 text-[10.5px] text-ink-3 tabular-nums", copyClassName)}>{hint}</span>
      ) : null}
      {trailing ? <span className="shrink-0 text-ink-3">{trailing}</span> : null}
    </button>
  );
}
