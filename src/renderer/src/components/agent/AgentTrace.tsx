import ThinkingState from "../beautiful/primitives/ThinkingState";

/**
 * One reasoning beat of the turn.
 *
 * A turn can think several times — before the first tool call, between calls,
 * before the answer — and each beat renders as its own trace in the position
 * it happened, rather than every paragraph concatenated into one block at the
 * top. While the beat is the live one the header shimmers; once the turn moves
 * past it the header settles to "Thought" and the rows collapse.
 */
export function AgentTrace({
  text,
  working,
}: {
  text: string;
  /** true only for the beat the agent is currently producing */
  working: boolean;
}) {
  const rows = text
    .split(/\n{2,}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((primary, index) => ({ id: `reason-${index}`, primary }));
  if (!rows.length) return null;

  return (
    <div className="w-full max-w-[560px]">
      <ThinkingState
        variant="Reasoning"
        rows={rows}
        active="Thinking"
        done={working ? "Thinking" : "Thought"}
        instant
        working={working}
      />
    </div>
  );
}
