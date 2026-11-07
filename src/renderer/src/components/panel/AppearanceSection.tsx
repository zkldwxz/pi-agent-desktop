import { useEffect, useState } from "react";
import type { ColorMode } from "../../lib/theme";
import { cn } from "../../lib/cn";
import { t, tf, type Locale } from "../../lib/i18n";
import { formatChord, useShortcuts } from "../../lib/keybindings";
import { CODE_THEMES, type CodeTheme } from "../../lib/code-theme";
import { highlightLines } from "../../lib/highlight";
import { Row, Section, Select, Switch } from "./SettingsParts";
import { loadAppearance, onAppearance, saveAppearance, type AppearancePrefs } from "../../lib/appearance-prefs";

/**
 * Settings ▸ Appearance, laid out as baocode's appearance page
 * (lib/settings/pages/appearance_page.dart): groups of rows, each a label and
 * its description with the control on the right — a dropdown or a switch —
 * and the code style's preview under its row.
 */

const SCALE_OPTIONS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.25];

/*
 * The code style preview: the same renderer the transcript's code blocks use,
 * pointed at a fixed snippet, so what you pick is what a real listing gets —
 * code and diff side by side (does this palette read as code; do the add/del
 * accents still say added and removed in it).
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
  '  await freezer.store(base, { temp: "-16C" });',
].join("\n");

/** One line of highlighted HTML per row — the same split the transcript's code
 *  blocks use, so the preview colours exactly what a real listing colours. */
function CodePreviewPane({ code, language }: { code: string; language: string }) {
  /* the tone is read off the *raw* line: once highlighted, a `+` sits inside a
     `<span class="hljs-addition">`, and testing the HTML for a leading sign
     silently left every diff row unwashed */
  const raw = code.split("\n");
  const lines = highlightLines(code, language) ?? raw;
  return (
    <div className="scrollbar-thin min-w-0 overflow-x-auto rounded-card border border-code-border bg-code-block px-3 py-2">
      <code className="hljs block font-mono text-ui-meta leading-[1.5]">
        {lines.map((line, index) => {
          const text = raw[index] ?? "";
          const kind = language === "diff" ? (text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "ctx") : "ctx";
          return (
            <div
              key={index}
              className={cn("-mx-3 px-3 whitespace-pre", kind === "add" && "bg-green-tint", kind === "del" && "bg-red-tint")}
              dangerouslySetInnerHTML={{ __html: line || " " }}
            />
          );
        })}
      </code>
    </div>
  );
}

/** The code font field commits on blur / Enter, not per keystroke: a half-typed
 *  family name would flash every code block through the fallback. */
function CodeFontField({ value, onCommit }: { value: string; onCommit: (font: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      value={draft}
      spellCheck={false}
      placeholder="JetBrains Mono"
      aria-label={t("Font name")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(value);
      }}
      className="h-[26px] w-[200px] rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink outline-none placeholder:text-ink-4 focus:border-accent"
    />
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
  /* the window-level prefs own their state; CSS reads them off <html> */
  const [prefs, setPrefs] = useState<AppearancePrefs>(loadAppearance);
  useEffect(() => onAppearance(setPrefs), []);
  const update = (patch: Partial<AppearancePrefs>) => saveAppearance({ ...prefs, ...patch });
  const scale = SCALE_OPTIONS.reduce((best, value) => (Math.abs(value - zoomFactor) < Math.abs(best - zoomFactor) ? value : best), 1);

  return (
    <div className="flex flex-col gap-5">
      <Section title={t("Theme")}>
        <Row title={t("Color")} hint={t("applies to the whole window")}>
          <Select
            value={mode}
            options={[
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
              { value: "system", label: t("System") },
            ]}
            onChange={(value) => onMode(value as ColorMode)}
          />
        </Row>
        {codeTheme && onCodeTheme ? (
          <Row
            title={t("Code style")}
            hint={t("the palette of code blocks; follows light and dark")}
            below={
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CodePreviewPane code={SAMPLE_CODE} language="typescript" />
                <CodePreviewPane code={SAMPLE_DIFF} language="diff" />
              </div>
            }
          >
            <Select
              value={codeTheme}
              options={CODE_THEMES.map((option) => ({ value: option.id, label: option.label }))}
              onChange={(value) => onCodeTheme(value as CodeTheme)}
            />
          </Row>
        ) : null}
      </Section>

      <Section title={t("Fonts")}>
        <Row title={t("Code font")} hint={t("code blocks, paths and the terminal; empty uses JetBrains Mono, Menlo or Consolas")}>
          <CodeFontField value={prefs.codeFont} onCommit={(codeFont) => update({ codeFont })} />
        </Row>
        <Row title={t("Font ligatures")} hint={<span className="font-mono">{"=> != === <= >= ->"}</span>}>
          <Switch on={prefs.ligatures} onClick={() => update({ ligatures: !prefs.ligatures })} />
        </Row>
      </Section>

      <Section title={t("Conversation")}>
        <Row title={t("Conversation width")} hint={t("full width uses the whole pane on wide windows")}>
          <Select
            value={prefs.chatWidth}
            options={[
              { value: "default", label: t("Default") },
              { value: "full", label: t("Full width") },
            ]}
            onChange={(value) => update({ chatWidth: value === "full" ? "full" : "default" })}
          />
        </Row>
        <Row title={t("Show times in the sidebar")} hint={t("when each session was last active")}>
          <Switch on={prefs.sidebarTimes} onClick={() => update({ sidebarTimes: !prefs.sidebarTimes })} />
        </Row>
      </Section>

      <Section title={t("Interface")}>
        {onLocale ? (
          <Row title={t("Language")} hint={t("Interface language for the app chrome; agent output is never translated")}>
            <Select
              value={locale ?? "zh"}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
              onChange={(value) => onLocale(value as Locale)}
            />
          </Row>
        ) : null}
        {onZoomFactor ? (
          <Row
            title={t("Interface scale")}
            hint={tf("{adjust} to adjust, {reset} to reset", {
              adjust: `${formatChord(chords.zoomIn)} / ${formatChord(chords.zoomOut)}`,
              reset: formatChord(chords.zoomReset),
            })}
          >
            <Select
              value={String(scale)}
              options={SCALE_OPTIONS.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
              onChange={(value) => onZoomFactor(Number(value))}
            />
          </Row>
        ) : null}
      </Section>
    </div>
  );
}
