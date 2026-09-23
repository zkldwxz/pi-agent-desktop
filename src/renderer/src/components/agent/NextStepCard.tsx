import { useMemo } from "react";
import type { ChatMessage, HostState } from "@shared/types";
import RecommendationCard, {
  type RecommendationOption,
} from "../beautiful/primitives/RecommendationCard";
import { buildTurns, toolSignature } from "../../lib/agent-view";
import { t, tf, useLocale } from "../../lib/i18n";
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
  const locale = useLocale();
  const turns = useMemo(() => buildTurns(messages, []), [messages]);
  const signature = toolSignature(turns);

  const options = useMemo<RecommendationOption[]>(() => {
    const out: RecommendationOption[] = [];

    const pending = state.todos.filter((todo) => todo.status === "pending" || todo.status === "running");
    if (pending.length) {
      out.push({
        key: "continue",
        body: (
          <>
            {t("Continue with")} <strong className="font-medium text-ink">{pending[0].label}</strong>
            {pending.length > 1 ? ` ${tf("and {count} more", { count: pending.length - 1 })}` : ""}
          </>
        ),
        short: pending[0].label,
        signal: Math.min(3, pending.length),
        tone: "var(--accent)",
        label: tf(pending.length === 1 ? "{count} open task" : "{count} open tasks", { count: pending.length }),
        cta: t("Continue"),
        ctaVariant: "accent",
      });
    }

    const changes = collectChanges(turns);
    if (changes.length) {
      const added = changes.reduce((sum, change) => sum + change.add, 0);
      const removed = changes.reduce((sum, change) => sum + change.del, 0);
      out.push({
        key: "review",
        body: (
          <>
            {tf(
              changes.length === 1
                ? "Review the {count} file edited this session"
                : "Review the {count} files edited this session",
              { count: changes.length },
            )}{" "}
            — <span className="text-green">+{added}</span> <span className="text-red">−{removed}</span>
          </>
        ),
        short: `${changes.length} files, +${added} −${removed}`,
        signal: changes.length > 3 ? 3 : 2,
        tone: "var(--orange)",
        label: t("unreviewed edits"),
        cta: t("Review"),
        ctaVariant: "secondary",
      });
    }

    const usage = state.snapshot?.stats?.contextUsage;
    if (usage?.percent != null && usage.percent > 60) {
      out.push({
        key: "compact",
        body: (
          <>
            {tf("Context is at {percent}% of {tokens} tokens — compact before it starts trimming", {
              percent: usage.percent,
              tokens: usage.contextWindow.toLocaleString(),
            })}
          </>
        ),
        short: `${usage.percent}% of the window`,
        signal: usage.percent > 85 ? 3 : 2,
        tone: usage.percent > 85 ? "var(--red)" : "var(--orange)",
        label: usage.percent > 85 ? t("critical") : t("watch"),
        cta: t("Compact"),
        ctaVariant: "secondary",
      });
    }

    const failedRuns = turns.flatMap((turn) => turn.toolRuns).filter((run) => run.status === "error");
    if (failedRuns.length) {
      out.push({
        key: "retry",
        body: (
          <>
            {t("Retry")} <strong className="font-medium text-ink">{failedRuns[0].label}</strong> —{" "}
            {tf(
              failedRuns.length === 1
                ? "{count} tool call failed this session"
                : "{count} tool calls failed this session",
              { count: failedRuns.length },
            )}
          </>
        ),
        short: failedRuns[0].chip,
        signal: 2,
        tone: "var(--red)",
        label: t("failed"),
        cta: t("Retry"),
        ctaVariant: "secondary",
      });
    }

    return out;
  }, [state.todos, state.snapshot, signature, locale]); // eslint-disable-line react-hooks/exhaustive-deps

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
          title: t("Where to go next"),
          alternatives: t("Alternatives"),
          otherOptions: t("Other options"),
          accepted: t("Sent"),
        }}
        onAccept={(key) => onSend(prompts[key] ?? options[0].short)}
      />
    </div>
  );
}
