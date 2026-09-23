import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionListItem } from "@shared/types";
import { cn } from "../../lib/cn";
import { GlideList, stagger } from "../motion";
import { Popover } from "../motion";
import {
  ArchiveIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  ListIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";
import { relativeTime } from "../../lib/format";
import { t, tf, useLocale } from "../../lib/i18n";

export type GroupMode = "workspace" | "date" | "status";
export type OrderMode = "recent" | "name";
export type ShowCount = 3 | 5 | 0;

export interface Workspace {
  key: string;
  label: string;
  path?: string;
  sessions: SessionListItem[];
}

export interface WorkspacePrefs {
  group: GroupMode;
  order: OrderMode;
  show: ShowCount;
  statusFilter: "all" | "running" | "failed";
}

const DEFAULT_PREFS: WorkspacePrefs = { group: "workspace", order: "recent", show: 3, statusFilter: "all" };

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || path;
}

function orderSessions(sessions: SessionListItem[], order: OrderMode): SessionListItem[] {
  const sorted = [...sessions];
  if (order === "name") {
    sorted.sort((a, b) => (a.name || a.firstMessage).localeCompare(b.name || b.firstMessage));
  } else {
    sorted.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  }
  return sorted;
}

/**
 * Group sessions into workspaces.
 *
 * Mirrors the reference menu: grouping by workspace (the project folder, which
 * is what a workspace *is*), by date, or by status.
 */
export function groupSessions(sessions: SessionListItem[], prefs: WorkspacePrefs, renamed: Record<string, string>): Workspace[] {
  const filtered =
    prefs.statusFilter === "all"
      ? sessions
      : sessions.filter((session) => session.status === prefs.statusFilter);

  if (prefs.group === "workspace") {
    const map = new Map<string, Workspace>();
    for (const session of filtered) {
      const key = session.cwd || "unknown";
      const workspace = map.get(key) ?? {
        key,
        label: renamed[key] ?? baseName(key),
        path: key,
        sessions: [],
      };
      workspace.sessions.push(session);
      map.set(key, workspace);
    }
    return [...map.values()].sort((a, b) => {
      if (prefs.order === "name") return a.label.localeCompare(b.label);
      const aTime = Math.max(...a.sessions.map((s) => Date.parse(s.modified)));
      const bTime = Math.max(...b.sessions.map((s) => Date.parse(s.modified)));
      return bTime - aTime;
    });
  }

  if (prefs.group === "status") {
    const order: SessionListItem["status"][] = ["running", "failed", "idle", "done"];
    return order
      .map((status) => ({
        key: status,
        label: status === "done" ? "Completed" : status === "idle" ? "Empty" : status === "running" ? "Running" : "Failed",
        sessions: orderSessions(filtered.filter((s) => s.status === status), prefs.order),
      }))
      .filter((workspace) => workspace.sessions.length > 0);
  }

  const now = Date.now();
  const buckets: Array<{ key: string; label: string; max: number }> = [
    { key: "today", label: "Today", max: 36 * 60 * 60 * 1000 },
    { key: "week", label: "This week", max: 7 * 86_400_000 },
    { key: "month", label: "This month", max: 30 * 86_400_000 },
    { key: "older", label: "Earlier", max: Number.POSITIVE_INFINITY },
  ];
  return buckets
    .map((bucket, index) => ({
      key: bucket.key,
      label: bucket.label,
      sessions: orderSessions(
        filtered.filter((session) => {
          const age = now - Date.parse(session.modified);
          const lower = index === 0 ? 0 : buckets[index - 1].max;
          return age > lower && age <= bucket.max;
        }),
        prefs.order,
      ),
    }))
    .filter((workspace) => workspace.sessions.length > 0);
}

import type { AppOpener } from "@shared/workspace";

/**
 * "Open with" for a folder — the applications the OS has registered, exactly
 * like the file viewer's menu: the file manager to reveal it, plus every IDE
 * and editor the machine actually has. Nothing is hard-coded.
 */
/**
 * Open a folder straight away — in whatever the user last picked (the
 * titlebar's split button remembers), defaulting to the file manager. The
 * opener *menu* lives on the titlebar control; rows here are one click.
 */
function openFolderDirect(path: string) {
  let last: string | null = null;
  try {
    last = localStorage.getItem("pi-last-folder-opener") || null;
  } catch {}
  if (last && last !== "reveal") {
    void window.pi.openWith(path, last).catch(() => void window.pi.revealFile(path));
    return;
  }
  void window.pi.revealFile(path);
}

