import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { Card } from "../ui";
import { GlideList } from "../motion";

/**
 * The building blocks every Settings ▸ category is made of, so a section added
 * later reads exactly like the ones before it.
 */

/** Card with a glide highlight that travels between its rows. */
export function Section({
  title,
  index,
  actions,
  children,
}: {
  title: string;
  index?: number;
  /** small controls at the right of the card header */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card index={index} className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{title}</span>
        {actions}
      </div>
      <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
        {children}
      </GlideList>
    </Card>
  );
}

export function Row({
  title,
  hint,
  mono,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** machine identifiers (model keys, paths) read better in mono */
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-row
      className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3 last:border-0"
    >
      <div className="min-w-0 flex-1">
        <div className={cn("text-[12.5px] leading-snug text-ink", mono && "font-mono text-[11.5px]")}>{title}</div>
        {/* hints wrap instead of truncating: a cut sentence in a settings row
            reads like a bug, and two lines still fit the rhythm */}
        {hint ? <div className="mt-1 text-[11px] leading-snug text-ink-3">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("pressable relative h-[18px] w-8 rounded-full", on ? "bg-green" : "bg-line-strong")}
      style={{ transition: "background-color 200ms ease-out" }}
    >
      <span
        className="absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow"
        style={{
          transform: on ? "translateX(14px)" : "translateX(0)",
          transition: "transform 240ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />
    </button>
  );
}

export function Select({
  value,
  options,
  onChange,
  /** set when the options are raw identifiers (model keys, levels) that read better in mono */
  mono,
  disabled,
  title,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  mono?: boolean;
  disabled?: boolean;
  /** on the element itself, since a disabled control ignores a wrapper's tooltip */
  title?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      title={title}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-7 min-w-[72px] rounded-control bg-field px-2 text-[11.5px] text-ink outline-none transition-shadow duration-150 focus:shadow-[0_0_0_3px_var(--accent-tint)]",
        mono && "font-mono text-[11px]",
        disabled && "cursor-default text-ink-3",
      )}
    >
      {options.map((option) => (
        /* the option label is translated, the value the agent receives is not */
        <option key={option} value={option}>
          {t(option)}
        </option>
      ))}
    </select>
  );
}
