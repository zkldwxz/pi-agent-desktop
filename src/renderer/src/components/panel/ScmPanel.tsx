import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, GitChangeFile, GitChanges, GitDiff, GitResult } from "@shared/workspace";
import { parseUnifiedDiff } from "../../lib/agent-view";
import { DiffPreview } from "./ChangesPanel";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  LoaderIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "../icons";

/**
 * Source control — the repository's own working tree, staged and unstaged.
 *
 * This is git, not the session's edit history (that is the Changes tab one
 * tile over). Rows come from `git status --porcelain=v2`, each file's patch
 * from `git diff`, and a checked row is exactly what the commit button names:
 * `git commit -- <checked paths>` leaves everything else where it was.
 *
 * Discard arms on the first click and fires on the second — the same
 * convention the branch menu uses, because a wrong click must not be able to
 * take a file back to HEAD.
 */

const STATUS_LABEL: Record<string, { letter: string; tone: string; label: string }> = {
  modified: { letter: "M", tone: "text-orange", label: "Modified" },
  added: { letter: "A", tone: "text-green", label: "Added" },
  deleted: { letter: "D", tone: "text-red", label: "Deleted" },
  renamed: { letter: "R", tone: "text-accent", label: "Renamed" },
  copied: { letter: "C", tone: "text-accent", label: "Copied" },
  typechange: { letter: "T", tone: "text-ink-3", label: "Type changed" },
  unmerged: { letter: "U", tone: "text-red", label: "Conflicted" },
};

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function dirName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut > 0 ? clean.slice(0, cut) : "";
}

function statusOf(file: GitChangeFile): { letter: string; tone: string; label: string } {
  if (file.untracked) return { letter: "?", tone: "text-ink-3", label: t("Untracked") };
  if (file.unmerged) return STATUS_LABEL.unmerged;
  const key = file.worktree ?? file.index;
  return (key && STATUS_LABEL[key]) ?? STATUS_LABEL.modified;
}

