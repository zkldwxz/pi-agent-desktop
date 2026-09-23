import { useMemo, useState } from "react";
import type { ChatMessage } from "@shared/types";
import { buildTurns, toDiffRows, toolSignature, type DiffLine, type TurnView } from "../../lib/agent-view";
import { t, tf } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { ChevronDownIcon, FilePenIcon } from "../icons";

export interface ChangeEntry {
  /** the row's label — the basename plus the first hunk's line (`App.tsx:361`) */
  file: string;
  /** where the file actually is; `file` is a label, not something to open */
  path?: string;
  add: number;
  del: number;
  toolName: string;
  runId: string;
  /** every hunk this session applied to the file, in order */
  diffLines?: DiffLine[];
}

/** Every file this session wrote to, with its line delta and its diff hunks. */
export function collectChanges(turns: TurnView[]): ChangeEntry[] {
  const byKey = new Map<string, ChangeEntry>();
  for (const turn of turns) {
    for (const run of turn.toolRuns) {
      if (run.icon !== "write") continue;
      // a path-less edit still needs a unique row label
      const label = run.file ?? `${run.toolName} #${byKey.size + 1}`;
      // the label carries the hunk's first line, so it cannot be the identity:
      // one file edited at :120 and later at :400 would split into two rows
      const key = run.path ?? label;
      const existing = byKey.get(key);
      byKey.set(key, {
        file: existing?.file ?? label,
        path: run.path ?? existing?.path,
        add: (existing?.add ?? 0) + (run.add ?? 0),
        del: (existing?.del ?? 0) + (run.del ?? 0),
        toolName: run.toolName,
        runId: run.toolCallId,
        // a file edited five times has five patches; a panel that showed only the
        // last one hid most of what happened to it
        diffLines: existing?.diffLines || run.diffLines
          ? [...(existing?.diffLines ?? []), ...(run.diffLines ?? [])].slice(0, 240)
          : undefined,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.add + b.del - (a.add + a.del));
}

/** How many diff rows an expanded file shows before it stops. */
const PREVIEW_ROWS = 40;

/**
 * Changes.
 *
 * The session's own edit history, rebuilt from the edit/write tool results — no
 * git required, and it reflects what the agent did rather than what the working
 * tree looks like.
 *
 * Each row expands to that file's real diff in place, so the panel answers "what
 * changed" without leaving it. The trailing control opens the file properly in
 * the main column.
 *
 * This used to delegate to the vendored `DiffTable`, which is a scripted demo:
 * its columns are hard-coded "Flavor / Category / Supplier", its header says
 * "Proposed menu cleanup", and it always adds a row called Pistachio. The real
 * file path and tool name were being poured into those flavour columns, and the
 * staged reveal animation meant the rows were not even interactive for the first
 * 440ms. A 320px column showing real diffs is simpler than bending that demo
 * into shape.
 */
export function ChangesPanel({
  messages,
  activeFile,
  onOpen,
}: {
  messages: ChatMessage[];
  activeFile?: string;
  onOpen: (change: ChangeEntry) => void;
}) {
  const turns = useMemo(() => buildTurns(messages, []), [messages]);
  // the edits only move when a tool call lands — a streaming answer must not
  // re-render this panel, so the memo keys on the work signature instead
  const signature = toolSignature(turns);
  const changes = useMemo(() => collectChanges(turns), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(
    () => changes.reduce((acc, change) => ({ add: acc.add + change.add, del: acc.del + change.del }), { add: 0, del: 0 }),
    [changes],
  );
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  const toggle = (file: string) =>
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  if (!changes.length) {
    return (
      <div className="flex flex-col gap-1 px-3 py-6 text-[11.5px] text-ink-3">
        <span>{t("No edits yet.")}</span>
        <span className="text-[11px]">{t("Files the agent writes with edit or write will be listed here.")}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 pb-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
          {tf(changes.length === 1 ? "{count} file touched" : "{count} files touched", { count: changes.length })}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
          <span className="text-green">+{totals.add}</span> <span className="text-red">−{totals.del}</span>
        </span>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <div className="flex flex-col gap-0.5">
          {changes.map((change, index) => {
            const active = activeFile === change.file;
            const expanded = openFiles.has(change.file);
            const lines = change.diffLines ?? [];
            const shown = lines.slice(0, PREVIEW_ROWS);
            const hidden = lines.length - shown.length;

            return (
              <div key={change.path ?? change.file} className="flex flex-col">
                <div
                  style={{ animation: `row-enter 240ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 4) * 35}ms both` }}
                  className={cn(
                    "group/change flex items-center gap-1 rounded-[7px] pr-0.5",
                    active ? "bg-surface shadow-hairline" : "hover:bg-hover",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(change.file)}
                    aria-expanded={expanded}
                    disabled={!lines.length}
                    title={lines.length ? t("Show this file's diff") : t("No diff was recorded for this write")}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] px-1.5 py-1.5 text-left disabled:cursor-default"
                  >
                    <ChevronDownIcon
                      size={10}
                      className={cn(
                        "shrink-0 transition-transform duration-300 ease-out-strong",
                        lines.length ? "text-ink-3" : "text-transparent",
                      )}
                      style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                      {change.file}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
                      {change.add ? <span className="text-green">+{change.add}</span> : null}
                      {change.del ? <span className="text-red"> −{change.del}</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(change)}
                    title={t("Open this file with its diff")}
                    aria-label={tf("Open {file}", { file: change.file })}
                    className="pressable flex size-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 opacity-0 hover:bg-hover-2 hover:text-ink group-hover/change:opacity-100 focus-visible:opacity-100"
                  >
                    <FilePenIcon size={12} />
                  </button>
                </div>

                {expanded ? (
                  <div className="ml-[13px] border-l border-line py-1 pl-2">
                    <DiffPreview lines={shown} />
                    {hidden > 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpen(change)}
                        className="pressable mt-1 rounded-chip px-1.5 py-0.5 text-[10.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                      >
                        {tf("+{count} more lines — open the file", { count: hidden })}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A file's hunks, at panel width.
 *
 * Rows wrap instead of scrolling sideways: a 320px column that scrolls
 * horizontally hides the change it is describing. The gutter carries the real
 * line number the parser resolved, so a multi-hunk patch numbers correctly.
 *
 * The code itself stays in the normal ink and only the gutter is coloured, the
 * way a diff is read everywhere else — green and red text on a green and red
 * wash made both the wash and the colouring redundant, and the eye had to
 * decode the tint before the line. The words that actually changed keep a
 * stronger wash of their own, from the same rows the code card renders.
 */
function DiffPreview({ lines }: { lines: DiffLine[] }) {
  const rows = toDiffRows(lines);
  if (!rows.length) {
    return <div className="px-1.5 py-1 text-[10.5px] text-ink-3">{t("No diff was recorded.")}</div>;
  }

  return (
    <div className="flex flex-col font-mono text-[10.5px] leading-[1.65]">
      {rows.map((row, index) => {
        if (row.type === "ctx" && (row.pieces[0]?.text ?? "").startsWith("@@")) {
          return (
            <div key={index} className="mt-1 mb-0.5 truncate text-[10px] text-ink-3 first:mt-0">
              {row.pieces.map((piece) => piece.text).join("")}
            </div>
          );
        }
        const add = row.type === "add";
        const del = row.type === "del";
        return (
          <div
            key={index}
            className={cn(
              "grid grid-cols-[26px_minmax(0,1fr)] items-start rounded-[3px]",
              add ? "bg-green-tint" : del ? "bg-red-tint" : "",
            )}
          >
            <span
              className={cn(
                "select-none pr-1 text-right tabular-nums",
                add ? "text-green" : del ? "text-red" : "text-ink-3",
              )}
            >
              {(del ? row.old : row.cur) ?? ""}
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap text-ink-2">
              {row.pieces.map((piece, j) =>
                piece.change ? (
                  <span
                    key={j}
                    className="rounded-[3px]"
                    style={{
                      background: `color-mix(in srgb, var(--${piece.change === "add" ? "green" : "red"}) 18%, transparent)`,
                      padding: "0 2px",
                      margin: "0 -1px",
                      boxDecorationBreak: "clone",
                      WebkitBoxDecorationBreak: "clone",
                    }}
                  >
                    {piece.text}
                  </span>
                ) : (
                  <span key={j}>{piece.text}</span>
                ),
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
