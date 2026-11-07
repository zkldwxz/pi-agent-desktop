import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionListItem } from "@shared/types";
import { cn } from "../../lib/cn";
import { GlideList, stagger } from "../motion";
import { Popover } from "../motion";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";
import { relativeTime } from "../../lib/format";
import { t, tf, useLocale } from "../../lib/i18n";

export type GroupMode = "workspace" | "date" | "status" | "groups";
export type OrderMode = "recent" | "name";
export type ShowCount = 3 | 5 | 0;

/**
 * The task-group mode's own data: named groups a chat can be dragged into.
 * `order` lists the group names; `assign` maps a session file to one of them.
 * Sessions with no assignment read as one trailing "Ungrouped" bucket.
 */
export interface SessionGroups {
  order: string[];
  assign: Record<string, string>;
}

const SESSION_GROUPS_KEY = "pi-session-groups";

export function loadSessionGroups(): SessionGroups {
  try {
    const raw = localStorage.getItem(SESSION_GROUPS_KEY);
    if (!raw) return { order: [], assign: {} };
    const parsed = JSON.parse(raw) as Partial<SessionGroups>;
    return { order: Array.isArray(parsed.order) ? parsed.order : [], assign: parsed.assign ?? {} };
  } catch {
    return { order: [], assign: {} };
  }
}

const WORKSPACE_FOLDERS_KEY = "pi-workspace-folders";

/** Trailing slashes and separators differ between the dialog, the host and the
 *  session headers; the registry and the session map must agree on identity. */
export function normalizeFolder(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/");
}

function sameFolder(left: string, right: string): boolean {
  if (!left || !right) return false;
  return normalizeFolder(left).toLowerCase() === normalizeFolder(right).toLowerCase();
}

/**
 * Folders the user opened on this machine, newest first.
 *
 * pi keeps a new session's file in memory until its first assistant reply
 * flushes, so a folder picked moments ago has no `.jsonl` on disk and nothing
 * for the session scan to group — without this register the folder never
 * becomes a workspace until its first chat finishes a turn.
 */