export function ScmPanel({
  cwd,
  onOpenFile,
}: {
  cwd: string;
  onOpenFile: (entry: FileEntry) => void;
}) {
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [git, setGit] = useState<{ branch: string | null; ahead: number; behind: number } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Map<string, GitDiff>>(new Map());
  const [armed, setArmed] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"commit" | "push" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(() => {
    void window.pi.gitChanges().then((next) => mounted.current && setChanges(next)).catch(() => undefined);
    void window.pi.gitStatus().then((next) => mounted.current && setGit(next.repo ? next : null)).catch(() => undefined);
  }, []);

  useEffect(refresh, [refresh, cwd]);

  /* checked == "in the next commit". New rows default to checked, which is
   * what a changelist means; rows that vanished (committed or discarded)
   * drop out of the set. */
  const allPaths = useMemo(() => {
    if (!changes) return new Set<string>();
    return new Set([...changes.staged, ...changes.unstaged].map((file) => file.path));
  }, [changes]);
  useEffect(() => {
    setChecked((current) => {
      const next = new Set<string>();
      /* new rows default to checked — what a changelist means; vanished rows
       * (committed or discarded) drop out of the set */
      for (const path of allPaths) {
        if (current.size === 0 || current.has(path)) next.add(path);
      }
      return next;
    });
  }, [allPaths]);

  const report = (result: GitResult, okText: string) => {
    setStatus(
      result.ok
        ? { tone: "ok", text: result.output?.split("\n")[0] || t(okText) }
        : { tone: "error", text: result.error ?? t("Failed") },
    );
    refresh();
  };

  const run = async (action: () => Promise<GitResult>) => {
    const result = await action().catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    report(result, "Done");
  };

  const stage = (files: GitChangeFile[]) => void run(() => window.pi.gitStage(files.map((file) => file.path)));
  const unstage = (files: GitChangeFile[]) => void run(() => window.pi.gitUnstage(files.map((file) => file.path)));
  const discard = (file: GitChangeFile) => {
    if (armed !== file.path) {
      setArmed(file.path);
      return;
    }
    setArmed(null);
    void run(() => window.pi.gitDiscard([{ path: file.path, untracked: file.untracked }]));
  };

  const toggleDiff = (file: GitChangeFile, staged: boolean) => {
    const key = `${staged ? "s" : "w"}:${file.path}`;
    if (openPath === key) {
      setOpenPath(null);
      return;
    }
    setOpenPath(key);
    if (diffs.has(key)) return;
    void window.pi
      .gitDiff(file.path, { staged, untracked: file.untracked })
      .then((diff) => mounted.current && setDiffs((current) => new Map(current).set(key, diff)))
      .catch(() => undefined);
  };

  const checkedPaths = useMemo(() => [...checked].filter((path) => allPaths.has(path)), [checked, allPaths]);

  const commit = async () => {
    const text = message.trim();
    if (!text || !checkedPaths.length || busy) return;
    setBusy("commit");
    setStatus(null);
    const result = await window.pi.gitCommit(text, checkedPaths).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    report(result, "Committed");
    if (result.ok) setMessage("");
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

  const toggleChecked = (path: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const openFile = (file: GitChangeFile) =>
    onOpenFile({ name: baseName(file.path), path: `${cwd}/${file.path}`, kind: "file" });

  if (changes && !changes.repo) {
    return (
      <div className="flex flex-col gap-1 px-3 py-6 text-ui-sm text-ink-3">
        <span>{t("Not a git repository.")}</span>
        <span className="text-ui-sm">{t("Open a project that is a git repository to see its changes here.")}</span>
      </div>
    );
  }

  const total = (changes?.staged.length ?? 0) + (changes?.unstaged.length ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[40px] shrink-0 items-center gap-2 border-b border-line px-[12px]">
        <GitBranchIcon size={13} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-ui-base text-ink-2">
          {git?.branch ?? (changes ? t("Detached") : "—")}
        </span>
        {git?.ahead ? (
          <span title={tf("{count} to push", { count: git.ahead })} className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
            ↑{git.ahead}
          </span>
        ) : null}
        {git?.behind ? (
          <span title={tf("{count} behind", { count: git.behind })} className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
            ↓{git.behind}
          </span>
        ) : null}
        <button
          type="button"
          title={t("Refresh")}
          aria-label={t("Refresh")}
          onClick={refresh}
          className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
        >
          <RefreshIcon size={12} />
        </button>
      </div>

      {changes?.truncated ? (
        <div className="shrink-0 border-b border-line px-[12px] py-1.5 text-ui-xs text-orange">
          {tf("Repository has more than {count} changed files — the list stopped early.", { count: 5000 })}
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-[8px] py-[6px]">
        {changes === null ? (
          <div className="px-1.5 py-3 text-ui-sm text-ink-3">{t("Loading…")}</div>
        ) : total === 0 ? (
          <div className="px-1.5 py-3 text-ui-sm text-ink-3">{t("The working tree is clean.")}</div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {changes.staged.length ? (
              <Group title={t("Staged")} count={changes.staged.length} action={{ label: t("Unstage all"), run: () => unstage(changes.staged) }}>
                {changes.staged.map((file) => (
                  <Row
                    key={`s:${file.path}`}
                    file={file}
                    checked={checked.has(file.path)}
                    onChecked={() => toggleChecked(file.path)}
                    expanded={openPath === `s:${file.path}`}
                    diff={diffs.get(`s:${file.path}`)}
                    onToggle={() => toggleDiff(file, true)}
                    onOpen={() => openFile(file)}
                    action={{ icon: <MinusIcon size={11} />, label: t("Unstage"), run: () => unstage([file]) }}
                    onDiscard={() => discard(file)}
                    armed={armed === file.path}
                  />
                ))}
              </Group>
            ) : null}
            {changes.unstaged.length ? (
              <Group title={t("Changes")} count={changes.unstaged.length} action={{ label: t("Stage all"), run: () => stage(changes.unstaged) }}>
                {changes.unstaged.map((file) => (
                  <Row
                    key={`w:${file.path}`}
                    file={file}
                    checked={checked.has(file.path)}
                    onChecked={() => toggleChecked(file.path)}
                    expanded={openPath === `w:${file.path}`}
                    diff={diffs.get(`w:${file.path}`)}
                    onToggle={() => toggleDiff(file, false)}
                    onOpen={() => openFile(file)}
                    action={file.untracked ? undefined : { icon: <PlusIcon size={11} />, label: t("Stage"), run: () => stage([file]) }}
                    onDiscard={() => discard(file)}
                    armed={armed === file.path}
                  />
                ))}
              </Group>
            ) : null}
          </div>
        )}
      </div>

      {/* commit box — checked rows are exactly what lands */}
      {total ? (
        <div className="shrink-0 border-t border-line px-[10px] pb-[10px] pt-2">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("Commit message")}
            aria-label={t("Commit message")}
            rows={2}
            spellCheck={false}
            className="scrollbar-thin w-full resize-none rounded-chip bg-field px-2 py-1.5 text-ui-sm text-ink outline-none placeholder:text-ink-4"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy === "commit" || !message.trim() || !checkedPaths.length}
              title={checkedPaths.length ? tf("Commit {count} checked files", { count: checkedPaths.length }) : t("Check files to commit")}
              className="pressable flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-chip bg-accent px-2.5 text-ui-caption font-medium text-on-accent hover:bg-accent-strong disabled:opacity-45"
            >
              {busy === "commit" ? <LoaderIcon size={12} className="spin-fast" /> : <CheckIcon size={12} />}
              {busy === "commit" ? t("Committing…") : tf("Commit {count}", { count: checkedPaths.length })}
            </button>
            <button
              type="button"
              onClick={() => void push()}
              disabled={busy !== null}
              title={t("Push")}
              aria-label={t("Push")}
              className="pressable flex size-7 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-45"
            >
              {busy === "push" ? <LoaderIcon size={12} className="spin-fast" /> : <ArrowUpIcon size={12} />}
            </button>
          </div>
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
          {armed ? <div className="mt-1 px-0.5 text-ui-xs text-red">{t("Click again to discard")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** a group header — staged vs. changes, with its bulk verb on the right */
function Group({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action: { label: string; run: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-[8px] pb-1 pt-2 first:pt-0.5">
        <span className="min-w-0 flex-1 truncate text-ui-xs font-medium tracking-[0.3px] text-ink-3">
          {title} · {count}
        </span>
        <button
          type="button"
          onClick={action.run}
          className="pressable shrink-0 rounded-chip px-1.5 py-0.5 text-ui-xs text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          {action.label}
        </button>
      </div>
      <div className="flex flex-col gap-[2px]">{children}</div>
    </div>
  );
}

function Row({
  file,
  checked,
  onChecked,
  expanded,
  diff,
  onToggle,
  onOpen,
  action,
  onDiscard,
  armed,
}: {
  file: GitChangeFile;
  checked: boolean;
  onChecked: () => void;
  expanded: boolean;
  diff?: GitDiff;
  onToggle: () => void;
  onOpen: () => void;
  action?: { icon: React.ReactNode; label: string; run: () => void };
  onDiscard: () => void;
  armed: boolean;
}) {
  const status = statusOf(file);
  const dir = dirName(file.path);
  const lines = useMemo(() => (diff?.diff ? parseUnifiedDiff(diff.diff, 240).lines : []), [diff]);

  return (
    <div className="flex flex-col">
      <div className={cn("group/scm flex items-center gap-1 rounded-chip pr-0.5", "hover:bg-hover")}>
        {/* checked == in the next commit */}
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={tf("Include {file} in the commit", { file: baseName(file.path) })}
          onClick={onChecked}
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-tiny border ml-1",
            checked ? "border-accent bg-accent text-on-accent" : "border-line-strong text-transparent",
          )}
        >
          <CheckIcon size={10} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-[8px] rounded-chip px-[6px] py-[7px] text-left"
        >
          <ChevronDownIcon
            size={10}
            className={cn("shrink-0 text-ink-3 transition-transform duration-300 ease-out-strong")}
            style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
          <span className={cn("w-3 shrink-0 text-center font-mono text-ui-xs font-semibold", status.tone)} title={t(status.label)}>
            {status.letter}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-ink">
            {baseName(file.path)}
            {dir ? <span className="text-ink-4"> · {dir}</span> : null}
          </span>
          {file.origPath ? (
            <span className="shrink-0 font-mono text-ui-xs text-ink-4" title={file.origPath}>
              ←{baseName(file.origPath)}
            </span>
          ) : null}
        </button>
        {/* hover verbs: the row's own git op, then discard */}
        {action ? (
          <button
            type="button"
            onClick={action.run}
            title={action.label}
            aria-label={action.label}
            className="pressable flex size-5 shrink-0 items-center justify-center rounded-chip text-ink-3 opacity-0 hover:bg-hover-2 hover:text-ink group-hover/scm:opacity-100 focus-visible:opacity-100"
          >
            {action.icon}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          title={t("Open file")}
          aria-label={tf("Open {file}", { file: baseName(file.path) })}
          className="pressable flex size-5 shrink-0 items-center justify-center rounded-chip text-ink-3 opacity-0 hover:bg-hover-2 hover:text-ink group-hover/scm:opacity-100 focus-visible:opacity-100"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6.5 3.5H3v10h10v-3.5" />
            <path d="M9 3h4v4M12.5 3.5 8 8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDiscard}
          title={armed ? t("Click again to discard") : t("Discard change")}
          aria-label={armed ? t("Click again to discard") : t("Discard change")}
          className={cn(
            "pressable flex size-5 shrink-0 items-center justify-center rounded-chip transition-opacity",
            armed ? "bg-hover text-red opacity-100" : "text-ink-3 opacity-0 hover:bg-hover-2 hover:text-red group-hover/scm:opacity-100 focus-visible:opacity-100",
          )}
        >
          <TrashIcon size={11} />
        </button>
      </div>

      {expanded ? (
        <div className="ml-[13px] border-l border-line py-1 pl-2">
          {diff === undefined ? (
            <div className="px-1.5 py-1 text-ui-xs text-ink-3">{t("Loading…")}</div>
          ) : diff.error ? (
            <div className="px-1.5 py-1 text-ui-xs text-red">{diff.error}</div>
          ) : (
            <>
              <DiffPreview lines={lines} file={file.path} />
              {diff.truncated ? (
                <div className="mt-1 px-1.5 text-ui-xs text-ink-4">{t("Diff truncated — open the file to see the rest.")}</div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
