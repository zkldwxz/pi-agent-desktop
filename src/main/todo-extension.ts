import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * The agent's task list, as a pi extension.
 *
 * Same reasoning as the browser tools: extensions are pi's own mechanism, so
 * the model gets `todo_write` / `todo_read` with no MCP layer. State is written
 * through `pi.appendEntry("todo-state")`, which means the plan survives a
 * restart and rides along in the session file — compaction, branching and
 * `/tree` all see it like any other entry.
 *
 * The shape is deliberately the one `TaskRows` renders: a label, an amount, a
 * status, and expandable detail lines.
 */

export type TodoStatus = "pending" | "running" | "done" | "failed";

export interface TodoItem {
  id: string;
  label: string;
  amount: string;
  status: TodoStatus;
  details: { label: string; meta: string }[];
}

export interface TodoState {
  items: TodoItem[];
  updatedAt: string;
}

const STATUS: Record<string, TodoStatus> = {
  pending: "pending",
  in_progress: "running",
  running: "running",
  completed: "done",
  done: "done",
  failed: "failed",
};

export const EMPTY_TODOS: TodoState = { items: [], updatedAt: new Date(0).toISOString() };

interface RawItem {
  label?: string;
  status?: string;
  amount?: string;
  details?: { label?: string; meta?: string }[];
}

/** Normalise whatever the model sends into the row shape the UI renders. */
export function normalizeTodos(raw: RawItem[] | undefined): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((item, index) => ({
    id: `todo-${index}`,
    label: String(item.label ?? "Untitled task").slice(0, 160),
    amount: String(item.amount ?? "").slice(0, 40),
    status: STATUS[String(item.status ?? "pending").toLowerCase()] ?? "pending",
    details: Array.isArray(item.details)
      ? item.details.slice(0, 8).map((detail) => ({
          label: String(detail.label ?? "").slice(0, 120),
          meta: String(detail.meta ?? "").slice(0, 40),
        }))
      : [],
  }));
}

export function registerTodoTools(
  pi: ExtensionAPI,
  options: { onChange: (state: TodoState) => void; initial: TodoState },
): void {
  let state: TodoState = options.initial;

  const publish = (raw: RawItem[] | undefined) => {
    state = { items: normalizeTodos(raw), updatedAt: new Date().toISOString() };
    pi.appendEntry("todo-state", state);
    options.onChange(state);
  };

  const summarise = () => {
    if (!state.items.length) return "The task list is empty.";
    return state.items
      .map((item) => `- [${item.status === "done" ? "x" : item.status === "failed" ? "!" : " "}] ${item.label}${item.amount ? ` (${item.amount})` : ""}`)
      .join("\n");
  };

  pi.registerTool({
    name: "todo_write",
    label: "Update task list",
    description:
      "Replace the task list. Use it to plan multi-step work and to keep status current as you go: set one item to in_progress while you work on it, then completed (or failed) when done. The user sees this list live in the sidebar, so keep labels short and concrete.",
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          label: Type.String({ description: "short imperative task name" }),
          status: Type.Optional(
            Type.String({ description: "pending | in_progress | completed | failed" }),
          ),
          amount: Type.Optional(Type.String({ description: "count or size, e.g. '3 files', '12 suppliers'" })),
          details: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                meta: Type.String(),
              }),
            ),
          ),
        }),
      ),
    }),
    execute: async (_id, params) => {
      publish((params.items ?? []) as RawItem[]);
      return {
        content: [{ type: "text", text: `Task list updated (${state.items.length} item(s)).\n${summarise()}` }],
        details: { count: state.items.length } as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "todo_read",
    label: "Read task list",
    description: "Read the current task list back.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: summarise() }],
      details: { count: state.items.length } as Record<string, unknown>,
    }),
  });

  // restore the last written list when a session starts
  pi.on("session_start", () => {
    options.onChange(state);
  });

  pi.on("session_shutdown", () => {
    options.onChange(EMPTY_TODOS);
  });
}
