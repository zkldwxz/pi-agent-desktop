import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostState, SessionListItem } from "@shared/types";
import {
  EditIcon,
  PanelLeftIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
} from "../icons";
import { cn } from "../../lib/cn";
import { NavRow } from "../NavRow";
import { WorkspaceList, type WorkspacePrefs } from "./WorkspaceList";
import { t, useLocale } from "../../lib/i18n";
import { formatChord, useShortcuts } from "../../lib/keybindings";

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
  /** owned by the app so the title bar can toggle the same state */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [all, setAll] = useState<SessionListItem[]>(state.sessions);
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => load(PREFS_KEY, DEFAULT_PREFS));
  const [renamed, setRenamed] = useState<Record<string, string>>(() => load(RENAME_KEY, {}));
  const [readAt, setReadAt] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  useLocale();
  const chords = useShortcuts();
  const setCollapsed = onCollapsedChange;

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const loaded = load(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
    return typeof loaded === "number" && !isNaN(loaded)
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, loaded))
      : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  /* Promote the aside only while the collapse runs — width is not compositable,
   * but `will-change` lets the browser skip needless work on the subtree for
   * those 300ms instead of keeping the hint (and its memory) forever. */
  const [railAnimating, setRailAnimating] = useState(false);
  useEffect(() => {
    setRailAnimating(true);
    const id = window.setTimeout(() => setRailAnimating(false), 340);
    return () => window.clearTimeout(id);
  }, [collapsed]);

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

  /* A cheap fingerprint of the scoped session list. Opening an existing
   * conversation refreshes state.sessions' active row but leaves its contents
   * (path / count / mtime / status) unchanged, so keying the all-projects
   * fetch on this keeps a plain open from re-scanning every project on disk
   * (~170ms on a machine with a long history) — while a genuinely new, removed
   * or renamed session still triggers exactly one refresh. */
  const sessionsSignature = useMemo(
    () =>
      state.sessions
        .map((session) => `${session.path}~${session.messageCount}~${session.modified}~${session.status}`)
        .join("|"),
    [state.sessions],
  );
  const lastAllSignatureRef = useRef<string | null>(null);

  // one fetch for every project's sessions; grouping by workspace needs them all
  useEffect(() => {
    if (sessionsSignature === lastAllSignatureRef.current) return;
    let cancelled = false;
    void window.pi.listAllSessions().then((sessions) => {
      if (cancelled || !sessions.length) return;
      lastAllSignatureRef.current = sessionsSignature;
      setAll(sessions);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionsSignature]);

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
        willChange: railAnimating ? "width" : undefined,
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* views — this row of five is what the icon rail used to be. In the
            collapsed strip the first row is the way back out. */}
        <div className="flex flex-col gap-1 px-2 pt-2">
          {/* the pane's own chrome sits above the views, pinned to the top-left
              corner: collapsed it is the way back out, expanded it is the way
              in. The workspace header stays free for its own controls. */}
          {collapsed ? (
            <RailRow
              icon={<PanelLeftIcon size={16} className="rotate-180" />}
              label={t("Expand sidebar")}
              title={t("Expand sidebar")}
              onClick={() => setCollapsed(false)}
            />
          ) : (
            <div className="flex items-center">
              <button
                type="button"
                aria-label={t("Collapse sidebar")}
                title={t("Collapse sidebar")}
                onClick={() => setCollapsed(true)}
                className="pressable flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                <PanelLeftIcon size={14} />
              </button>
            </div>
          )}
          {/* New Agent starts the conversation immediately — the folder is
              chosen inside the fresh session, which defaults to the folder of
              the last conversation, so the click's cost is zero. */}
          <RailRow icon={<EditIcon size={16} />} label={t("New Agent")} onClick={onNew} />
          <RailRow
            icon={<SearchIcon size={16} />}
            label={t("Search")}
            hint={chords.palette ? formatChord(chords.palette) : ""}
            onClick={onSearch}
          />
          <RailRow
            icon={<PuzzleIcon size={16} />}
            label={t("Customize")}
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
            cwd={state.cwd}
            onReadAll={() =>
              setReadAt(Object.fromEntries(all.map((session) => [session.path, Date.now()])))
            }
            onSelect={openSession}
            onRename={(key, label) => setRenamed((current) => ({ ...current, [key]: label }))}
            onAddFolder={onPickCwd}
            onNewInWorkspace={onNewInWorkspace}
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
            title={t("Settings")}
            aria-label={t("Settings")}
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
          title={t("Drag to resize, double-click to reset")}
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
