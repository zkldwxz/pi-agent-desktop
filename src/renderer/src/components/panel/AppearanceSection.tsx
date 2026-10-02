import type { ColorMode } from "../../lib/theme";
import { cn } from "../../lib/cn";
import { t, tf, type Locale } from "../../lib/i18n";
import { formatChord, useShortcuts } from "../../lib/keybindings";
import { CODE_THEMES, type CodeTheme } from "../../lib/code-theme";
import { highlightLines } from "../../lib/highlight";
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
            "pressable relative z-10 h-6 flex-1 rounded-chip text-ui-sm",
            entry.key === mode ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {t(entry.label)}
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
  { value: 0.85, label: "85%", desc: "Dense" },
  { value: 0.9, label: "90%", desc: "2K/4K pick" },
  { value: 0.95, label: "95%", desc: "Slightly tight" },
  { value: 1.0, label: "100%", desc: "Default" },
  { value: 1.1, label: "110%", desc: "Large" },
  { value: 1.25, label: "125%", desc: "XL" },
];

/**
 * The code style preview: the same renderer the transcript's code blocks use,
 * pointed at a fixed snippet, so what you pick is what a real listing gets.
 *
 * Two panes side by side — code and diff — because they answer different
 * questions (does this palette read as code; do the add/del accents still say
 * added and removed in it). The theme applies through <html
 * data-code-theme>, so both panes re-colour live while the window's own light
 * or dark mode keeps doing its work.
 */
const SAMPLE_CODE = [
  "// churn.ts — the flavour pipeline",
  "export async function churnBatch() {",
  '  const flavor = await getFlavor("pistachio");',
  "  const base = await dairy.fetch({ flavor });",
  '  await freezer.store(base, { temp: "-16C" });',
  "  if (!base.approved) return null;",
  "  return base.gallons;",
  "}",
].join("\n");

const SAMPLE_DIFF = [
  "- const base = await dairy.fetch(flavor);",
  "+ const base = await dairy.fetch({ flavor });",
  "+ // fetch takes an options object since 2.4",
  "  await freezer.store(base, { temp: \"-16C\" });",
].join("\n");

/** One line of highlighted HTML per row — the same split the transcript's code
 *  blocks use, so the preview colours exactly what a real listing colours. */
function CodePreviewPane({ title, code, language }: { title: string; code: string; language: string }) {
  /* the tone is read off the *raw* line: once highlighted, a `+` sits inside a
     `<span class="hljs-addition">`, and testing the HTML for a leading sign
     silently left every diff row unwashed */
  const raw = code.split("\n");
  const lines = highlightLines(code, language) ?? raw;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="px-0.5 text-ui-sm text-ink-3">{title}</span>
      <div className="scrollbar-thin overflow-x-auto rounded-card bg-surface p-3 shadow-hairline">
        <code className="hljs block font-mono text-ui-sm leading-[1.7]">
          {lines.map((line, index) => {
            const text = raw[index] ?? "";
            const kind = language === "diff" ? (text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "ctx") : "ctx";
            return (
              <div
                key={index}
                className={cn(
                  "-mx-3 px-3",
                  kind === "add" && "bg-green-tint",
                  kind === "del" && "bg-red-tint",
                )}
                dangerouslySetInnerHTML={{ __html: line || " " }}
              />
            );
          })}
        </code>
      </div>
    </div>
  );
}

function CodeStyleSection({ theme, onTheme }: { theme: CodeTheme; onTheme: (theme: CodeTheme) => void }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-ui-caption font-medium text-ink">{t("Code style")}</h2>
        <span className="text-ui-sm text-ink-3">{t("the palette of code blocks; follows light and dark")}</span>
      </div>
      <div className="flex w-fit items-center gap-0.5 rounded-chip bg-field p-0.5">
        {CODE_THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onTheme(option.id)}
            aria-pressed={theme === option.id}
            className={cn(
              "pressable h-6 rounded-chip px-3 text-ui-caption transition-colors duration-150",
              theme === option.id ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <CodePreviewPane title={t("Code")} code={SAMPLE_CODE} language="typescript" />
        <CodePreviewPane title={t("Diff")} code={SAMPLE_DIFF} language="diff" />
      </div>
    </section>
  );
}

export function AppearanceSection({
  mode,
  onMode,
  zoomFactor = 1.0,
  onZoomFactor,
  locale,
  onLocale,
  codeTheme,
  onCodeTheme,
}: {
  mode: ColorMode;
  onMode: (mode: ColorMode) => void;
  zoomFactor?: number;
  onZoomFactor?: (factor: number) => void;
  locale?: Locale;
  onLocale?: (locale: Locale) => void;
  codeTheme?: CodeTheme;
  onCodeTheme?: (theme: CodeTheme) => void;
}) {
  const chords = useShortcuts();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-ui-caption font-medium text-ink">{t("Color")}</h2>
        <span className="text-ui-sm text-ink-3">{t("applies to the whole window")}</span>
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
              style={{ animation: `fade-up 380ms var(--ease-out-strong-css) ${index * 45}ms both` }}
              className={cn(
                "pressable-soft pressable flex flex-col gap-2 rounded-card p-3 text-left shadow-card",
                active ? "bg-accent-tint" : "bg-surface hover:bg-hover",
              )}
            >
              <span
                className="flex h-14 w-full items-center gap-1.5 overflow-hidden rounded-chip px-2 shadow-hairline"
                style={{ background: preview.page }}
              >
                <span className="h-8 w-6 shrink-0 rounded-tiny" style={{ background: preview.surface }} />
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
                  <span className="text-ui-sm text-ink-3">◐</span>
                )}
                <span className={cn("text-ui-caption", active ? "font-medium text-ink" : "text-ink-2")}>{t(entry.label)}</span>
                {active ? <span className="ml-auto size-1.5 rounded-full bg-accent" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {codeTheme && onCodeTheme ? (
        <div className="mt-4">
          <CodeStyleSection theme={codeTheme} onTheme={onCodeTheme} />
        </div>
      ) : null}

      {onLocale ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-ui-caption font-medium text-ink">{t("Language")}</h2>
            <span className="text-ui-sm text-ink-3">
              {t("Interface language for the app chrome; agent output is never translated")}
            </span>
          </div>
          <div className="flex w-fit items-center gap-0.5 rounded-chip bg-field p-0.5">
            {([
              { value: "zh", label: "中文" },
              { value: "en", label: "English" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onLocale(option.value)}
                aria-pressed={locale === option.value}
                className={cn(
                  "pressable h-6 rounded-chip px-3 text-ui-caption transition-colors duration-150",
                  locale === option.value ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-3 hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {onZoomFactor ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-ui-caption font-medium text-ink">{t("Interface scale")}</h2>
            <span className="text-ui-sm text-ink-3">
              {tf("{adjust} to adjust, {reset} to reset", {
                adjust: `${formatChord(chords.zoomIn)} / ${formatChord(chords.zoomOut)}`,
                reset: formatChord(chords.zoomReset),
              })}
            </span>
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
                    "pressable flex flex-col items-center justify-center gap-0.5 rounded-control p-2 text-center shadow-hairline",
                    active ? "bg-ink font-medium text-canvas" : "bg-surface text-ink-2 hover:bg-hover",
                  )}
                >
                  <span className="text-ui-caption">{opt.label}</span>
                  <span className={cn("text-ui-xs", active ? "text-canvas/75" : "text-ink-3")}>{t(opt.desc)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
