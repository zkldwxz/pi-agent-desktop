import { memo } from "react";
import CodeBlock from "../beautiful/primitives/CodeBlock";
import StreamingText from "../beautiful/primitives/StreamingText";
import { StreamText } from "../motion";
import { Markdown } from "../Markdown";
import { splitSegments, type TurnItem, type TurnView } from "../../lib/agent-view";

function CodeSegment({ lang, code }: { lang: string; code: string }) {
  const lines = code.split("\n");
  // a short listing reads better as the plain Code view; anything long scrolls
  return (
    <div className="max-w-[640px]">
      <CodeBlock variant="Code" lines={lines} code={code} filename={lang ? `snippet.${lang}` : "snippet"} />
    </div>
  );
}

type TextItem = Extract<TurnItem, { kind: "text" }>;

/**
 * One prose beat of the answer.
 *
 * A turn can speak several times — a sentence before the tool calls, the final
 * answer after them — and each beat renders where it happened. While the beat
 * is the live one it goes through the backlog-aware reveal; once the turn moves
 * past it, prose and fenced code split apart so code gets `CodeBlock`.
 *
 * Only the last beat carries the turn's furniture: cited sources, the usage
 * ring and the fork button.
 */
export const AgentAnswer = memo(function AgentAnswer({
  turn,
  item,
  isLast,
  streaming,
}: {
  turn: TurnView;
  item: TextItem;
  /** the last beat of the turn carries sources, usage and the fork button */
  isLast: boolean;
  streaming: boolean;
}) {
  if (!item.text.trim() && !streaming) return null;

  if (streaming) {
    // no card chrome while tokens arrive: the settled prose is plain text at
    // exactly these metrics, so the moment the stream hands over to markdown
    // nothing shifts — same box, same type, no jump
    return (
      <div
        className="max-w-[640px]"
        style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <StreamText
          markdown
          text={item.text}
          done={false}
          className="text-[13px] leading-[21px] text-ink"
        />
      </div>
    );
  }

  const segments = splitSegments(item.text);
  const hasCode = segments.some((segment) => segment.kind === "code");
  const prose = segments.filter((segment) => segment.kind === "text");
  const withSources = isLast && turn.sources.length > 0 && !hasCode;

  return (
    <div className="flex w-full flex-col gap-3">
      {withSources ? (
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
        segments.map((segment, index) =>
          segment.kind === "code" ? (
            <CodeSegment key={index} lang={segment.lang} code={segment.code} />
          ) : (
            <div key={index} className="max-w-[640px]">
              <Markdown>{segment.text}</Markdown>
            </div>
          ),
        )
      )}

      {/* no per-answer usage line here: the turn's closing row already reports
          duration, tokens and cache share, and the two stacked rows repeated
          the same numbers twice */}
    </div>
  );
});
