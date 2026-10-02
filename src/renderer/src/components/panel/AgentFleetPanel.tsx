import { useState } from "react";
import type { FleetAgent } from "@shared/types";
import { cn } from "../../lib/cn";
import { t, useLocale } from "../../lib/i18n";
import { Markdown } from "../Markdown";
import { EmptyState } from "../ui";
import { CheckIcon, ChevronDownIcon, LoaderIcon, UsersIcon, XIcon } from "../icons";

/**
 * The delegation fleet, live.
 *
 * Every row is one sub-agent the model spawned through the agent-team
 * extension: what it was asked, what it is running on, what it has spent, and
 * — once it settles — the answer it is returning. Interrupt is the same call
 * the model can make with interrupt_agent; the panel just puts the button
 * where the user can reach it too.
 *
 * The panel is mounted on demand (ToolDock), but it is not something to go
 * looking for: App opens it when the first sub-agent spawns, and the dock's
 * strip shows its tab only while a fleet exists.
 */

const STATUS_LABEL: Record<FleetAgent["status"], string> = {
  running: "Running",
  completed: "Completed",
  interrupted: "Interrupted",
  errored: "Errored",
};

function StatusMark({ status }: { status: FleetAgent["status"] }) {
  if (status === "running") return <LoaderIcon size={11} className="spin-fast shrink-0 text-accent" />;
  if (status === "completed") return <CheckIcon size={11} className="shrink-0 text-green" />;
  if (status === "interrupted") return <span aria-hidden className="size-[7px] shrink-0 rounded-full border border-line-strong" />;
  return <XIcon size={11} className="shrink-0 text-red" />;
}

/** `1m 24s` — coarse, the way the plugin updates it (about once a second) */
function elapsed(agent: FleetAgent): string {
  const ms = (agent.endedAt ?? Date.now()) - agent.spawnedAt;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function tokens(agent: FleetAgent): string | undefined {
  const total = agent.tokens?.total;
  if (!total) return undefined;
  return total >= 100_000 ? `${Math.round(total / 1000)}k` : total.toLocaleString();
}

function AgentRow({ agent, onInterrupt }: { agent: FleetAgent; onInterrupt: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const usage = tokens(agent);
  const cost = typeof agent.cost === "number" && agent.cost > 0 ? `$${agent.cost.toFixed(agent.cost < 0.1 ? 4 : 2)}` : undefined;
  const meta = [usage ? `${usage} tok` : undefined, cost, elapsed(agent)].filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-card bg-surface shadow-hairline"
      style={{ animation: "row-enter 240ms var(--ease-out-strong-css) both" }}
    >
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-start gap-[8px] px-[12px] py-[10px] text-left">
        <span className="mt-[3px]">
          <StatusMark status={agent.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-mono text-ui-base font-medium text-ink">{agent.name}</span>
            <span className="shrink-0 text-ui-xs uppercase tracking-wide text-ink-3">{t(STATUS_LABEL[agent.status])}</span>
          </span>
          <span className="mt-0.5 block truncate text-ui-caption leading-snug text-ink-2">{agent.task || "—"}</span>
          <span className="mt-1 flex items-center gap-2 text-ui-sm text-ink-3">
            {agent.model ? <span className="truncate">{agent.model}</span> : null}
            {meta ? <span className="shrink-0">{meta}</span> : null}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          {agent.status === "running" ? (
            <span
              role="button"
              tabIndex={0}
              title={t("Interrupt")}
              aria-label={t("Interrupt")}
              onClick={(event) => {
                event.stopPropagation();
                onInterrupt(agent.name);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.stopPropagation();
                onInterrupt(agent.name);
              }}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-red"
            >
              <XIcon size={12} />
            </span>
          ) : null}
          {agent.summary ? (
            <ChevronDownIcon size={12} className={cn("text-ink-3 transition-transform duration-200", open && "rotate-180")} />
          ) : null}
        </span>
      </button>
      {open && agent.summary ? (
        /* the summary is the sub-agent's own answer, and an answer is markdown —
           it used to be laid down as pre-wrapped text, so `##`, `**` and fences
           arrived as their own source */
        <div className="border-t border-line px-[12px] py-[8px]">
          <Markdown variant="panel">{agent.summary}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

export function AgentFleetPanel({ fleet, onInterrupt }: { fleet: FleetAgent[]; onInterrupt: (name?: string) => void }) {
  useLocale();
  const running = fleet.filter((agent) => agent.status === "running").length;

  if (!fleet.length) {
    return (
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-[12px]">
        <div className="my-auto">
          <EmptyState
            title={t("No sub-agents")}
            body={t("When the model delegates work — Ultra's proactive mode does this on its own — the sub-agents appear here with their status and results.")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[40px] shrink-0 items-center gap-2 border-b border-line px-[12px]">
        <UsersIcon size={14} className="text-ink-3" />
        <span className="text-ui-base font-medium text-ink">{t("Agent team")}</span>
        <span className="text-ui-sm text-ink-3">
          {running}/{fleet.length}
        </span>
        <span className="flex-1" />
        {running > 1 ? (
          <button
            type="button"
            title={t("Interrupt all")}
            onClick={() => onInterrupt()}
            className="pressable rounded-chip px-2 py-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-red"
          >
            {t("Interrupt all")}
          </button>
        ) : null}
      </header>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[12px]">
        {[...fleet].reverse().map((agent) => (
          <AgentRow key={agent.name} agent={agent} onInterrupt={(name) => onInterrupt(name)} />
        ))}
      </div>
    </div>
  );
}
