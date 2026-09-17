import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostState, SessionListItem } from "@shared/types";
import {
  ChevronDownIcon,
  EditIcon,
  PanelLeftIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
} from "../icons";
import { cn } from "../../lib/cn";
import { GlideList, Popover } from "../motion";
import { NavRow } from "../NavRow";
import { folderName } from "../../lib/format";
import { MenuRow, WorkspaceList, type WorkspacePrefs } from "./WorkspaceList";

const PREFS_KEY = "pi-workspace-prefs";
const RENAME_KEY = "pi-workspace-names";
const READ_KEY = "pi-workspace-read";
const SIDEBAR_WIDTH_KEY = "pi-sidebar-width";

const DEFAULT_PREFS: WorkspacePrefs = { group: "workspace", order: "recent", show: 3, statusFilter: "all" };

const DEFAULT_SIDEBAR_WIDTH = 232;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const WIDTH_COLLAPSED = 52;

/** Views this pane can reach. Browser and usage live inside Customize / Settings. */
export type SidebarView = "chat" | "customize" | "settings";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function RailRow({
  icon,
  label,
  hint,
  active = false,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  /** the row's copy is hidden while collapsed — the tooltip carries it */
  title?: string;
  onClick: () => void;
}) {
  /* the row itself is shared with the settings rail; the session pane adds the
   * width and copy classes that let it collapse to a 52px strip */
  return (
    <NavRow
      icon={icon}
      label={label}
      hint={hint}
      active={active}
      title={title}
      onClick={onClick}
      className="side-pane-row h-8.5"
      copyClassName="side-pane-copy"
    />
  );
}

/**
 * The left pane: the project, the views, and the conversations in it.
 *
 * This pane *is* the navigation now. It replaced the 52px icon rail that used to
 * carry Chat / Browser / Usage / Customize / Settings, because a second column of
 * icons next to a column of rows was two navigation lists competing for the same
 * decision. Everything the rail reached is here instead: Customize (extensions,
 * skills, rules, models) and Settings (all the data previews) are rows, and the
 * browser and usage dashboards open from inside those two rather than owning an
 * icon of their own.
 *
 * Structure: the view rows, the conversation tree, then the account. There is
 * deliberately no project header — the workspace groups below already name the
 * folders on this machine, and the collapse control lives in their header row.
 *
 * Behaviour that matters for cost: workspace **contents are not rendered until
 * a workspace is expanded**, and an expanded workspace shows a bounded number
 * of chats with a "show N more" row.
 */
