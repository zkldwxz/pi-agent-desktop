import { useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { BrainIcon, CodeIcon, EyeIcon, GitBranchIcon, LayersIcon, ListChecksIcon, RefreshIcon, SearchIcon, WrenchIcon } from "../icons";

/**
 * The new-conversation entrance, and the starter prompts under the composer.
 *
 * The entrance is four elements rising out of a blur, staggered — greeting,
 * then the question, then the composer, then the suggestions, so the eye is
 * led down the page in the order it will use it.
 *
 * It is one CSS animation with `animation-fill-mode: backwards` rather than
 * staged React state. A delay holds the first frame, and when the animation
 * ends the styles go back to the cascade — which matters here more than it
 * looks like it does: a filled `transform` would turn this wrapper into a
 * permanent stacking context (and a containing block that traps fixed
 * overlays), and four timers would re-render the whole empty state on each
 * step.
 */

/** ms after mount. The gaps are not even: the copy leads, the controls land
 *  close behind it, and the suggestions arrive last as the quiet part. */
export const HOME_STEPS = {
  greeting: 170,
  question: 330,
  composer: 400,
  suggestions: 550,
} as const;

export function Reveal({
  at,
  className,
  style,
  children,
}: {
  at: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cn("home-reveal", className)} style={{ ...style, animationDelay: `${at}ms` }}>
      {children}
    </div>
  );
}

/** Starter prompts. They are *starts*, not capabilities — every one of them is
 *  something the agent does by reading and running, not a feature it has to
 *  own — so the list can stay short without lying about what is possible. */
const SUGGESTIONS: Array<{ text: string; icon: ReactNode }> = [
  { text: "Read this repo and tell me where to start.", icon: <EyeIcon size={14} /> },
  { text: "Run typecheck and the regressions, then fix what fails.", icon: <ListChecksIcon size={14} /> },
  { text: "Turn the current changes into a commit message.", icon: <GitBranchIcon size={14} /> },
  { text: "Explain why this code is written this way.", icon: <BrainIcon size={14} /> },
  { text: "Add unit tests for the function I have selected.", icon: <CodeIcon size={14} /> },
  { text: "Plan it first — show me the approach before touching files.", icon: <LayersIcon size={14} /> },
  { text: "Find the duplicated logic and give it one owner.", icon: <SearchIcon size={14} /> },
  { text: "Trace this error to its cause and fix it there.", icon: <WrenchIcon size={14} /> },
];

const SHOWN = 3;

export function SuggestionRail({
  at,
  onPick,
}: {
  at: number;
  onPick: (text: string) => void;
}) {
  const [offset, setOffset] = useState(() => Math.floor(Math.random() * SUGGESTIONS.length));
  const shown = Array.from({ length: SHOWN }, (_, i) => SUGGESTIONS[(offset + i) % SUGGESTIONS.length]);

  return (
    <Reveal at={at} className="mt-5 w-full max-w-[720px]">
      <div className="-mx-2 flex flex-col">
        {shown.map((item) => (
          <button
            key={item.text}
            type="button"
            onClick={() => onPick(item.text)}
            className="pressable flex items-center gap-3 rounded-control px-2 py-2.5 text-left text-ui-lg text-ink transition-colors duration-150 hover:bg-hover"
          >
            <span className="shrink-0 text-ink-3">{item.icon}</span>
            <span className="min-w-0 truncate">{t(item.text)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOffset((current) => (current + SHOWN) % SUGGESTIONS.length)}
        className="pressable mt-1 flex items-center gap-1.5 rounded-chip px-2 py-1 text-ui-caption text-ink-3 transition-colors duration-150 hover:text-ink"
      >
        <RefreshIcon size={12} />
        {t("Shuffle suggestions")}
      </button>
    </Reveal>
  );
}
