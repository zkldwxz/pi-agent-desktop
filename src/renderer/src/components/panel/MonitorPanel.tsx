import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, HostState, TodoItemView } from "@shared/types";
import type { FileEntry, GitBranches, GitState } from "@shared/workspace";
import { collectChanges, type ChangeEntry } from "./ChangesPanel";
import { buildTurns, toolSignature } from "../../lib/agent-view";
import { asProse } from "../../lib/format";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  EyeIcon,
  FilePenIcon,
  GitBranchIcon,
  HomeIcon,
  LoaderIcon,
  RefreshIcon,
  TrashIcon,
  XIcon,
} from "../icons";

/** rows the two file lists show before they stop — the panel is a glance, not a browser */
const MAX_ROWS = 8;

/** The agent's own status, as a mark. The todo list is read here, not in the dock. */
function TodoMark({ status }: { status: TodoItemView["status"] }) {
  if (status === "running") return <LoaderIcon size={11} className="spin-fast shrink-0 text-accent" />;
  if (status === "done") return <CheckIcon size={11} className="shrink-0 text-green" />;
  if (status === "failed") return <XIcon size={11} className="shrink-0 text-red" />;
  return <span aria-hidden className="size-[7px] shrink-0 rounded-full border border-line-strong" />;
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** `09:52` — the reference's "updated at", in the interface's own clock */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The task monitor: the conversation's own right-hand column — or a card
 * floating over it when the window cannot afford three columns.
 *
 * It answers "where does this stand" beside the thread, so while there is room
 * it takes real width and the conversation narrows — no colour of its own under
 * a single hairline divider, and no dismissal: only the toolbar button (or the
 * header's close) puts it away. When the dock is open or the window is small
 * that column would leave the thread unusable, so `floating` swaps it for a
 * card that overlays the right edge instead of squeezing it. It is still a
 * pane, not a popover: nothing about it is dismissed by clicking away.
 * Top to bottom it reads the session, the environment it is working in, the
 * task list, and the files it produced and read.
 *
 * The environment is real git rather than a guess: status, branches, commit and
 * push all go through `window.pi.git*`, which runs argv at git directly.
 */
export function MonitorPanel({
  state,
  messages,
  floating,
  onOpenChanges,
  onOpenDiff,
  onOpenFile,
  onClose,
}: {
  state: HostState;
  messages: ChatMessage[];
  /** the window has no room for a third column — overlay instead of taking width */
  floating?: boolean;
  onOpenChanges: () => void;
  onOpenDiff: (change: ChangeEntry) => void;
  onOpenFile: (entry: FileEntry) => void;
  onClose: () => void;
}) {
  const [git, setGit] = useState<GitState | null>(null);
  const [busy, setBusy] = useState<"commit" | "push" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [gitOpen, setGitOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);

  /* the panel only mounts when it is asked for, so this is its "on open" */
  useEffect(() => {
    void window.pi.gitStatus().then(setGit).catch(() => setGit(null));
  }, []);

  const refresh = useCallback(() => {
    void window.pi.gitStatus().then(setGit).catch(() => setGit(null));
  }, []);

  /* ── what the session did, settled history only ─────────── */
  const turns = useMemo(() => buildTurns(messages, []), [messages]);
  const signature = toolSignature(turns);
  const changes = useMemo(() => collectChanges(turns), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the read side of the same work: what the agent looked at to get there.
   * Reads carry `path` (the raw argument); only edits carry a display `file`. */
  const sources = useMemo(() => {
    const seen = new Set<string>();
    for (const turn of turns) {
      for (const run of turn.toolRuns) {
        if (run.icon !== "read" || !run.path) continue;
        seen.add(run.path);
      }
    }
    return [...seen].slice(-MAX_ROWS).reverse();
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== "assistant" || message.streaming) continue;
      const text = asProse(message.text);
      if (text) return { text, at: message.timestamp };
    }
    return null;
  }, [messages]);

  const todos = state.todos ?? [];
  const doneTodos = todos.filter((todo) => todo.status === "done").length;
  const added = changes.reduce((sum, change) => sum + change.add, 0);
  const removed = changes.reduce((sum, change) => sum + change.del, 0);

  /* ── commit / push ──────────────────────────────────────── */
  const report = (result: { ok: boolean; output?: string; error?: string }, okText: string) => {
    setStatus(
      result.ok
        ? { tone: "ok", text: result.output?.split("\n")[0] || t(okText) }
        : { tone: "error", text: result.error ?? t("Failed") },
    );
    refresh();
  };

  const commit = async () => {
    const message = commitMessage.trim();
    if (!message || busy) return;
    setBusy("commit");
    setStatus(null);
    const result = await window.pi.gitCommit(message).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    report(result, "Committed");
    if (result.ok) setCommitMessage("");
    setBusy(null);
  };

  const push = async () => {
    if (busy) return;
    setBusy("push");
    setStatus(null);
    const result = await window.pi.gitPush().catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    report(result, "Pushed");
    setBusy(null);
  };

  const showGit = git?.repo;

  return (
    <aside
      aria-label={t("Task monitor")}
      className={cn(
        "flex w-[300px] flex-col",
        floating
          ? "animate-slide-in-right absolute inset-y-3 right-3 z-40 overflow-hidden rounded-card bg-surface shadow-overlay"
          : "shrink-0 border-l border-line",
      )}
    >
      {/* ── the session ─────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-3">
          <span className="min-w-0 flex-1 truncate text-ui-caption font-medium text-ink">
            {state.snapshot?.sessionName || t("New chat")}
          </span>
          <button
            type="button"
            aria-label={t("Refresh")}
            title={t("Refresh")}
            onClick={refresh}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <RefreshIcon size={12} />
          </button>
          <button
            type="button"
            aria-label={t("Close")}
            title={t("Close")}
            onClick={onClose}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <XIcon size={12} />
          </button>
      </header>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4">
        {summary ? (
          <div className="mt-1 px-0.5 text-ui-xs text-ink-3 tabular-nums">
            {tf("Updated at {time}", { time: clockTime(summary.at) })}
          </div>
        ) : null}
        {summary ? (
          <p className="mt-1.5 line-clamp-5 whitespace-pre-wrap break-words rounded-card bg-surface px-2.5 py-2 text-ui-sm leading-relaxed text-ink-2 shadow-hairline">
            {summary.text}
          </p>
        ) : null}

        {/* ── environment ─────────────────────────────────── */}
        {showGit || changes.length ? (
          <>
            <SectionLabel>{t("Environment")}</SectionLabel>
            <div className="overflow-hidden rounded-card bg-surface shadow-hairline">
              {/* the session's own diff — the honest "what did I just do" */}
              <button
                type="button"
                onClick={onOpenChanges}
                disabled={!changes.length}
                className="pressable flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-hover disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <FilePenIcon size={13} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-ui-caption text-ink-2">
                  {changes.length
                    ? tf("{count} files changed", { count: changes.length })
                    : t("No changes yet")}
                </span>
                {changes.length ? (
                  <span className="shrink-0 font-mono text-ui-xs tabular-nums">
                    <span className="text-green">+{added.toLocaleString()}</span>{" "}
                    <span className="text-red">−{removed.toLocaleString()}</span>
                  </span>
                ) : null}
              </button>

              {/* where the work lives */}
              <div className="flex h-8 items-center gap-2 border-t border-line px-2.5">
                <HomeIcon size={13} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-ui-caption text-ink-2" title={state.cwd}>
                  {t("Local")} · {baseName(state.cwd)}
                </span>
              </div>

              {/* a plain folder has nothing to branch off, so the whole git half
                  of the card is one block rather than three dead rows */}
              {showGit ? (
                <>
                  {/* branch — the whole menu opens under it */}
                  <button
                    type="button"
                    aria-expanded={gitOpen}
                    onClick={() => setGitOpen((value) => !value)}
                    className="pressable flex h-8 w-full items-center gap-2 border-t border-line px-2.5 text-left hover:bg-hover"
                  >
                    <GitBranchIcon size={13} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-ink-2">
                      {git?.branch ?? (git ? t("Detached") : "—")}
                    </span>
                    {git?.changed ? (
                      <span
                        title={tf("{count} files dirty", { count: git.changed })}
                        className="shrink-0 font-mono text-ui-xs text-orange tabular-nums"
                      >
                        ●{git.changed}
                      </span>
                    ) : null}
                    {git?.ahead ? (
                      <span title={tf("{count} to push", { count: git.ahead })} className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
                        ↑{git.ahead}
                      </span>
                    ) : null}
                    <ChevronDownIcon
                      size={10}
                      className={cn("shrink-0 text-ink-3 transition-transform duration-200", gitOpen && "rotate-180")}
                    />
                  </button>
                  {gitOpen ? <BranchMenu git={git} onClose={() => setGitOpen(false)} onChanged={refresh} /> : null}

                  {/* commit / push, folded until asked for */}
                  <button
                    type="button"
                    aria-expanded={commitOpen}
                    onClick={() => {
                      setGitOpen(false);
                      setCommitOpen((value) => !value);
                    }}
                    className="pressable flex h-8 w-full items-center gap-2 border-t border-line px-2.5 text-left hover:bg-hover"
                  >
                    <ArrowUpIcon size={13} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-ui-caption text-ink-2">{t("Commit or push")}</span>
                    <ChevronDownIcon
                      size={10}
                      className={cn("shrink-0 text-ink-3 transition-transform duration-200", commitOpen && "rotate-180")}
                    />
                  </button>
                  {commitOpen ? (
                    <div className="border-t border-line px-2.5 py-2">
                      <CommitBox
                        value={commitMessage}
                        onChange={setCommitMessage}
                        onCommit={() => void commit()}
                        onPush={() => void push()}
                        busy={busy}
                        dirty={Boolean(git?.changed)}
                      />
                      {status ? (
                        <div
                          className={cn(
                            "mt-1.5 max-h-14 overflow-y-auto whitespace-pre-wrap px-0.5 text-ui-xs leading-snug",
                            status.tone === "ok" ? "text-green" : "text-red",
                          )}
                        >
                          {status.text}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {/* ── tasks: the agent's list, read here ───────────── */}
        {todos.length ? (
          <>
            <SectionLabel>{t("Tasks")}</SectionLabel>
            <div className="overflow-hidden rounded-card bg-surface shadow-hairline">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-ui-caption text-ink-2">
                  {tf("{done} of {total} done", { done: doneTodos, total: todos.length })}
                </span>
                <span className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
                  {Math.round((doneTodos / todos.length) * 100)}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-field">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${(doneTodos / todos.length) * 100}%`,
                    transition: "width 300ms var(--ease-out-strong-css)",
                  }}
                />
              </div>
              {/* it used to be a button into the dock's Tasks tab; the list is
                  the answer, so it is written out instead of one click away */}
              <div className="mt-1 border-t border-line">
                {todos.map((todo) => (
                  <div key={todo.id} className="flex items-start gap-2 px-2.5 py-[5px]">
                    <span className="flex h-4 w-3 shrink-0 items-center justify-center">
                      <TodoMark status={todo.status} />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words text-ui-sm leading-[16px]",
                        todo.status === "done" ? "text-ink-3" : todo.status === "running" ? "text-ink" : "text-ink-2",
                      )}
                    >
                      {todo.label}
                    </span>
                    {todo.amount ? (
                      <span className="shrink-0 font-mono text-ui-xs leading-[16px] text-ink-3">{todo.amount}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* ── outputs: what the session wrote ─────────────── */}
        {changes.length ? (
          <>
            <SectionLabel>{t("Outputs")}</SectionLabel>
            <div className="overflow-hidden rounded-card bg-surface shadow-hairline">
              {changes.slice(0, MAX_ROWS).map((change, index) => (
                <button
                  key={change.path ?? change.file}
                  type="button"
                  onClick={() => onOpenDiff(change)}
                  className={cn(
                    "pressable flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-hover",
                    index > 0 && "border-t border-line",
                  )}
                >
                  <CodeIcon size={13} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-ink-2">{baseName(change.file)}</span>
                  <span className="shrink-0 font-mono text-ui-xs tabular-nums">
                    <span className="text-green">+{change.add}</span>
                    {change.del ? <span className="text-red"> −{change.del}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {/* ── sources: what the session read ──────────────── */}
        {sources.length ? (
          <>
            <SectionLabel>{t("Sources")}</SectionLabel>
            <div className="overflow-hidden rounded-card bg-surface shadow-hairline">
              {sources.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => onOpenFile({ name: baseName(path), path, kind: "file" })}
                  className={cn(
                    "pressable flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-hover",
                    index > 0 && "border-t border-line",
                  )}
                >
                  <EyeIcon size={13} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-ink-2" title={path}>
                    {baseName(path)}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-4 px-0.5 text-ui-sm tracking-[0.3px] text-ink-3">{children}</div>;
}

/**
 * The branch menu, expanded in place.
 *
 * It grows the card rather than floating over it: the card scrolls, and a
 * dropdown clipped by that scroll would be a menu you cannot finish reading.
 * Delete arms on the first click and fires on the second — no native dialog in
 * a custom-styled shell, same as the workspace rows.
 */
function BranchMenu({
  git,
  onClose,
  onChanged,
}: {
  git: GitState | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<GitBranches | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [creating, setCreating] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void window.pi.gitBranches().then(setList).catch(() => setList(null));
  }, []);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setWorking(true);
    setError(null);
    const result = await action().catch((inner: unknown) => ({
      ok: false,
      error: inner instanceof Error ? inner.message : String(inner),
    }));
    setWorking(false);
    if (!result.ok) {
      setError(result.error ?? t("Failed"));
      return;
    }
    setError(null);
    onChanged();
    void window.pi.gitBranches().then(setList).catch(() => undefined);
  };

  const create = () => {
    const name = creating.trim();
    if (!name || working) return;
    setCreating("");
    void run(() => window.pi.gitCreateBranch(name));
  };

  return (
    <div className="border-t border-line bg-field/40 px-1.5 py-1.5" style={{ animation: "fade-in 160ms ease-out both" }}>
      <div className="scrollbar-thin max-h-[168px] overflow-y-auto">
        {list === null ? (
          <div className="px-1.5 py-1.5 text-ui-sm text-ink-3">{t("Looking up branches…")}</div>
        ) : list.branches.length ? (
          list.branches.map((branch) => (
            <div key={branch.name} className="group/branch flex items-center gap-1">
              <button
                type="button"
                disabled={working || branch.current}
                onClick={() => {
                  setArmed(null);
                  void run(() => window.pi.gitCheckout(branch.name));
                }}
                className={cn(
                  "pressable flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-chip px-1.5 text-left",
                  branch.current ? "text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                )}
              >
                <CheckIcon size={11} className={cn("shrink-0", branch.current ? "text-accent" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">{branch.name}</span>
              </button>
              {branch.current ? null : (
                <button
                  type="button"
                  aria-label={armed === branch.name ? t("Click again to delete") : tf("Delete {branch}", { branch: branch.name })}
                  title={armed === branch.name ? t("Click again to delete") : t("Delete branch")}
                  disabled={working}
                  onClick={() => {
                    if (armed !== branch.name) {
                      setArmed(branch.name);
                      return;
                    }
                    setArmed(null);
                    void run(() => window.pi.gitDeleteBranch(branch.name));
                  }}
                  className={cn(
                    "pressable flex size-6 shrink-0 items-center justify-center rounded-chip opacity-0 transition-opacity group-hover/branch:opacity-100",
                    armed === branch.name ? "bg-hover text-red opacity-100" : "text-ink-3 hover:bg-hover hover:text-red",
                  )}
                >
                  <TrashIcon size={11} />
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="px-1.5 py-1.5 text-ui-sm text-ink-3">{t("No branches")}</div>
        )}
      </div>
      {armed ? (
        <div className="px-1.5 pb-1 text-ui-xs text-red">{t("Click again to delete")}</div>
      ) : null}
      {/* new branch: type it, Enter creates and switches */}
      <div className="mt-1 flex items-center gap-1 border-t border-line pt-1.5">
        <GitBranchIcon size={12} className="ml-1 shrink-0 text-ink-3" />
        <input
          value={creating}
          onChange={(event) => setCreating(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              create();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
          placeholder={t("New branch")}
          aria-label={t("New branch")}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-chip bg-surface px-1.5 font-mono text-ui-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-4"
        />
        <button
          type="button"
          onClick={create}
          disabled={!creating.trim() || working}
          className="pressable h-7 shrink-0 rounded-chip bg-ink px-2 text-ui-sm font-medium text-canvas disabled:opacity-40"
        >
          {t("Create")}
        </button>
      </div>
      {error ? <div className="mt-1 max-h-12 overflow-y-auto whitespace-pre-wrap px-1.5 text-ui-xs leading-snug text-red">{error}</div> : null}
    </div>
  );
}

/** the commit message box, opened from the environment's last row */
function CommitBox({
  value,
  onChange,
  onCommit,
  onPush,
  busy,
  dirty,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onPush: () => void;
  busy: "commit" | "push" | null;
  dirty: boolean;
}) {
  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onCommit();
          }
        }}
        placeholder={t("Commit message")}
        aria-label={t("Commit message")}
        className="h-7 w-full rounded-chip bg-field px-2 text-ui-sm text-ink outline-none placeholder:text-ink-4"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={onCommit}
          disabled={!value.trim() || busy !== null || !dirty}
          title={dirty ? undefined : t("Nothing to commit")}
          className="pressable h-7 flex-1 rounded-chip bg-ink text-ui-sm font-medium text-canvas disabled:opacity-40"
        >
          {busy === "commit" ? t("Committing…") : t("Commit")}
        </button>
        <button
          type="button"
          onClick={onPush}
          disabled={busy !== null}
          className="pressable h-7 flex-1 rounded-chip bg-field text-ui-sm font-medium text-ink-2 hover:bg-hover-2 hover:text-ink disabled:opacity-40"
        >
          {busy === "push" ? t("Pushing…") : t("Push")}
        </button>
      </div>
    </>
  );
}
