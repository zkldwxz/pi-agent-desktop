import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HostState, SessionListItem } from "@shared/types";
import {
  CheckIcon,
  ChevronDownIcon,
  EditIcon,
  FolderOpenIcon,
  HomeIcon,
  PanelLeftIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
} from "../icons";
import { cn } from "../../lib/cn";
import { GlideList } from "../motion";
import { NavRow } from "../NavRow";
import { folderName } from "../../lib/format";
import { WorkspaceList, type WorkspacePrefs } from "./WorkspaceList";

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

/** `F:/Projects/x` and `F:/Projects/x/` are the same folder. */
function normalize(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/");
}

function baseName(path: string): string {
  return normalize(path).split("/").filter(Boolean).pop() || path;
}

function RailRow({
  icon,
  label,
  hint,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
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
 * Structure follows the reference: project switcher + collapse on the top row, the
 * view rows, the conversation tree, then the account. The workspace menu is real —
 * it lists the folders this machine has sessions for, so switching projects does
 * not mean going through a file picker.
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
}: {
  state: HostState;
  view: SidebarView;
  onView: (view: SidebarView) => void;
  onNew: () => void;
  onSelect: (path: string) => void;
  onPickCwd: () => void;
  onSearch: () => void;
  onNewInWorkspace?: (cwd: string) => void;
}) {
  const [all, setAll] = useState<SessionListItem[]>(state.sessions);
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => load(PREFS_KEY, DEFAULT_PREFS));
  const [renamed, setRenamed] = useState<Record<string, string>>(() => load(RENAME_KEY, {}));
  const [readAt, setReadAt] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState({ top: 0, left: 0 });
  const switcherRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-workspace-menu]")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const workspace = useMemo(
    () => ({
      path: normalize(state.cwd),
      name: renamed[normalize(state.cwd)] ?? folderName(state.cwd) ?? "Pi Agent",
      monogram: (folderName(state.cwd) || "P").slice(0, 1).toUpperCase(),
    }),
    [state.cwd, renamed],
  );

  /** Every folder with sessions, newest first — the real workspace list. */
  const folders = useMemo(() => {
    const seen = new Map<string, { path: string; label: string; sessions: number; modified: number }>();
    for (const session of all) {
      const path = normalize(session.cwd);
      if (!path) continue;
      const entry = seen.get(path);
      const modified = Date.parse(session.modified) || 0;
      seen.set(path, {
        path,
        label: renamed[path] ?? baseName(path),
        sessions: (entry?.sessions ?? 0) + 1,
        modified: Math.max(entry?.modified ?? 0, modified),
      });
    }
    return [...seen.values()].sort((a, b) => b.modified - a.modified);
  }, [all, renamed]);

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
        {/* project row — the switcher opens a list of this machine's folders.
            Its 42px height and bottom hairline continue the chat header's rule
            across the window instead of the line stopping at the pane edge. */}
        <div className="relative h-[42px] shrink-0 border-b border-line">
          <button
            ref={switcherRef}
            type="button"
            aria-expanded={menuOpen}
            onClick={() => {
              if (!menuOpen && switcherRef.current) {
                const rect = switcherRef.current.getBoundingClientRect();
                setMenuAt({ top: rect.bottom + 6, left: rect.left });
              }
              setMenuOpen((open) => !open);
            }}
            title={`${workspace.name} — switch project`}
            className="side-pane-row side-pane-row-head absolute left-2 top-[5px] flex h-8 items-center rounded-[8px] px-1.5 text-left transition-[background-color] duration-100 hover:bg-hover-2"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-field text-[9.5px] font-semibold text-ink-2">
              {workspace.monogram}
            </span>
            <span className="side-pane-copy ml-2 min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
              {workspace.name}
            </span>
            <span className="side-pane-copy ml-1 flex shrink-0 text-ink-3">
              <ChevronDownIcon size={13} />
            </span>
          </button>

          <button
            type="button"
            aria-label="Collapse sidebar"
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={() => setCollapsed(true)}
            className="side-pane-collapse absolute right-2 top-[5px] flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftIcon size={16} />
          </button>

          <button
            type="button"
            aria-label="Expand sidebar"
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => setCollapsed(false)}
            className="side-pane-expand absolute left-2 top-[5px] flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftIcon size={16} className="rotate-180" />
          </button>
        </div>

        {/* views — this row of five is what the icon rail used to be */}
        <div className="flex flex-col gap-1 px-2 pt-2">
          <RailRow icon={<EditIcon size={16} />} label="New Agent" onClick={onNew} />
          <RailRow
            icon={<HomeIcon size={16} />}
            label="Home"
            active={view === "chat"}
            onClick={() => onView("chat")}
          />
          <RailRow icon={<SearchIcon size={16} />} label="Search" hint="Ctrl K" onClick={onSearch} />
          <RailRow
            icon={<PuzzleIcon size={16} />}
            label="Customize"
            active={view === "customize"}
            onClick={() => onView("customize")}
          />
          <RailRow
            icon={<SettingsIcon size={16} />}
            label="Settings"
            active={view === "settings"}
            onClick={() => onView("settings")}
          />
        </div>

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
          />
        </div>

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

      {menuOpen
        ? createPortal(
            <div
              data-workspace-menu
              className="fixed z-50 w-64 rounded-[12px] bg-surface p-1.5 shadow-overlay"
              style={{
                top: menuAt.top,
                left: menuAt.left,
                animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
                transformOrigin: "top left",
              }}
            >
              <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-[7px] bg-hover-2">
                {folders.map((folder) => {
                  const active = folder.path === workspace.path;
                  return (
                    <button
                      key={folder.path}
                      data-row
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (!active) void window.pi.setCwd(folder.path);
                      }}
                      className="relative z-10 flex h-9 w-full items-center gap-2 rounded-[7px] px-2 text-left"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-field text-[9px] font-semibold text-ink-2">
                        {folder.label.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{folder.label}</span>
                      <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">{folder.sessions}</span>
                      {active ? (
                        <span className="shrink-0 text-ink">
                          <CheckIcon size={13} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {!folders.length ? (
                  <div className="px-2 py-2 text-[12.5px] text-ink-3">No folders yet.</div>
                ) : null}
                <div className="my-1 h-px bg-line" />
                <button
                  data-row
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPickCwd();
                  }}
                  className="relative z-10 flex h-9 w-full items-center gap-2 rounded-[7px] px-2 text-left"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                    <FolderOpenIcon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">Open another folder…</span>
                </button>
              </GlideList>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
