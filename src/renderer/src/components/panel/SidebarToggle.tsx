import { PanelLeftIcon } from "../icons";
import { cn } from "../../lib/cn";
import { t, useLocale } from "../../lib/i18n";

/**
 * The sidebar's trigger, pinned in the title bar.
 *
 * The rail's own expand row is the primary affordance, but it is one 16px
 * glyph in a 52px strip — easy to miss and impossible to find by keyboard or
 * screen reader. This is the always-available control, like Cursor's sidebar
 * button in the window chrome.
 */
export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  useLocale();
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      title={collapsed ? t("Show the sidebar") : t("Hide the sidebar")}
      aria-label={collapsed ? t("Show the sidebar") : t("Hide the sidebar")}
      onClick={onToggle}
      className={cn(
        "pressable flex size-6 shrink-0 items-center justify-center rounded-[6px]",
        !collapsed ? "text-ink-3 hover:bg-hover hover:text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      <PanelLeftIcon size={15} className={cn(!collapsed && "opacity-60")} />
    </button>
  );
}