export function loadWorkspaceFolders(): string[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_FOLDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string") : [];
  } catch {
    return [];
  }
}

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
export function groupSessions(
  sessions: SessionListItem[],
  prefs: WorkspacePrefs,
  renamed: Record<string, string>,
  custom?: SessionGroups,
  knownFolders?: string[],
  homeDir?: string,
): Workspace[] {
  const filtered =
    prefs.statusFilter === "all"
      ? sessions
      : sessions.filter((session) => session.status === prefs.statusFilter);

  /* The task-group mode: flat and always expanded, no folder management. The
   * user's own named groups first, everything unassigned trails in one
   * bucket — so a chat never disappears just because no group claims it. */
  if (prefs.group === "groups") {
    const buckets = new Map<string, Workspace>();
    for (const name of custom?.order ?? []) {
      buckets.set(name, { key: `group:${name}`, label: name, sessions: [] });
    }
    const loose: SessionListItem[] = [];
    for (const session of orderSessions(filtered, prefs.order)) {
      const name = custom?.assign[session.path];
      const bucket = name ? buckets.get(name) : undefined;
      if (bucket) bucket.sessions.push(session);
      else loose.push(session);
    }
    const out = [...buckets.values()];
    if (loose.length) out.push({ key: "group:__ungrouped", label: t("Ungrouped"), sessions: loose });
    return out;
  }

  if (prefs.group === "workspace") {
    const map = new Map<string, Workspace>();
    if (homeDir) {
      map.set(homeDir, { key: homeDir, label: t("Home"), path: homeDir, sessions: [] });
    }
    for (const session of filtered) {
      const isHome = Boolean(homeDir && session.cwd && (session.cwd === "~" || sameFolder(session.cwd, homeDir)));
      const key = isHome ? homeDir! : session.cwd || "unknown";
      const workspace = map.get(key) ?? {
        key,
        label: isHome ? t("Home") : renamed[key] ?? baseName(key),
        path: key,
        sessions: [],
      };
      workspace.sessions.push(session);
      map.set(key, workspace);
    }
    /* Registered folders whose sessions have not flushed to disk yet. A folder
     * the user just opened must show up now, not after its first turn ends —
     * empty ones sort last because they have no mtime to order by. */
    for (const folder of knownFolders ?? []) {
      const key = normalizeFolder(folder);
      if (homeDir && (folder === "~" || sameFolder(folder, homeDir))) continue;
      if ([...map.keys()].some((existing) => normalizeFolder(existing) === key)) continue;
      map.set(folder, {
        key: folder,
        label: renamed[folder] ?? baseName(folder),
        path: folder,
        sessions: [],
      });
    }
    return [...map.values()].sort((a, b) => {
      if (homeDir && sameFolder(a.path ?? a.key, homeDir)) return -1;
      if (homeDir && sameFolder(b.path ?? b.key, homeDir)) return 1;
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
  void (async () => {
    if (last && last !== "reveal") {
      const opened = await window.pi.openWith(path, last);
      if (opened.ok) return;
    }
    await window.pi.revealFile(path);
  })().catch(() => undefined);
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
        className="pressable flex size-5.5 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
      >
        <FolderOpenIcon size={11} />
      </button>
    </div>
  );
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
        "glide-row pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left",
        disabled && "opacity-40",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-ui-base text-ink">{label}</span>
      {value ? <span className="shrink-0 text-ui-sm text-ink-3">{value}</span> : null}
      {hint ? <span className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">{hint}</span> : null}
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
  onNewInWorkspace,
  onNewInGroup,
  sessionGroups,
  onSessionGroups,
  /** the folder the session is currently bound to — the header's open-with target */
  cwd,
  /** canonical home directory; its workspace is the no-project Home entry */
  homeDir,
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
  onNewInWorkspace?: (cwd: string) => void;
  /** start a chat and drop it straight into this task group */
  onNewInGroup?: (group: string) => void;
  sessionGroups: SessionGroups;
  onSessionGroups: (next: SessionGroups) => void;
  cwd?: string;
  homeDir?: string;
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
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupMenu, setGroupMenu] = useState<{ name: string; x: number; y: number; confirming?: boolean } | null>(null);

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

  /* Folders opened on this machine that no session scan can vouch for yet. */
  const [knownFolders, setKnownFolders] = useState<string[]>(loadWorkspaceFolders);
  const [savedWorkspaces, setSavedWorkspaces] = useState<import("@shared/workspaces").WorkspaceInfo[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => void window.pi.listWorkspaces().then((rows) => { if (active) setSavedWorkspaces(rows); }).catch(() => {});
    refresh();
    const unsubscribe = window.pi.onWorkspaceChange(refresh);
    return () => { active = false; unsubscribe(); };
  }, [cwd, sessions.length]);
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_FOLDERS_KEY, JSON.stringify(knownFolders));
    } catch {}
  }, [knownFolders]);

  /* Whatever folder the session is bound to *is* a workspace on this machine.
   * Registering it here covers every route into a folder — the greeting
   * switcher, the sidebar's add, the palette — without each of them having to
   * remember to report back. */
  useEffect(() => {
    if (!cwd) return;
    const key = normalizeFolder(cwd);
    setKnownFolders((current) =>
      current.some((path) => normalizeFolder(path) === key) ? current : [cwd, ...current].slice(0, 30),
    );
  }, [cwd]);

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
    if (!groupMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-ws-context-menu]")) {
        setGroupMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [groupMenu]);

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

  const isRemoteFolder = (path?: string) => Boolean(path && savedWorkspaces.some((workspace) => workspace.sshId && normalizeFolder(workspace.cwd) === normalizeFolder(path)));
  const openInIde = async (path?: string) => {
    if (!path || isRemoteFolder(path)) return;
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
      /* A folder registered before its first session flushed has nothing on
       * disk for the host to delete — there the registry entry *is* the
       * workspace, so removing it here is the whole deletion. */
      const key = normalizeFolder(workspace.path || workspace.key);
      setKnownFolders((current) => current.filter((path) => normalizeFolder(path) !== key));
    } catch (err) {
      console.error("Failed to delete workspace:", err);
    }
  };

  const choose = (path: string) => {
    setPicked(path);
    onSelect(path);
  };

  const workspaces = useMemo(
    () => {
      const names = { ...renamed };
      for (const row of savedWorkspaces) names[row.cwd] = row.sshId ? `SSH · ${row.name}` : row.name;
      return groupSessions(sessions, prefs, names, sessionGroups, [...new Set([...knownFolders, ...savedWorkspaces.map((row) => row.cwd)])], homeDir);
    },
    [sessions, prefs, renamed, sessionGroups, knownFolders, homeDir, savedWorkspaces],
  );

  /* Task-group mode: flat and always expanded, so every group renders its rows
   * unconditionally and the collapse state below is never consulted. */
  const isGroups = prefs.group === "groups";

  const assignSession = (path: string, group: string | null) => {
    const assign = { ...sessionGroups.assign };
    if (group) assign[path] = group;
    else delete assign[path];
    onSessionGroups({ ...sessionGroups, assign });
  };

  const createGroup = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || sessionGroups.order.includes(trimmed)) return;
    onSessionGroups({ order: [...sessionGroups.order, trimmed], assign: { ...sessionGroups.assign } });
  };

  const renameGroup = (from: string, to: string) => {
    const trimmed = to.trim();
    if (!trimmed || trimmed === from || sessionGroups.order.includes(trimmed)) return;
    const assign = { ...sessionGroups.assign };
    for (const [path, name] of Object.entries(assign)) {
      if (name === from) assign[path] = trimmed;
    }
    onSessionGroups({
      order: sessionGroups.order.map((name) => (name === from ? trimmed : name)),
      assign,
    });
  };

  const deleteGroup = (name: string) => {
    const assign = { ...sessionGroups.assign };
    for (const [path, group] of Object.entries(assign)) {
      if (group === name) delete assign[path];
    }
    onSessionGroups({ order: sessionGroups.order.filter((group) => group !== name), assign });
  };

  const activeWorkspaces = useMemo(
    () => workspaces.filter((w) => !archived[w.key] || Boolean(homeDir && sameFolder(w.path || w.key, homeDir))),
    [workspaces, archived, homeDir],
  );
  const archivedWorkspaces = useMemo(
    () => workspaces.filter((w) => Boolean(archived[w.key]) && !(homeDir && sameFolder(w.path || w.key, homeDir))),
    [workspaces, archived, homeDir],
  );
  /* Untouched workspaces start open when they are the folder you are in or
   * among the first three (baocode lists each project's chats right away);
   * a click on the row is remembered over this default either way. The
   * per-workspace `show` cap keeps the render bounded. */
  const isWorkspaceOpen = (workspace: Workspace, index: number, isArchived = false): boolean => {
    const remembered = open[workspace.key];
    if (remembered !== undefined) return remembered;
    if (isArchived) return false;
    return index < 3 || Boolean(cwd && sameFolder(workspace.path || workspace.key, cwd));
  };
  const allOpen =
    activeWorkspaces.length > 0 && activeWorkspaces.every((workspace, index) => isWorkspaceOpen(workspace, index));

  /* Home is a real, always-available entry in workspace mode, even before the
   * first prompt creates a session file. Other grouping modes can still show a
   * quiet empty state without offering a second folder-opening control. */
  if (!sessions.length && prefs.group !== "workspace") {
    return <div className="px-3 py-4 text-ui-sm text-ink-3">{t("No sessions yet.")}</div>;
  }

  const unread = sessions.filter((session) => Date.parse(session.modified) > (readAt[session.path] ?? 0)).length;

  const renderWorkspace = (workspace: Workspace, groupIndex: number, isArchived = false) => {
    const isOpen = isGroups || isWorkspaceOpen(workspace, groupIndex, isArchived);
    const sorted = workspace.sessions.filter((session) => !archivedSessions[session.path]);
    /* task groups have no "show N more" gate — the mode exists to lay every
     * chat out flat, so the whole bucket renders */
    const limit = isGroups ? sorted.length : prefs.show === 0 ? sorted.length : prefs.show;
    const isExpanded = Boolean(expanded[workspace.key]);
    const visible = isExpanded ? sorted : sorted.slice(0, limit);
    const hidden = sorted.length - visible.length;
    const isHome = Boolean(homeDir && sameFolder(workspace.path || workspace.key, homeDir));

    return (
      <section key={workspace.key} style={stagger(groupIndex)}>
        {/* one hover surface for the whole row: the folder toggle and the
            new-chat button ride in it, so the two read as a single component */}
        {isGroups ? (
          <div
            className={cn("group/ws flex items-center rounded-chip px-1 hover:bg-hover-2", dragOver === workspace.key && "bg-hover-2 shadow-hairline")}
            onContextMenu={(event) => {
              if (workspace.key === "group:__ungrouped") return;
              event.preventDefault();
              setGroupMenu({ name: workspace.label, x: event.clientX, y: event.clientY });
            }}
            onDragOver={(event) => {
              if (!dragPath) return;
              event.preventDefault();
              setDragOver(workspace.key);
            }}
            onDragLeave={() => setDragOver((key) => (key === workspace.key ? null : key))}
            onDrop={(event) => {
              event.preventDefault();
              const path = dragPath ?? event.dataTransfer.getData("text/plain");
              setDragOver(null);
              setDragPath(null);
              if (path) assignSession(path, workspace.key === "group:__ungrouped" ? null : workspace.label);
            }}
          >
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-1">
              <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">
                <LayersIcon size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-ui-base text-ink-2">{workspace.label}</span>
              <span className="shrink-0 text-ui-xs text-ink-3 tabular-nums">{sorted.length}</span>
            </div>
            {workspace.key !== "group:__ungrouped" ? (
              <button
                type="button"
                title={t("New chat in this group")}
                aria-label={t("New chat in this group")}
                onClick={() => onNewInGroup?.(workspace.label)}
                className="pressable flex size-5.5 shrink-0 items-center justify-center rounded-chip text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover/ws:opacity-100"
              >
                <PlusIcon size={12} />
              </button>
            ) : null}
          </div>
        ) : (
        <div
          className="group/ws relative mt-1.5 flex h-[26px] items-center rounded-[5px] hover:bg-hover"
          onContextMenu={(event) => {
            event.preventDefault();
            if (isHome) return;
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
            className="pressable flex h-full min-w-0 flex-1 items-center gap-0.5 pr-0.5 pl-1 text-left"
          >
            {/* chevron_right 15, turned a quarter while open (150ms), faint →
                muted on hover */}
            <ChevronRightIcon
              size={15}
              strokeWidth={2}
              className="shrink-0 text-ink-4 transition-[transform,color] duration-150 group-hover/ws:text-ink-2"
              style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            />
            {isHome ? <HomeIcon size={14} className="mr-0.5 shrink-0 text-ink-2" /> : null}
            <span className="min-w-0 flex-1 truncate text-ui-caption font-medium text-ink">{isHome ? t("Home") : workspace.label}</span>
            {/* the count says how much is folded away, so it only shows while
                folded (baocode); it sits on the same right edge as the session
                times below and gives way to the hover actions */}
            {!isOpen && sorted.length > 0 ? (
              <span className="shrink-0 pr-1.5 text-ui-xs text-ink-4 tabular-nums group-hover/ws:opacity-0">{sorted.length}</span>
            ) : null}
          </button>
          {/* hover actions float over the row's right end instead of taking
              width, so the count and the session times share one column */}
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 group-hover/ws:opacity-100 focus-within:opacity-100">
          {/* hover affordances on the workspace row: open the folder itself
              (with an opener menu), then start a chat inside it */}
          {/* SSH cwd is only a local session anchor. Local folder openers
              must not reveal it as though it were the remote project. */}
          <FolderOpenButton
            path={isRemoteFolder(workspace.path || workspace.key) ? undefined : workspace.path || workspace.key}
          />
          <button
            type="button"
            title={t("New chat in this workspace")}
            aria-label={t("New chat in this workspace")}
            onClick={(event) => {
              event.stopPropagation();
              onNewInWorkspace?.(workspace.path || workspace.key);
            }}
            className="pressable flex size-5.5 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <PlusIcon size={12} />
          </button>
          </div>
        </div>
        )}

        {renaming?.key === workspace.key ? (
          <form
            className="mx-1 mb-1.5 flex items-center gap-1 rounded-chip bg-surface p-1 shadow-hairline"
            style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both" }}
            onSubmit={(event) => {
              event.preventDefault();
              if (isGroups) renameGroup(workspace.label, draft.trim() || workspace.label);
              else onRename(workspace.key, draft.trim() || workspace.label);
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
              className="h-6 min-w-0 flex-1 rounded-chip bg-field px-1.5 text-ui-sm text-ink outline-none"
            />
            <button type="submit" className="pressable h-6 rounded-chip bg-ink px-2 text-ui-sm text-canvas">
              {t("Save")}
            </button>
          </form>
        ) : null}

        {/* collapsed workspaces render nothing at all — no preload */}
        <div className="collapse-grid" data-open={isOpen}>
          <div className="min-h-0 overflow-hidden">
            {/* no container indent: the row's own left padding supplies the
                visual indent, so the hover glide, the picked surface and the
                row share the same left and right edges */}
            {isOpen ? (
              <GlideList className="flex flex-col">
                {/* a registered folder has no rows to lay out yet — say so, so
                    expanding it does not read as a broken toggle */}
                {!sorted.length ? (
                  <div className="flex h-[22px] items-center pl-[34px] text-ui-sm text-ink-4">{t("No chats here yet")}</div>
                ) : null}
                {visible.map((session, index) => {
                  const isUnread = Date.parse(session.modified) > (readAt[session.path] ?? 0);
                  const active = session.path === activePath || session.path === picked;
                  return (
                    /* the archive affordance overlays the row's right edge, so
                       the row and its hover action share one wrapper */
                    <div
                      key={session.path}
                      className="group/srow relative"
                      draggable={isGroups}
                      onDragStart={(event) => {
                        setDragPath(session.path);
                        event.dataTransfer.setData("text/plain", session.path);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragPath(null)}
                    >
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
                          "glide-row pressable mx-1 flex h-[22px] w-[calc(100%-8px)] items-center gap-1.5 rounded-[5px] pr-1 pl-2 text-left outline-none hover:bg-hover",
                          "focus-visible:bg-surface focus-visible:shadow-hairline",
                          /* baocode: the picked chat takes the selection tint */
                          active && "row-picked bg-accent-tint",
                        )}
                      >
                        {/* the left slot carries the run state: a spinner while
                            the task is live, the unread dot only once it has
                            finished and not been opened yet. The slot is the
                            same width as the workspace row's icon slot above,
                            so both rows put their glyphs and their labels on
                            one column */}
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {session.status === "running" ? (
                            <LoaderIcon size={12} className="spin-fast shrink-0 text-accent" />
                          ) : isUnread ? (
                            <span className="size-[7px] rounded-full bg-accent" />
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-ui-caption",
                            isUnread && !active ? "font-semibold text-ink" : "text-ink",
                          )}
                        >
                          {session.name || session.firstMessage || "New session"}
                        </span>
                        <span
                          data-sidebar-time
                          className="min-w-[26px] shrink-0 text-right text-ui-xs text-ink-4 tabular-nums group-hover/srow:opacity-0"
                        >
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
                        className="pressable absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] text-ink-2 opacity-0 hover:bg-hover hover:text-ink group-hover/srow:opacity-100"
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
                    className="pressable mx-1 flex h-[22px] items-center rounded-[5px] pr-1 pl-[30px] text-ui-sm text-ink-4 hover:bg-hover hover:text-ink-2"
                  >
                    {tf("Show more ({count})", { count: hidden })}
                  </button>
                ) : null}
                {isExpanded && sorted.length > limit ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [workspace.key]: false }))}
                    className="pressable mx-1 flex h-[22px] items-center rounded-[5px] pr-1 pl-[30px] text-ui-sm text-ink-4 hover:bg-hover hover:text-ink-2"
                  >
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
      <div className="flex items-center gap-1 pt-1.5 pr-1.5 pb-0.5 pl-3.5">
        <span className="text-ui-sm font-medium text-ink-4">{t(isGroups ? "Groups" : "Workspaces")}</span>
        <span className="flex-1" />
        <div className="relative">
          <button
            type="button"
            data-popover-trigger
            aria-label={t("Workspace options")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              "pressable flex size-5.5 items-center justify-center rounded-chip",
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
                  prefs.group === "workspace"
                    ? t("Workspace")
                    : prefs.group === "date"
                      ? t("Date")
                      : prefs.group === "status"
                        ? t("Status")
                        : t("Groups")
                }
                onClick={() =>
                  onPrefs({
                    group:
                      prefs.group === "workspace"
                        ? "date"
                        : prefs.group === "date"
                          ? "status"
                          : prefs.group === "status"
                            ? "groups"
                            : "workspace",
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

              <div className="my-1 border-t border-line px-2 pt-1.5 pb-0.5 text-ui-xs tracking-[0.4px] text-ink-3">
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
                  if (allOpen) setOpen(Object.fromEntries(workspaces.map((workspace) => [workspace.key, false])));
                  else setOpen(Object.fromEntries(workspaces.map((workspace) => [workspace.key, true])));
                }}
              />
              <MenuRow label={t("Mark All as Read")} hint={unread ? String(unread) : undefined} onClick={onReadAll} />
            </GlideList>
          </Popover>
        </div>
        {/* the session's own folder, opened with whatever the machine has —
            the file manager, an IDE, the default handler */}
        <FolderOpenButton path={isRemoteFolder(cwd) ? undefined : cwd} />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
        {activeWorkspaces.map((workspace, groupIndex) => renderWorkspace(workspace, groupIndex, false))}

        {isGroups ? (
          creatingGroup ? (
            <form
              className="mx-1 mt-1 flex items-center gap-1 rounded-chip bg-surface p-1 shadow-hairline"
              style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both" }}
              onSubmit={(event) => {
                event.preventDefault();
                createGroup(groupDraft);
                setGroupDraft("");
                setCreatingGroup(false);
              }}
            >
              <input
                autoFocus
                value={groupDraft}
                onChange={(event) => setGroupDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setCreatingGroup(false);
                    setGroupDraft("");
                  }
                }}
                aria-label={t("Group name")}
                placeholder={t("Group name")}
                className="h-6 min-w-0 flex-1 rounded-chip bg-field px-1.5 text-ui-sm text-ink outline-none"
              />
              <button type="submit" className="pressable h-6 rounded-chip bg-ink px-2 text-ui-sm text-canvas">
                {t("Save")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              className="pressable flex items-center gap-1.5 rounded-chip px-2 py-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              <PlusIcon size={11} />
              {t("New group")}
            </button>
          )
        ) : null}

        {archivedWorkspaces.length > 0 ? (
          <div className="mt-2.5 border-t border-line/60 pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="pressable flex h-6 w-full items-center gap-1.5 rounded-chip px-1 text-left text-ui-sm text-ink-3 hover:bg-hover-2 hover:text-ink-2"
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

      {groupMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-ws-context-menu
              className="fixed z-50 w-44 overflow-hidden rounded-control border border-line bg-surface p-1 shadow-overlay"
              style={{
                left: Math.min(groupMenu.x, window.innerWidth - 186),
                top: Math.min(groupMenu.y, window.innerHeight - 130),
                animation: "pop-in 140ms var(--ease-out-strong-css) both",
                transformOrigin: "top left",
              }}
            >
              <div className="mb-1 truncate border-b border-line px-2 py-1.5 font-mono text-ui-xs text-ink-3">
                {groupMenu.name}
              </div>
              <ContextRow
                icon={<PencilIcon size={12} />}
                label={t("Rename")}
                onClick={() => {
                  setRenaming({ key: `group:${groupMenu.name}`, label: groupMenu.name });
                  setDraft(groupMenu.name);
                  setGroupMenu(null);
                }}
              />
              <div className="my-1 h-px bg-line" />
              <ContextRow
                danger
                armed={groupMenu.confirming}
                icon={<TrashIcon size={12} />}
                label={groupMenu.confirming ? t("Click again to delete") : t("Delete group")}
                onClick={() => {
                  if (!groupMenu.confirming) {
                    setGroupMenu({ ...groupMenu, confirming: true });
                    return;
                  }
                  deleteGroup(groupMenu.name);
                  setGroupMenu(null);
                }}
              />
            </div>,
            document.body,
          )
        : null}

      {contextMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-ws-context-menu
              className="fixed z-50 w-48 overflow-hidden rounded-control border border-line bg-surface p-1 shadow-overlay"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 202),
                top: Math.min(contextMenu.y, window.innerHeight - 226),
                animation: "pop-in 140ms var(--ease-out-strong-css) both",
                transformOrigin: "top left",
              }}
            >
              <div className="mb-1 truncate border-b border-line px-2 py-1.5 font-mono text-ui-xs text-ink-3">
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
              {!isRemoteFolder(contextMenu.workspace.path || contextMenu.workspace.key) ? <ContextRow
                icon={<FolderOpenIcon size={12} />}
                label={t("Open in IDE")}
                onClick={() => {
                  void openInIde(contextMenu.workspace.path || contextMenu.workspace.key);
                  setContextMenu(null);
                }}
              /> : null}
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
        "pressable flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left text-ui-caption",
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
