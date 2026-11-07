import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { CheckIcon, ChevronDownIcon } from "../icons";

/**
 * The composer's controls, one shape for all of them — baocode's picker pill
 * (lib/chat/composer/composer_picker.dart:786-838):
 *   22 high, radius 11, 6px in on the left and 3 on the right; a 13px icon,
 *   4px, the label at 12 in muted ink, then a 15px faint chevron when it opens
 *   a menu. Transparent at rest, the toolbar hover underneath, a darker fill
 *   while its menu is open.
 *   `emphasized` (the mode pill) sits on the secondary button fill with a 1px
 *   line; `caution` paints label and icon in the warning colour.
 */
export function ComposerPill({
  icon,
  label,
  title,
  menu = false,
  open = false,
  emphasized = false,
  caution = false,
  onClick,
  children,
  className,
}: {
  icon?: ReactNode;
  label?: ReactNode;
  title?: string;
  /** shows the chevron: the pill opens a menu */
  menu?: boolean;
  open?: boolean;
  emphasized?: boolean;
  caution?: boolean;
  onClick?: () => void;
  /** extra content after the label (e.g. a count) */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-expanded={menu ? open : undefined}
      data-popover-trigger={menu ? "" : undefined}
      onClick={onClick}
      className={cn(
        "pressable inline-flex h-[22px] min-w-0 shrink-0 items-center gap-1 rounded-full text-ui-meta transition-colors duration-[120ms]",
        label || children ? (menu ? "pr-[3px] pl-1.5" : "px-1.5") : "w-[22px] justify-center",
        caution ? "text-orange" : "text-ink-2",
        emphasized
          ? cn("border border-[var(--pill-emphasis)] bg-[var(--pill-emphasis)]", open ? "bg-hover-2" : "hover:bg-hover")
          : open
            ? "bg-hover-2"
            : "hover:bg-hover",
        className,
      )}
    >
      {icon ? <span className="flex size-[13px] shrink-0 items-center justify-center">{icon}</span> : null}
      {label ? <span className="min-w-0 truncate">{label}</span> : null}
      {children}
      {menu ? (
        <ChevronDownIcon
          size={15}
          strokeWidth={1.75}
          className="shrink-0 text-ink-4 transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      ) : null}
    </button>
  );
}

export interface PickerOption {
  key: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  selected?: boolean;
  caution?: boolean;
  onSelect: () => void;
}

/**
 * The menu a pill opens — baocode's picker panel (composer_picker.dart:854,
 * 1480-1612): above the pill, 6px off it; the menu surface, a 1px menu line,
 * radius 8, 4px of padding; rows 40 with a description, 30 without, 8px in,
 * radius 5; icon 15 muted, 10px, label 12.5, description 11 faint under it; a
 * check on the selected row. Enter 140ms from 0.96.
 */
export function PickerMenu({
  open,
  onClose,
  title,
  options,
  footer,
  width = 248,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  options: PickerOption[];
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target)) return;
      /* the pill toggles itself; a press on it must not close-then-reopen */
      if (target.closest?.("[data-popover-trigger]") && panel.current?.parentElement?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      role="menu"
      className="absolute bottom-full left-0 z-40 mb-1.5 rounded-card bg-surface py-1 shadow-overlay"
      style={{ width, animation: "picker-in 140ms var(--ease-out-strong-css) both", transformOrigin: "bottom left" }}
    >
      {title ? <div className="px-3 pt-1 pb-1.5 text-ui-sm text-ink-2">{title}</div> : null}
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="menuitemradio"
          aria-checked={Boolean(option.selected)}
          onClick={() => {
            option.onSelect();
            onClose();
          }}
          className={cn(
            "mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-[5px] px-2 text-left transition-colors duration-100 hover:bg-hover",
            option.description ? "h-10" : "h-[30px]",
            option.caution ? "text-orange" : "text-ink",
          )}
        >
          {option.icon ? (
            <span className={cn("flex size-[15px] shrink-0 items-center justify-center", option.caution ? "" : "text-ink-2")}>
              {option.icon}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui-caption">{option.label}</span>
            {option.description ? (
              <span className={cn("truncate text-ui-xs", option.caution ? "opacity-80" : "text-ink-4")}>{option.description}</span>
            ) : null}
          </span>
          {option.selected ? <CheckIcon size={15} className="shrink-0" /> : null}
        </button>
      ))}
      {footer ? <div className="mt-1 border-t border-line pt-1">{footer}</div> : null}
    </div>
  );
}

/** a footer row in a picker menu ("Manage Models…"): 28 high, icon 15 muted */
export function PickerFooterRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2.5 rounded-[5px] px-2 text-left text-ui-caption text-ink transition-colors duration-100 hover:bg-hover"
    >
      <span className="flex size-[15px] shrink-0 items-center justify-center text-ink-2">{icon}</span>
      {label}
    </button>
  );
}
