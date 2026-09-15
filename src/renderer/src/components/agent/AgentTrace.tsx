import ThinkingState from "../beautiful/primitives/ThinkingState";
import type { TurnView } from "../../lib/agent-view";
import { traceLabel, traceRows } from "../../lib/agent-view";

/**
 * The agent's reasoning trace.
 *
 * This is the *thinking* only: `ThinkingState`'s Reasoning variant, one row per
 * reasoning paragraph. The tool calls the agent made are not repeated here — they
 * are bucketed into summary rows by `AgentToolRun` below, which is what stopped
 * the transcript from printing every `Read` twice.
 *
 * While the agent is reasoning the trace is open and its header shimmers; the
 * moment it settles the header becomes a one-line label ("Thought") and the rows
 * collapse, so a finished turn leads with the answer.
 */
export function AgentTrace({ turn }: { turn: TurnView }) {
  if (!turn.traceVariant) return null;

  const rows = traceRows(turn);
  if (!rows.length) return null;

  const label = traceLabel(turn.traceVariant, turn.streaming, rows.length);

  return (
    <div className="w-full max-w-[560px]">
      <ThinkingState
        variant={turn.traceVariant}
        rows={rows}
        active={label.active}
        done={label.done}
        instant
        working={turn.streaming}
      />
    </div>
  );
}
