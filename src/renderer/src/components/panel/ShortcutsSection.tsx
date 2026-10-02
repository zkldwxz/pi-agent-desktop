import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { t, tf, useLocale } from "../../lib/i18n";
import {
  SHORTCUTS,
  beginCapture,
  chordFromEvent,
  chordOf,
  endCapture,
  findConflicts,
  formatChord,
  isDefault,
  resetAll,
  resetChord,
  setChord,
  useShortcuts,
  type Chord,
  type ShortcutGroup,
} from "../../lib/keybindings";
import { Chip } from "../ui";
import { Row, Section } from "./SettingsParts";

const GROUPS: ShortcutGroup[] = ["Conversation", "Views & panels", "Interface scale"];

/** What a row shows while it waits for you to press something. */
const CAPTURE_HINT = "Press the new combination";

function Kbd({ chord, muted }: { chord: Chord | null; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[68px] items-center justify-center rounded-chip border border-line bg-field px-2 font-mono text-ui-sm",
        muted ? "text-ink-3" : "text-ink-2",
      )}
    >
      {chord ? formatChord(chord) : t("Unassigned")}
    </span>
  );
}

export function ShortcutsSection() {
  useLocale();
  /* the map is rebuilt whenever a chord is rebound, so the rows follow the edit */
  const chords = useShortcuts();
  const [recording, setRecording] = useState<string | null>(null);
  const conflicts = useMemo(() => findConflicts(), [chords]);

  useEffect(() => {
    if (!recording) return;
    beginCapture();
    const stop = (event: KeyboardEvent) => {
      /* swallow it: a row being recorded must not scroll the list, close an
         overlay or fire the very shortcut being rebound */
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        setChord(recording, null);
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;
      setChord(recording, chord);
      setRecording(null);
    };
    window.addEventListener("keydown", stop, { capture: true });
    return () => {
      window.removeEventListener("keydown", stop, { capture: true });
      endCapture();
    };
  }, [recording]);

  const labelOf = (id: string) => t(SHORTCUTS.find((spec) => spec.id === id)?.label ?? id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="text-ui-caption font-medium text-ink">{t("Keyboard shortcuts")}</h2>
        <span className="min-w-0 truncate text-ui-sm text-ink-3">
          {t("Click a shortcut, then press the combination you want")}
        </span>
      </div>

      {GROUPS.map((group, groupIndex) => (
        <Section
          key={group}
          title={t(group)}
          index={groupIndex}
          actions={
            groupIndex === 0 ? (
              <Chip onClick={resetAll} title={t("Reset all to defaults")}>
                {t("Reset all to defaults")}
              </Chip>
            ) : undefined
          }
        >
          {SHORTCUTS.filter((spec) => spec.group === group).map((spec) => {
            const chord = chordOf(spec.id);
            const clash = conflicts.get(spec.id);
            const isRecording = recording === spec.id;
            const fallback = formatChord(spec.fallback);
            return (
              <Row
                key={spec.id}
                title={t(spec.label)}
                hint={
                  clash?.length
                    ? tf("Also used by {other}", { other: clash.map(labelOf).join("、") })
                    : isDefault(spec.id) || !chord
                      ? undefined
                      : tf("Default: {chord}", { chord: fallback })
                }
              >
                {spec.rebindable === false ? (
                  <Kbd chord={chord} muted />
                ) : (
                  <button
                    type="button"
                    aria-label={t(spec.label)}
                    onClick={() => setRecording(isRecording ? null : spec.id)}
                    className={cn(
                      "pressable inline-flex h-6 min-w-[68px] items-center justify-center rounded-chip border px-2 font-mono text-ui-sm transition-colors duration-150",
                      isRecording
                        ? "border-accent bg-accent-tint text-accent"
                        : chord
                          ? "border-line bg-field text-ink-2 hover:bg-hover-2"
                          : "border-dashed border-line-strong bg-field text-ink-3 hover:bg-hover-2",
                    )}
                  >
                    {isRecording ? t(CAPTURE_HINT) : chord ? formatChord(chord) : t("Unassigned")}
                  </button>
                )}
                {!isDefault(spec.id) && spec.rebindable !== false ? (
                  <button
                    type="button"
                    aria-label={t("Reset")}
                    title={tf("Default: {chord}", { chord: fallback })}
                    onClick={() => resetChord(spec.id)}
                    className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover-2 hover:text-ink"
                  >
                    ⟲
                  </button>
                ) : null}
              </Row>
            );
          })}
        </Section>
      ))}

      <p className="px-1 text-ui-sm leading-relaxed text-ink-3">{t("Esc to cancel, Backspace to clear")}</p>
    </div>
  );
}
