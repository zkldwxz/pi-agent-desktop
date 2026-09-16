import type { ColorMode } from "../../lib/theme";
import { cn } from "../../lib/cn";
import { SlidingGroup } from "../motion";
import { MoonIcon, SunIcon } from "../icons";

const MODES: Array<{ key: ColorMode; label: string }> = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

/** Preview swatches — the point is to show what each choice looks like, not to name it. */
const PREVIEW: Record<ColorMode, { page: string; surface: string; ink: string }> = {
  light: { page: "#FAFAFB", surface: "#FFFFFF", ink: "#1F2124" },
  dark: { page: "#22252B", surface: "#2E3138", ink: "#F0F1F3" },
  system: { page: "linear-gradient(135deg,#FAFAFB 50%,#22252B 50%)", surface: "#FFFFFF", ink: "#6F7278" },
};

export function ModeToggle({
  mode,
  onMode,
  className,
}: {
  mode: ColorMode;
  onMode: (mode: ColorMode) => void;
  className?: string;
}) {
  return (
    <SlidingGroup
      activeIndex={MODES.findIndex((entry) => entry.key === mode)}
      className={cn("flex items-center gap-0.5 rounded-chip bg-field p-[3px]", className)}
      pillClassName="bg-surface shadow-hairline"
    >
      {MODES.map((entry) => (
        <button
          key={entry.key}
          data-slide-item
          type="button"
          onClick={() => onMode(entry.key)}
          className={cn(
            "pressable relative z-10 h-6 flex-1 rounded-[5px] text-[11.5px]",
            entry.key === mode ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {entry.label}
        </button>
      ))}
    </SlidingGroup>
  );
}

/**
 * Colour mode picker.
 *
 * Cards rather than a segmented control, because a colour choice is something
 * you recognise rather than read — each card paints its own page, surface and
 * ink so the difference is visible before you commit to it.
 */
const SCALE_OPTIONS = [
  { value: 0.8, label: "80%", desc: "Ultra" },
  { value: 0.85, label: "85%", desc: "Compact" },
  { value: 0.9, label: "90%", desc: "2K/4K pick" },
  { value: 0.95, label: "95%", desc: "Slightly tight" },
  { value: 1.0, label: "100%", desc: "Default" },
  { value: 1.1, label: "110%", desc: "Large" },
  { value: 1.25, label: "125%", desc: "XL" },
];

export function AppearanceSection({
  mode,
  onMode,
  zoomFactor = 1.0,
  onZoomFactor,
}: {
  mode: ColorMode;
  onMode: (mode: ColorMode) => void;
  zoomFactor?: number;
  onZoomFactor?: (factor: number) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-[12.5px] font-medium text-ink">Color</h2>
        <span className="text-[11px] text-ink-3">applies to the whole window</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {MODES.map((entry, index) => {
          const active = entry.key === mode;
          const preview = PREVIEW[entry.key];
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onMode(entry.key)}
              style={{ animation: `fade-up 380ms cubic-bezier(0.23,1,0.32,1) ${index * 45}ms both` }}
              className={cn(
                "pressable-soft pressable flex flex-col gap-2 rounded-card p-3 text-left shadow-card",
                active ? "bg-accent-tint" : "bg-surface hover:bg-hover",
              )}
            >
              <span
                className="flex h-14 w-full items-center gap-1.5 overflow-hidden rounded-[7px] px-2 shadow-hairline"
                style={{ background: preview.page }}
              >
                <span className="h-8 w-6 shrink-0 rounded-[4px]" style={{ background: preview.surface }} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="h-1.5 w-full rounded-full" style={{ background: preview.ink, opacity: 0.85 }} />
                  <span className="h-1.5 w-2/3 rounded-full" style={{ background: preview.ink, opacity: 0.35 }} />
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                {entry.key === "light" ? (
                  <SunIcon size={12} className="text-ink-3" />
                ) : entry.key === "dark" ? (
                  <MoonIcon size={12} className="text-ink-3" />
                ) : (
                  <span className="text-[11px] text-ink-3">◐</span>
                )}
                <span className={cn("text-[12.5px]", active ? "font-medium text-ink" : "text-ink-2")}>{entry.label}</span>
                {active ? <span className="ml-auto size-1.5 rounded-full bg-accent" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {onZoomFactor ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-[12.5px] font-medium text-ink">Interface scale</h2>
            <span className="text-[11px] text-ink-3">Ctrl + / Ctrl - to adjust, Ctrl 0 to reset</span>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {SCALE_OPTIONS.map((opt) => {
              const active = Math.abs(opt.value - zoomFactor) < 0.02;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onZoomFactor(opt.value)}
                  className={cn(
                    "pressable flex flex-col items-center justify-center gap-0.5 rounded-[8px] p-2 text-center shadow-hairline",
                    active ? "bg-ink font-medium text-canvas" : "bg-surface text-ink-2 hover:bg-hover",
                  )}
                >
                  <span className="text-[12.5px]">{opt.label}</span>
                  <span className={cn("text-[9.5px]", active ? "text-canvas/75" : "text-ink-3")}>{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
