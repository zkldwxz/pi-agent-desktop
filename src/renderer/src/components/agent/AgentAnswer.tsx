import CodeBlock from "../beautiful/primitives/CodeBlock";
import StreamingText from "../beautiful/primitives/StreamingText";
import { StreamText } from "../motion";
import { Markdown } from "../Markdown";
import { CacheRing } from "./CacheRing";
import { GitBranchIcon } from "../icons";
import type { TurnView } from "../../lib/agent-view";

function CodeSegment({ lang, code }: { lang: string; code: string }) {
  const lines = code.split("\n");
  // a short listing reads better as the plain Code view; anything long scrolls
  return (
    <div className="max-w-[640px]">
      <CodeBlock variant="Code" lines={lines} code={code} filename={lang ? `snippet.${lang}` : "snippet"} />
    </div>
  );
}

/**
 * The answer.
 *
 * While tokens are still arriving the text goes through the backlog-aware
 * reveal (crisp, with a masked blur on the leading characters). Once the run
 * settles, prose and fenced code split apart so code gets `CodeBlock`, and an
 * answer with cited web sources is handed to `StreamingText` so its source
 * chips, action row and expandable source list appear.
 */
export function AgentAnswer({
  turn,
  onFork,
}: {
  turn: TurnView;
  /** branch the conversation from this turn's prompt */
  onFork?: (userIndex: number) => void;
}) {
  if (!turn.fullText.trim() && !turn.streaming) return null;

  if (turn.streaming) {
    return (
      <div
        className="max-w-[640px] rounded-[9px] bg-surface p-3 shadow-hairline"
        style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <StreamText
          text={turn.fullText}
          done={false}
          className="text-[13px] leading-[21px] whitespace-pre-wrap text-ink"
        />
      </div>
    );
  }

  const hasCode = turn.segments.some((segment) => segment.kind === "code");
  const prose = turn.segments.filter((segment) => segment.kind === "text");

  return (
    <div className="flex w-full flex-col gap-3">
      {turn.sources.length > 0 && !hasCode ? (
        <div className="max-w-[640px]">
          <StreamingText
            instant
            loop={false}
            fill
            content={prose.flatMap((segment, index) =>
              segment.kind === "text"
                ? [
                    ...segment.text.split(/(\s+)/).filter(Boolean).map((text) => ({ text })),
                    ...(index === prose.length - 1 ? [{ text: "", cite: true }] : []),
                  ]
                : [],
            )}
            sources={turn.sources}
            followUps={[]}
            labels={{ sources: `${turn.sources.length} source${turn.sources.length === 1 ? "" : "s"}`, followUps: "" }}
          />
        </div>
      ) : (
        turn.segments.map((segment, index) =>
          segment.kind === "code" ? (
            <CodeSegment key={index} lang={segment.lang} code={segment.code} />
          ) : (
            <div key={index} className="max-w-[640px]">
              <Markdown>{segment.text}</Markdown>
            </div>
          ),
        )
      )}

      {!turn.streaming || turn.usage ? (
        <div className="group/turn flex items-center gap-3">
          {turn.usage && turn.usage.total > 0 ? (
            <div className="flex items-center gap-3">
              <CacheRing stats={{ total: turn.usage.total, cacheRead: turn.usage.cacheRead ?? 0 }} />
              {turn.usage.model ? <span className="font-mono text-[10px] text-ink-3">{turn.usage.model}</span> : null}
            </div>
          ) : null}
          {/* Fork: an icon only, invisible until the pointer is in this turn —
              the label is the tooltip, so the row keeps its footprint without
              carrying a permanent button's worth of chrome. */}
          {!turn.streaming && onFork ? (
            <button
              type="button"
              onClick={() => onFork(turn.userIndex)}
              title="Fork here"
              aria-label="Fork here"
              className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-ink-2 focus-visible:opacity-100 group-hover/turn:opacity-100"
            >
              <GitBranchIcon size={13} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
