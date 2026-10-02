import { PanelRightIcon } from "../icons";
import { cn } from "../../lib/cn";
import { t, useLocale } from "../../lib/i18n";

/**
 * The right dock's trigger.
 *
 * It lives in the header of whatever view is open — in the chat that is the spot
 * the decorative ellipsis used to occupy, at the right edge of the main column.
 * When the dock opens, the header narrows to make room for it, so the same
 * button ends up against the panel's left edge: the control that opened the
 * panel is the control that closes it, and it never leaves the corner you
 * clicked.
 */
export function DockToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  useLocale();
  return (
    <button
      type="button"
      aria-expanded={open}
      title={open ? t("Hide the tool panel") : t("Show the tool panel")}
      aria-label={open ? t("Hide the tool panel") : t("Show the tool panel")}
      onClick={onToggle}
      className={cn(
        "pressable flex size-6 shrink-0 items-center justify-center rounded-chip",
        open ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
      )}
    >
      <PanelRightIcon size={15} />
    </button>
  );
}
