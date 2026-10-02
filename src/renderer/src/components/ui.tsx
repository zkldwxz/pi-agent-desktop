import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn";
import { stagger } from "./motion";

export function ViewHeader({
  title,
  subtitle,
  actions,
  leading,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** drawn before the title — a back control, in views you can leave */
  leading?: ReactNode;
}) {
  return (
    <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line px-4">
      {leading}
      <div
        className="truncate text-ui-base font-semibold text-ink"
        style={{ animation: "fade-up 300ms var(--ease-out-strong-css) both" }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          className="min-w-0 truncate text-ui-caption text-ink-3"
          style={{ animation: "fade-up 300ms var(--ease-out-strong-css) 40ms both" }}
        >
          {subtitle}
        </div>
      ) : null}
      <span className="flex-1" />
      <div style={{ animation: "fade-in 260ms ease-out 80ms both" }}>{actions}</div>
    </header>
  );
}

export function Chip({
  active,
  children,
  onClick,
  title,
  disabled,
  index,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  index?: number;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={index === undefined ? undefined : stagger(index)}
      className={cn(
        "pressable inline-flex h-6 items-center gap-1.5 rounded-chip px-2 text-ui-sm",
        index !== undefined && "stagger",
        active ? "bg-ink text-canvas" : "bg-field text-ink-2 hover:bg-hover-2",
        disabled && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  index,
  style,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={index === undefined ? style : { ...stagger(index), ...style }}
      className={cn("rounded-card bg-surface shadow-card", index !== undefined && "stagger", className)}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  index,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  index?: number;
}) {
  return (
    <Card index={index} className="group flex flex-col gap-1 p-3 transition-colors duration-150 hover:bg-hover">
      <div className="flex items-center gap-1.5 text-ui-sm text-ink-3">
        {icon}
        {label}
      </div>
      <div className="text-ui-stat font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">{value}</div>
      {hint ? <div className="truncate text-ui-sm text-ink-3 tabular-nums">{hint}</div> : null}
    </Card>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-line-strong px-6 py-10 text-center"
      style={{ animation: "fade-up 380ms var(--ease-out-strong-css) both" }}
    >
      <div className="text-ui-base font-medium text-ink">{title}</div>
      <div className="max-w-md text-ui-caption text-ink-3">{body}</div>
    </div>
  );
}

/**
 * A block of content that has not arrived yet.
 *
 * Every one of these on a page shares a single clock — the sweep across the
 * surface is the loading signal, and per-block animation delays made a loading
 * view flicker out of phase, which reads as broken rather than as slow.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} />;
}
