import { useMemo } from "react";
import type { ChatMessage, HostState } from "@shared/types";
import RecommendationCard, {
  type RecommendationOption,
} from "../beautiful/primitives/RecommendationCard";
import { buildTurns } from "../../lib/agent-view";
import { collectChanges } from "../panel/ChangesPanel";

/**
 * What to do next.
 *
 * Built entirely from session state — pending tasks, files this session edited,
 * context pressure — so a suggestion only appears when there is something real
 * behind it. Each option carries the count that justifies it, and accepting one
 * sends an actual prompt.
 */
export function NextStepCard({
  state,
  messages,
  onSend,
}: {
  state: HostState;
  messages: ChatMessage[];
  onSend: (text: string) => void;
}) {
  const options = useMemo<RecommendationOption[]>(() => {
    const out: RecommendationOption[] = [];

    const pending = state.todos.filter((todo) => todo.status === "pending" || todo.status === "running");
    if (pending.length) {
      out.push({
        key: "continue",
        body: (
          <>
            Continue with <strong className="font-medium text-ink">{pending[0].label}</strong>
            {pending.length > 1 ? ` and ${pending.length - 1} more` : ""}
          </>
        ),
        short: pending[0].label,
        signal: Math.min(3, pending.length),
        tone: "var(--accent)",
        label: `${pending.length} open task${pending.length === 1 ? "" : "s"}`,
        cta: "Continue",
        ctaVariant: "accent",
      });
    }

    const changes = collectChanges(messages);
    if (changes.length) {
      const added = changes.reduce((sum, change) => sum + change.add, 0);
      const removed = changes.reduce((sum, change) => sum + change.del, 0);
      out.push({
        key: "review",
        body: (
          <>
            Review the <strong className="font-medium text-ink">{changes.length}</strong> file
            {changes.length === 1 ? "" : "s"} edited this session —{" "}
            <span className="text-green">+{added}</span> <span className="text-red">−{removed}</span>
          </>
        ),
        short: `${changes.length} files, +${added} −${removed}`,
        signal: changes.length > 3 ? 3 : 2,
        tone: "var(--orange)",
        label: "unreviewed edits",
        cta: "Review",
        ctaVariant: "secondary",
      });
    }

    const usage = state.snapshot?.stats?.contextUsage;
    if (usage?.percent != null && usage.percent > 60) {
      out.push({
        key: "compact",
        body: (
          <>
            Context is at <strong className="font-medium text-ink">{usage.percent}%</strong> of{" "}
            {usage.contextWindow.toLocaleString()} tokens — compact before it starts trimming
          </>
        ),
        short: `${usage.percent}% of the window`,
        signal: usage.percent > 85 ? 3 : 2,
        tone: usage.percent > 85 ? "var(--red)" : "var(--orange)",
        label: usage.percent > 85 ? "critical" : "watch",
        cta: "Compact",
        ctaVariant: "secondary",
      });
    }

    const failedRuns = buildTurns(messages, [])
      .flatMap((turn) => turn.toolRuns)
      .filter((run) => run.status === "error");
    if (failedRuns.length) {
      out.push({
        key: "retry",
        body: (
          <>
            Retry <strong className="font-medium text-ink">{failedRuns[0].label}</strong> —{" "}
            {failedRuns.length} tool call{failedRuns.length === 1 ? "" : "s"} failed this session
          </>
        ),
        short: failedRuns[0].chip,
        signal: 2,
        tone: "var(--red)",
        label: "failed",
        cta: "Retry",
        ctaVariant: "secondary",
      });
    }

    return out;
  }, [state.todos, state.snapshot, messages]);

  if (!options.length || state.snapshot?.isStreaming) return null;

  const prompts: Record<string, string> = {
    continue: `Continue with: ${options[0]?.short ?? ""}`,
    review: "Review the files you edited this session and call out anything that looks wrong.",
    compact: "Compact the conversation context.",
    retry: `Retry the failed step: ${options.find((option) => option.key === "retry")?.short ?? ""}`,
  };

  return (
    <div className="mx-auto mb-3 w-full max-w-[720px]" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <RecommendationCard
        options={options}
        labels={{
          title: "Where to go next",
          alternatives: "Alternatives",
          otherOptions: "Other options",
          accepted: "Sent",
        }}
        onAccept={(key) => onSend(prompts[key] ?? options[0].short)}
      />
    </div>
  );
}
