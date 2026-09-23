import { useMemo, useState } from "react";
import type { ChatMessage, HostState } from "@shared/types";
import TaskRows, { type TaskRow } from "../beautiful/primitives/TaskRows";
import { buildTurns, toolSignature } from "../../lib/agent-view";
import { t } from "../../lib/i18n";
import { SessionOutline } from "./SessionOutline";
import { EmptyState } from "../ui";
import { cn } from "../../lib/cn";
import FilterTable, { type TableRow } from "../beautiful/primitives/FilterTable";
import { SlidingGroup } from "../motion";

/**
 * The task list.
 *
 * `TaskRows` is a to-do list, not a generic row renderer: three states
 * (running with a progress ring, completed with a check, failed with a cross),
 * an optional count, and expandable detail steps. The agent drives it through
 * the `todo_write` tool, and the state is persisted with `pi.appendEntry`, so
 * it survives a restart and travels with the session.
 *
 * When the agent has not written a list yet, the panel falls back to what it
 * actually did — the tool runs from this session — so the view is never empty.
 */
export function TodoPanel({
  state,
  messages,
  onJumpToTurn,
}: {
  state: HostState;
  messages: ChatMessage[];
  onJumpToTurn: (key: string) => void;
}) {
  const turns = useMemo(() => buildTurns(messages, []), [messages]);
  // the fallback list is derived from tool runs; keyed on the work signature so
  // a streaming answer does not re-sort and re-render it on every token
  const signature = toolSignature(turns);

  const rows = useMemo<TaskRow[]>(() => {
    if (state.todos.length) {
      return state.todos.map((todo, index) => ({
        key: todo.id,
        label: todo.label,
        amount: todo.amount,
        status: todo.status === "running" ? "running" : todo.status,
        step: todo.status === "running" ? index + 1 : undefined,
        details: todo.details.length ? todo.details : [{ label: t("status"), meta: t(todo.status) }],
      }));
    }
    // fallback: what the agent has actually touched this session
    const runs = turns.flatMap((turn) => turn.toolRuns);
    return runs.slice(-14).map((run, index) => ({
      key: run.toolCallId || `run-${index}`,
      label: run.label,
      amount: run.chip,
      status: run.status === "done" ? ("done" as const) : run.status === "error" ? ("failed" as const) : ("running" as const),
      step: run.status === "running" ? index + 1 : undefined,
      details: run.detail.slice(0, 4).map((line) => ({ label: line.text, meta: "" })),
    }));
  }, [state.todos, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState<0 | 1>(0);
  const derived = !state.todos.length;
  const done = rows.filter((row) => row.status === "done").length;

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11.5px] font-medium text-ink-2">{derived ? t("Session activity") : t("Task list")}</span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">
          {done}/{rows.length}
        </span>
      </div>

      <div className="px-2.5 pb-3">
        <SlidingGroup
          activeIndex={view}
          className="mb-2 flex w-fit items-center gap-0.5 rounded-chip bg-field p-[3px]"
          pillClassName="bg-surface shadow-hairline"
        >
          {["Cards", "Table"].map((label) => (
            <button
              key={label}
              data-slide-item
              type="button"
              onClick={() => setView(label === "Cards" ? 0 : 1)}
              className={cn(
                "pressable relative z-10 h-5 rounded-[4px] px-2 text-[11px]",
                (view === 0 ? "Cards" : "Table") === label ? "text-ink" : "text-ink-3",
              )}
            >
              {t(label)}
            </button>
          ))}
        </SlidingGroup>
        {rows.length && view === 1 ? (
          <FilterTable
            rows={rows.map((row) => ({
              task: row.label,
              date: row.amount || "—",
              status: row.status === "running" ? "progress" : row.status === "done" ? "done" : "todo",
              owner: row.details[0]?.label ?? row.status,
            })) as TableRow[]}
            labels={{ columns: { task: t("Task"), date: t("Amount"), status: t("Status"), owner: t("Detail") } }}
          />
        ) : null}
        {rows.length && view === 0 ? (
          <TaskRows variant="List" rows={rows} instant labels={{ completed: t("Done"), failed: t("Failed") }} />
        ) : (
          <EmptyState
            title={t("No tasks yet")}
            body={t("Ask Pi to plan multi-step work and it will keep this list updated as it goes.")}
          />
        )}
      </div>

      {derived && rows.length ? (
        <div className="px-3 pb-3 text-[10.5px] leading-relaxed text-ink-3">
          {t("Derived from tool runs. Once the agent calls")} <span className="font-mono text-ink-2">todo_write</span>
          {t(", its own list takes over here.")}
        </div>
      ) : null}

      <div className="mt-1 border-t border-line px-3 pt-2 pb-1 text-[11.5px] font-medium text-ink-2">{t("This session")}</div>
      <SessionOutline messages={messages} onJump={onJumpToTurn} />
    </div>
  );
}