export function AgentSidebar({
  state,
  view,
  onView,
  onNew,
  onSelect,
  onPickCwd,
  onSearch,
  onNewInWorkspace,
  onNewInFolder,
  onPickNewFolder,
  collapsed,
  onCollapsedChange,
}: {
  state: HostState;
  view: SidebarView;
  onView: (view: SidebarView) => void;
  onNew: () => void;
  onSelect: (path: string) => void;
  onPickCwd: () => void;
  onSearch: () => void;
  onNewInWorkspace?: (cwd: string) => void;
  /** start a new agent inside an existing workspace folder */
  onNewInFolder?: (cwd: string) => void;
  /** pick a folder on disk, then start a new agent there */
  onPickNewFolder?: () => void;
  /** owned by the app so the title bar can toggle the same state */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [all, setAll] = useState<SessionListItem[]>(state.sessions);
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => load(PREFS_KEY, DEFAULT_PREFS));
  const [renamed, setRenamed] = useState<Record<string, string>>(() => load(RENAME_KEY, {}));
  const [readAt, setReadAt] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const setCollapsed = onCollapsedChange;

  /** folders this machine has sessions for, newest first — the New Agent menu */
  const recentFolders = useMemo(() => {
    const seen = new Map<string, number>();
    for (const session of all) {
      if (!session.cwd) continue;
      seen.set(session.cwd, Math.max(seen.get(session.cwd) ?? 0, Date.parse(session.modified) || 0));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path]) => path);
  }, [all]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const loaded = load(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
    return typeof loaded === "number" && !isNaN(loaded)
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, loaded))
      : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  // while dragging, lock the cursor and kill text selection app-wide
  useEffect(() => {
    if (!isResizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [isResizing]);

  const onStartResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (collapsed) return;
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta));
        setSidebarWidth(next);
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setIsResizing(false);
        const delta = upEvent.clientX - startX;
        const finalWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta));
        localStorage.setItem(SIDEBAR_WIDTH_KEY, JSON.stringify(finalWidth));
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [collapsed, sidebarWidth],
  );

  // one fetch for every project's sessions; grouping by workspace needs them all
  useEffect(() => {
    let cancelled = false;
    void window.pi.listAllSessions().then((sessions) => {
      if (!cancelled && sessions.length) setAll(sessions);
    });
    return () => {
      cancelled = true;
    };
  }, [state.sessions]);

  useEffect(() => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)), [prefs]);
  useEffect(() => localStorage.setItem(RENAME_KEY, JSON.stringify(renamed)), [renamed]);
  useEffect(() => localStorage.setItem(READ_KEY, JSON.stringify(readAt)), [readAt]);

  const openSession = (path: string) => {
    setReadAt((current) => ({ ...current, [path]: Date.now() }));
    onSelect(path);
  };

  return (
    <aside
      data-side-pane={collapsed ? "collapsed" : "open"}
      aria-label="Sessions"
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-canvas select-none"
      style={{
        width: collapsed ? WIDTH_COLLAPSED : sidebarWidth,
        transition: isResizing ? "none" : "width 280ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* views — this row of five is what the icon rail used to be. In the
            collapsed strip the first row is the way back out. */}
        <div className="flex flex-col gap-1 px-2 pt-2">
          {collapsed ? (
            <RailRow
              icon={<PanelLeftIcon size={16} className="rotate-180" />}
              label="Expand sidebar"
              title="Expand sidebar"
              onClick={() => setCollapsed(false)}
            />
          ) : null}
          {/* New Agent is a menu, not a bare action: a new agent needs a
              folder to live in, and this is where that choice belongs. */}
          <div className="relative">
            <NavRow
              icon={<EditIcon size={16} />}
              label="New Agent"
              trailing={<ChevronDownIcon size={12} className="text-ink-3" />}
              className="side-pane-row h-8.5"
              copyClassName="side-pane-copy"
              data-popover-trigger
              aria-expanded={newMenuOpen}
              onClick={() => setNewMenuOpen((value) => !value)}
            />
            <Popover
              open={newMenuOpen}
              onClose={() => setNewMenuOpen(false)}
              anchor="bottom-left"
              className="w-64 p-1"
            >
              <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
                <MenuRow
                  label={`New chat in ${folderName(state.cwd) || "this folder"}`}
                  onClick={() => {
                    setNewMenuOpen(false);
                    onNew();
                  }}
                />
                {recentFolders.length ? (
                  <div className="my-1 border-t border-line px-2 pt-1.5 pb-0.5 text-[10.5px] tracking-[0.4px] text-ink-3">
                    RECENT FOLDERS
                  </div>
                ) : null}
                {recentFolders.map((path) => (
                  <MenuRow
                    key={path}
                    label={folderName(path) || path}
                    hint={path === state.cwd ? "current" : undefined}
                    onClick={() => {
                      setNewMenuOpen(false);
                      if (path === state.cwd) onNew();
                      else onNewInFolder?.(path);
                    }}
                  />
                ))}
                <div className="my-1 border-t border-line" />
                <MenuRow
                  label="Open another folder…"
                  onClick={() => {
                    setNewMenuOpen(false);
                    onPickNewFolder?.();
                  }}
                />
              </GlideList>
            </Popover>
          </div>
          <RailRow icon={<SearchIcon size={16} />} label="Search" hint="Ctrl K" onClick={onSearch} />
          <RailRow
            icon={<PuzzleIcon size={16} />}
            label="Customize"
            active={view === "customize"}
            onClick={() => onView("customize")}
          />
        </div>

        {/* the conversation tree needs width — in the 52px strip it used to
            render anyway and every row broke mid-word. Collapsed shows the
            icon rail only, like Cursor's. */}
        {collapsed ? null : (
        <div className="mt-3.5 flex min-h-0 flex-1 flex-col border-t border-line/60 pt-1.5">
          <WorkspaceList
            sessions={all}
            prefs={prefs}
            onPrefs={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
            renamed={renamed}
            activePath={state.snapshot?.sessionFile}
            readAt={readAt}
            onReadAll={() =>
              setReadAt(Object.fromEntries(all.map((session) => [session.path, Date.now()])))
            }
            onSelect={openSession}
            onRename={(key, label) => setRenamed((current) => ({ ...current, [key]: label }))}
            onAddFolder={onPickCwd}
            onNewInWorkspace={onNewInWorkspace}
            collapseControl={
              <button
                type="button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onClick={() => setCollapsed(true)}
                className="pressable flex size-5.5 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                <PanelLeftIcon size={13} />
              </button>
            }
          />
        </div>
        )}

        {/* account */}
        <div className="side-pane-copy flex w-full shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
          <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink text-[9px] font-semibold text-canvas">
            PI
          </div>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
            {state.snapshot?.model?.provider ?? "local"}
          </span>
          <button
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={() => onView("settings")}
            className="pressable flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>

      {/* resizer handle */}
      {!collapsed ? (
        <div
          onMouseDown={onStartResize}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            localStorage.setItem(SIDEBAR_WIDTH_KEY, JSON.stringify(DEFAULT_SIDEBAR_WIDTH));
          }}
          title="Drag to resize, double-click to reset"
          className="group/resizer absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize"
        >
          {/* one 1px line that appears on hover — not a painted strip plus a bar */}
          <div
            className={cn(
              "mx-auto h-full w-px transition-colors duration-150",
              isResizing ? "bg-accent" : "bg-transparent group-hover/resizer:bg-accent/50",
            )}
          />
        </div>
      ) : null}

    </aside>
  );
}