function FolderOpenButton({ path, className }: { path?: string; className?: string }) {
  const wrapper = useRef<HTMLDivElement>(null);

  if (!path) return null;

  return (
    <div ref={wrapper} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-expanded={false}
        aria-label={t("Open folder")}
        title={t("Open folder")}
        onClick={(event) => {
          event.stopPropagation();
          openFolderDirect(path);
        }}
        className="pressable flex size-5.5 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
      >
        <FolderOpenIcon size={11} />
      </button>
    </div>
  );
}

function StatusGlyph({ status }: { status: SessionListItem["status"] }) {
  if (status === "running") return <LoaderIcon size={12} className="spin-fast text-accent" />;
  if (status === "failed") return <span className="size-[7px] rounded-full bg-red" />;
  return <span className="size-[7px] rounded-full bg-line-strong" />;
}

export function MenuRow({
  label,
  value,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  value?: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-row
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "glide-row pressable flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left",
        disabled && "opacity-40",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label}</span>
      {value ? <span className="shrink-0 text-[11.5px] text-ink-3">{value}</span> : null}
      {hint ? <span className="shrink-0 font-mono text-[10.5px] text-ink-3 tabular-nums">{hint}</span> : null}
    </button>
  );
}

/**
 * Workspaces.
 *
 * Collapsed by default, and **nothing inside a collapsed workspace is
 * rendered** — an expanded workspace shows at most `show` sessions with a
 * "load more" row, so opening the app on a machine with hundreds of sessions
 * costs nothing until you ask for it.
 */
