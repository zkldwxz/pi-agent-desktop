import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { ChevronDownIcon } from "../icons";

/**
 * The building blocks every Settings ▸ category is made of — baocode's
 * settings widgets (lib/settings/pages/settings_widgets.dart), ported as they
 * are, so a section added later reads exactly like the ones before it:
 *
 * - a group: its heading (12.5, medium, muted) over its card, 8px in;
 * - the card: radius 12, no outline, the page's colour with 4% of the ink
 *   over it; 1px lines of 4% ink between its rows, 12px in from its sides;
 * - a row: 14 / 12 in, the label at 13 / 1.4, the description at 12 / 1.5
 *   muted under it, the control 20px off on the right;
 * - the switch: the button colour on, a faint track off, 16 high;
 * - the dropdown: 26 high, radius 6, a 1px input line, 12.5.
 */

/** A group of settings: the heading over its card. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  /** under the heading, fainter */
  description?: ReactNode;
  /** kept for callers that staggered their cards; the card no longer animates */
  index?: number;
  /** small controls on the heading's right */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-end gap-3 pr-1 pb-2 pl-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-ui-caption font-medium text-ink-2">{title}</h2>
          {description ? <p className="mt-0.5 text-ui-meta leading-[1.5] text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

/** SettingsCard: the rows of a group, with a hairline between each two. */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("settings-card overflow-hidden rounded-[12px] bg-settings-card", className)}>{children}</div>;
}

export function Row({
  title,
  hint,
  mono,
  below,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** machine identifiers (model keys, paths) read better in mono */
  mono?: boolean;
  /** SettingsRow.below: under the label, full width, 8px down (a preview) */
  below?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div data-row className="relative px-3.5 py-3">
      <div className="flex items-center gap-5">
        <div className="min-w-0 flex-1">
          <div className={cn("text-ui-step leading-[1.4] text-ink", mono && "font-mono text-ui-meta")}>{title}</div>
          {/* descriptions wrap rather than truncate: a cut sentence reads like a bug */}
          {hint ? <div className="mt-px text-ui-meta leading-[1.5] text-ink-2">{hint}</div> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
      </div>
      {below ? <div className="mt-2">{below}</div> : null}
    </div>
  );
}

/** IdeSwitch: 28 × 16, a 12px knob; on, the button colour; off, a faint track */
export function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-[140ms] disabled:opacity-40",
        on ? "bg-button" : "bg-[color-mix(in_srgb,var(--ink-4)_45%,transparent)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-3 rounded-full shadow-[0_0_2px_rgb(0_0_0/0.2)] transition-transform duration-[140ms]",
          on ? "bg-on-accent" : "bg-white",
        )}
        style={{ transform: on ? "translateX(12px)" : "translateX(0)" }}
      />
    </button>
  );
}

/** SettingsDropdown: 26 high, radius 6, a 1px input line, 9 / 6 in, 12.5 */
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
  /** values (shown through t()), or values with their own labels */
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
  mono?: boolean;
  disabled?: boolean;
  /** on the element itself, since a disabled control ignores a wrapper's tooltip */
  title?: string;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        disabled={disabled}
        title={title}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-[26px] min-w-[72px] appearance-none rounded-[6px] border border-input-line bg-transparent pr-6 pl-[9px] text-ui-caption text-ink outline-none transition-colors duration-100 hover:bg-hover focus-visible:border-accent",
          mono && "font-mono text-ui-meta",
          disabled && "cursor-default text-ink-3 hover:bg-transparent",
        )}
      >
        {options.map((option) =>
          /* the option label is translated, the value the agent receives is not */
          typeof option === "string" ? (
            <option key={option} value={option}>
              {t(option)}
            </option>
          ) : (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ),
        )}
      </select>
      <ChevronDownIcon size={14} className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-2" />
    </span>
  );
}

/** SettingsTextField: radius 5, a 1px input line that turns the accent, mono 12 */
export function TextField({
  value,
  onChange,
  placeholder,
  width = 220,
  mono = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      style={{ width }}
      className={cn(
        "h-[26px] rounded-[5px] border border-input-line bg-transparent px-2 text-ink outline-none placeholder:text-ink-4 focus:border-accent",
        mono ? "font-mono text-ui-meta" : "text-ui-caption",
      )}
    />
  );
}

/** a settings button (IdeButton): 24 high, radius 4, a 1px line, 12px */
export function SettingsButton({
  children,
  onClick,
  primary,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "pressable flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] border px-2 text-ui-meta transition-colors duration-100 disabled:opacity-40",
        primary
          ? "border-button bg-button text-on-accent hover:bg-accent-strong"
          : "border-[var(--pill-emphasis)] bg-[var(--pill-emphasis)] text-ink hover:bg-hover-2",
      )}
    >
      {children}
    </button>
  );
}
