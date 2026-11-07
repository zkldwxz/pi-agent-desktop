import { memo } from "react";
import StreamingText from "../beautiful/primitives/StreamingText";
import { StreamText } from "../motion";
import { ChatCode, Markdown } from "../Markdown";
import { splitSegments, type TurnItem, type TurnView } from "../../lib/agent-view";

/* fenced code in an answer: the same quiet panel Markdown draws, so a block
   reads the same whichever path split it out of the prose */
function CodeSegment({ lang, code }: { lang: string; code: string }) {
  return <ChatCode lang={lang} text={code} />;
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
    // nothing shifts — same box, same type, no jump. Prose spans the full
    // conversation column (ZCode's own measure), which is also what keeps the
    // prompt shell below from outgrowing the text it answers.
    return (
      <div style={{ animation: "fade-up 300ms var(--ease-out-strong-css) both" }}>
        <StreamText
          markdown
          text={item.text}
          done={false}
          className="text-ui-base leading-[21px] text-ink"
        />
      </div>
    );
  }

  const segments = splitSegments(item.text);
  const hasCode = segments.some((segment) => segment.kind === "code");
  const withSources = isLast && turn.sources.length > 0 && !hasCode;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* the prose always goes through Markdown. It used to be handed to
          StreamingText as a word-token list when the turn cited sources — and a
          token list cannot carry structure, so the settled answer of every
          search turned into literal `##`, `-` and `**` on screen. */}
      {segments.map((segment, index) =>
        segment.kind === "code" ? (
          <CodeSegment key={index} lang={segment.lang} code={segment.code} />
        ) : (
          <div key={index}>
            <Markdown>{segment.text}</Markdown>
          </div>
        ),
      )}

      {withSources ? (
        <StreamingText
          instant
          loop={false}
          fill
          content={[]}
          sources={turn.sources}
          followUps={[]}
          labels={{ sources: `${turn.sources.length} source${turn.sources.length === 1 ? "" : "s"}`, followUps: "" }}
        />
      ) : null}

      {/* no per-answer usage line here: the turn's closing row already reports
          duration, tokens and cache share, and the two stacked rows repeated
          the same numbers twice */}
    </div>
  );
});