export function WorkspaceList({
  sessions,
  prefs,
  onPrefs,
  renamed,
  activePath,
  readAt,
  onReadAll,
  onSelect,
  onRename,
  onAddFolder,
  onNewInWorkspace,
  /** the folder the session is currently bound to — the header's open-with target */
  cwd,
}: {
  sessions: SessionListItem[];
  prefs: WorkspacePrefs;
  onPrefs: (patch: Partial<WorkspacePrefs>) => void;
  renamed: Record<string, string>;
  activePath?: string;
  readAt: Record<string, number>;
  onReadAll: () => void;
  onSelect: (path: string) => void;
  onRename: (key: string, label: string) => void;
  onAddFolder: () => void;
  onNewInWorkspace?: (cwd: string) => void;
  cwd?: string;
}) {
  // collapsed by default: an empty map means every workspace starts closed
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const [draft, setDraft] = useState("");
  /* Context menu state on right click of a workspace row */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    workspace: Workspace;
    isArchived: boolean;
    /** set after the first click on Delete — the row becomes the confirm */
    confirming?: boolean;
  } | null>(null);

  /* Archived workspaces */
  const [archived, setArchived] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("pi-workspace-archived");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [showArchived, setShowArchived] = useState(false);

  /* Archived sessions — hidden from every workspace list; the marker persists
   * so a rescan does not resurrect them */
  const [archivedSessions, setArchivedSessions] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("pi-session-archived");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("pi-session-archived", JSON.stringify(archivedSessions));
    } catch {}
  }, [archivedSessions]);

  const archiveSession = (path: string) => {
    setArchivedSessions((current) => ({ ...current, [path]: true }));
  };

  /* The conversation you just picked. The host takes a round trip to switch the
   * session, so the row answers the click itself: it highlights immediately and
   * holds keyboard focus, which is also what lets the next arrow key move. */
  const [picked, setPicked] = useState<string | null>(null);
  useLocale();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-ws-context-menu]")) {
        setContextMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!picked) return;
    rowRefs.current.get(picked)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setPicked(null), 1200);
    return () => window.clearTimeout(timer);
  }, [picked]);

  const toggleArchive = (key: string) => {
    setArchived((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      localStorage.setItem("pi-workspace-archived", JSON.stringify(next));
      return next;
    });
  };

  const openInIde = async (path?: string) => {
    if (!path) return;
    try {
      const openers = await window.pi.listOpeners(path);
      const ide = openers.find((o) => /cursor|code|windsurf/i.test(o.id) || /cursor|code|windsurf/i.test(o.name));
      if (ide) {
        await window.pi.openWith(path, ide.id);
      } else {
        await window.pi.openPath(path);
      }
    } catch {
      void window.pi.openPath(path);
    }
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    try {
      await window.pi.deleteWorkspace(workspace.path || workspace.key);
    } catch (err) {
      console.error("Failed to delete workspace:", err);
    }
  };

  const choose = (path: string) => {
    setPicked(path);
    onSelect(path);
  };

  const workspaces = useMemo(() => groupSessions(sessions, prefs, renamed), [sessions, prefs, renamed]);
  const activeWorkspaces = useMemo(() => workspaces.filter((w) => !archived[w.key]), [workspaces, archived]);
  const archivedWorkspaces = useMemo(() => workspaces.filter((w) => Boolean(archived[w.key])), [workspaces, archived]);
  const allOpen = activeWorkspaces.length > 0 && activeWorkspaces.every((workspace) => open[workspace.key]);

  if (!sessions.length) {
    return (
      <div className="flex flex-col gap-2 px-3 py-4">
        <span className="text-[11.5px] text-ink-3">{t("No sessions yet.")}</span>
        <button
          type="button"
          onClick={onAddFolder}
          className="pressable inline-flex h-7 w-fit items-center gap-1.5 rounded-chip bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
        >
          <PlusIcon size={11} />
          {t("Add a folder")}
        </button>
      </div>
    );
  }

  const unread = sessions.filter((session) => Date.parse(session.modified) > (readAt[session.path] ?? 0)).length;

  const renderWorkspace = (workspace: Workspace, groupIndex: number, isArchived = false) => {
    const isOpen = Boolean(open[workspace.key]);
    const sorted = workspace.sessions.filter((session) => !archivedSessions[session.path]);
    const limit = prefs.show === 0 ? sorted.length : prefs.show;
    const isExpanded = Boolean(expanded[workspace.key]);
    const visible = isExpanded ? sorted : sorted.slice(0, limit);
    const hidden = sorted.length - visible.length;
    const running = sorted.some((session) => session.status === "running");

    return (
      <section key={workspace.key} className="mb-1.5" style={stagger(groupIndex)}>
        {/* one hover surface for the whole row: the folder toggle and the
            new-chat button ride in it, so the two read as a single component */}
        <div
          className="group/ws flex items-center rounded-[7px] px-1 hover:bg-hover-2"
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              workspace,
              isArchived,
            });
          }}
        >
          <button
            type="button"
            onClick={() => setOpen((current) => ({ ...current, [workspace.key]: !isOpen }))}
            className="pressable flex h-8 min-w-0 flex-1 items-center gap-1.5 px-1 text-left"
          >
            <span className="relative flex size-3.5 shrink-0 items-center justify-center text-ink-3">
              <FolderIcon
                size={13}
                className="absolute transition-opacity duration-150 group-hover/ws:opacity-0"
              />
              <ChevronDownIcon
                size={12}
                strokeWidth={2.2}
                className="absolute opacity-0 transition-[opacity,transform] duration-150 group-hover/ws:opacity-100"
                style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{workspace.label}</span>
            {running ? <StatusGlyph status="running" /> : null}
            <span className="shrink-0 text-[10.5px] text-ink-3 tabular-nums">{sorted.length}</span>
          </button>
          {/* hover affordances on the workspace row: open the folder itself
              (with an opener menu), then start a chat inside it */}
          <FolderOpenButton
            path={workspace.path || workspace.key}
            className="opacity-0 group-hover/ws:opacity-100"
          />
          <button
            type="button"
            title={t("New chat in this workspace")}
            aria-label={t("New chat in this workspace")}
            onClick={(event) => {
              event.stopPropagation();
              onNewInWorkspace?.(workspace.path || workspace.key);
            }}
            className="pressable flex size-5.5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover/ws:opacity-100"
          >
            <PlusIcon size={12} />
          </button>
        </div>

        {renaming?.key === workspace.key ? (
          <form
            className="mx-1 mb-1.5 flex items-center gap-1 rounded-[7px] bg-surface p-1 shadow-hairline"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}
            onSubmit={(event) => {
              event.preventDefault();
              onRename(workspace.key, draft.trim() || workspace.label);
              setRenaming(null);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(null);
              }}
              aria-label={t("Workspace name")}
              className="h-6 min-w-0 flex-1 rounded-[5px] bg-field px-1.5 text-[11.5px] text-ink outline-none"
            />
            <button type="submit" className="pressable h-6 rounded-[5px] bg-ink px-2 text-[11px] text-canvas">
              {t("Save")}
            </button>
          </form>
        ) : null}

        {/* collapsed workspaces render nothing at all — no preload */}
        <div className="collapse-grid" data-open={isOpen}>
          <div className="min-h-0 overflow-hidden">
            {/* no container indent: the row's own pl-[24px] supplies the visual
                indent, so the hover glide, the picked surface and the row share
                the same left and right edges */}
            {isOpen ? (
              <GlideList className="flex flex-col gap-0.5 pt-0.5">
                {visible.map((session, index) => {
                  const isUnread = Date.parse(session.modified) > (readAt[session.path] ?? 0);
                  const active = session.path === activePath || session.path === picked;
                  return (
                    /* the archive affordance overlays the row's right edge, so
                       the row and its hover action share one wrapper */
                    <div key={session.path} className="group/srow relative">
                      <button
                        data-row
                        data-picked={session.path === picked ? "true" : undefined}
                        ref={(element) => {
                          if (element) rowRefs.current.set(session.path, element);
                          else rowRefs.current.delete(session.path);
                        }}
                        type="button"
                        onClick={() => choose(session.path)}
                        style={stagger(index)}
                        className={cn(
                          "glide-row pressable flex w-full items-center gap-2 rounded-[6px] py-1.5 pr-2 pl-[24px] text-left outline-none",
                          "focus-visible:bg-surface focus-visible:shadow-hairline",
                          active && "row-picked bg-surface shadow-hairline",
                        )}
                      >
                        {/* the unread dot lives on the message it belongs to —
                            and the slot is permanent, so the titles of read and
                            unread rows stay on the same vertical line */}
                        <span className="flex size-1.5 shrink-0 items-center justify-center">
                          {isUnread ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px]",
                            active ? "font-medium text-ink" : isUnread ? "text-ink" : "text-ink-2",
                          )}
                        >
                          {session.name || session.firstMessage || "New session"}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-3 tabular-nums group-hover/srow:opacity-0">
                          {relativeTime(session.modified)}
                        </span>
                      </button>
                      {/* hover archive: sits where the timestamp was, so the
                          row never reflows */}
                      <button
                        type="button"
                        title={t("Archive session")}
                        aria-label={t("Archive session")}
                        onClick={(event) => {
                          event.stopPropagation();
                          archiveSession(session.path);
                        }}
                        className="pressable absolute top-1/2 right-1 flex size-5.5 -translate-y-1/2 items-center justify-center rounded-[5px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover/srow:opacity-100"
                      >
                        <ArchiveIcon size={12} />
                      </button>
                    </div>
                  );
                })}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [workspace.key]: true }))}
                    className="pressable flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                  >
                    <ChevronDownIcon size={10} />
                    {tf("Show {count} more", { count: hidden })}
                  </button>
                ) : null}
                {isExpanded && sorted.length > limit ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [workspace.key]: false }))}
                    className="pressable flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                  >
                    <ChevronDownIcon size={10} className="rotate-180" />
                    {t("Show less")}
                  </button>
                ) : null}
              </GlideList>
            ) : null}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header — the workspace's own controls: the filter menu, then the
          folder opener on its right. The pane's collapse toggle lives at the
          very top of the sidebar, above New Agent, not here. */}
      <div className="flex items-center gap-1 px-2.5 pb-1">
        <span className="text-[11px] tracking-[0.3px] text-ink-3">{t("Workspaces")}</span>
        <span className="flex-1" />
        <div className="relative">
          <button
            type="button"
            data-popover-trigger
            aria-label={t("Workspace options")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              "pressable flex size-5.5 items-center justify-center rounded-[5px]",
              menuOpen ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
            )}
          >
            <ListIcon size={11} />
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchor="top-right" className="w-52 p-1">
            <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
              <MenuRow
                label={t("Grouping")}
                value={
                  prefs.group === "workspace" ? t("Workspace") : prefs.group === "date" ? t("Date") : t("Status")
                }
                onClick={() =>
                  onPrefs({
                    group: prefs.group === "workspace" ? "date" : prefs.group === "date" ? "status" : "workspace",
                  })
                }
              />
              <MenuRow
                label={t("Ordering")}
                value={prefs.order === "recent" ? t("Recent") : t("Name")}
                onClick={() => onPrefs({ order: prefs.order === "recent" ? "name" : "recent" })}
              />
              <MenuRow
                label={t("Show")}
                value={prefs.show === 0 ? t("All") : `${prefs.show} ${t("chats")}`}
                onClick={() => onPrefs({ show: prefs.show === 3 ? 5 : prefs.show === 5 ? 0 : 3 })}
              />

              <div className="my-1 border-t border-line px-2 pt-1.5 pb-0.5 text-[10.5px] tracking-[0.4px] text-ink-3">
                {t("FILTERS")}
              </div>
              <MenuRow
                label={t("Status")}
                value={
                  prefs.statusFilter === "all" ? t("Any") : prefs.statusFilter === "running" ? t("Running") : t("Failed")
                }
                onClick={() =>
                  onPrefs({
                    statusFilter:
                      prefs.statusFilter === "all" ? "running" : prefs.statusFilter === "running" ? "failed" : "all",
                  })
                }
              />
              <MenuRow label="PR" value="—" disabled />
              <MenuRow label="Environment" value="—" disabled />

              <div className="my-1 border-t border-line" />
              <MenuRow
                label={allOpen ? t("Expand All") : t("Collapse All")}
                onClick={() => {
                  if (allOpen) setOpen({});
                  else setOpen(Object.fromEntries(workspaces.map((workspace) => [workspace.key, true])));
                }}
              />
              <MenuRow label={t("Mark All as Read")} hint={unread ? String(unread) : undefined} onClick={onReadAll} />
            </GlideList>
          </Popover>
        </div>
        {/* the session's own folder, opened with whatever the machine has —
            the file manager, an IDE, the default handler */}
        <FolderOpenButton path={cwd} />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        {activeWorkspaces.map((workspace, groupIndex) => renderWorkspace(workspace, groupIndex, false))}

        {archivedWorkspaces.length > 0 ? (
          <div className="mt-2.5 border-t border-line/60 pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="pressable flex h-6 w-full items-center gap-1.5 rounded-[5px] px-1 text-left text-[11px] text-ink-3 hover:bg-hover-2 hover:text-ink-2"
            >
              <ChevronDownIcon
                size={10}
                className={cn("transition-transform duration-200", showArchived ? "rotate-0" : "-rotate-90")}
              />
              <span>{tf("Archived ({count})", { count: archivedWorkspaces.length })}</span>
            </button>
            {showArchived ? (
              <div className="mt-1 flex flex-col opacity-80">
                {archivedWorkspaces.map((ws, i) => renderWorkspace(ws, i, true))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {contextMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-ws-context-menu
              className="fixed z-50 w-48 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-overlay"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 202),
                top: Math.min(contextMenu.y, window.innerHeight - 226),
                animation: "pop-in 140ms cubic-bezier(0.23,1,0.32,1) both",
                transformOrigin: "top left",
              }}
            >
              <div className="mb-1 truncate border-b border-line px-2 py-1.5 font-mono text-[10.5px] text-ink-3">
                {contextMenu.workspace.label}
              </div>
              <ContextRow
                icon={<PlusIcon size={12} />}
                label={t("New chat")}
                onClick={() => {
                  onNewInWorkspace?.(contextMenu.workspace.path || contextMenu.workspace.key);
                  setContextMenu(null);
                }}
              />
              <ContextRow
                icon={<PencilIcon size={12} />}
                label={t("Rename")}
                onClick={() => {
                  setRenaming({ key: contextMenu.workspace.key, label: contextMenu.workspace.label });
                  setDraft(contextMenu.workspace.label);
                  setContextMenu(null);
                }}
              />
              <ContextRow
                icon={<FolderOpenIcon size={12} />}
                label={t("Open in IDE")}
                onClick={() => {
                  void openInIde(contextMenu.workspace.path || contextMenu.workspace.key);
                  setContextMenu(null);
                }}
              />
              <ContextRow
                icon={<FolderIcon size={12} />}
                label={contextMenu.isArchived ? t("Unarchive") : t("Archive workspace")}
                onClick={() => {
                  toggleArchive(contextMenu.workspace.key);
                  setContextMenu(null);
                }}
              />
              <div className="my-1 h-px bg-line" />
              {/* delete is a two-step row: the first click arms it, the second
                  fires — no native confirm dialog in a custom-styled shell */}
              <ContextRow
                danger
                armed={contextMenu.confirming}
                icon={<TrashIcon size={12} />}
                label={contextMenu.confirming ? t("Click again to delete") : t("Delete workspace")}
                onClick={() => {
                  if (!contextMenu.confirming) {
                    setContextMenu({ ...contextMenu, confirming: true });
                    return;
                  }
                  setContextMenu(null);
                  void handleDeleteWorkspace(contextMenu.workspace);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** One row of the workspace context menu — same metrics as MenuRow so every
 *  menu in the app reads as the same component. */
function ContextRow({
  icon,
  label,
  danger,
  armed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  /** the armed state of a dangerous row: filled tint, waiting for the second click */
  armed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px]",
        danger ? (armed ? "bg-red-tint font-medium text-red" : "text-red hover:bg-red-tint") : "text-ink hover:bg-hover",
      )}
    >
      <span className={cn("flex size-3.5 shrink-0 items-center justify-center", !danger && "text-ink-3")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
