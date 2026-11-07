import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostState, SessionListItem } from "@shared/types";
import {
  EditIcon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
} from "../icons";
import { cn } from "../../lib/cn";
import { initialsOf } from "../../lib/format";
import { NavRow } from "../NavRow";
import { WorkspaceList, loadSessionGroups, type SessionGroups, type WorkspacePrefs } from "./WorkspaceList";
import { loadSidebarPrefs, saveSidebarPrefs, onSidebarPrefs } from "../../lib/sidebar-prefs";
import { t, useLocale } from "../../lib/i18n";
import { formatChord, useShortcuts } from "../../lib/keybindings";

const RENAME_KEY = "pi-workspace-names";
const READ_KEY = "pi-workspace-read";
const SESSION_GROUPS_KEY = "pi-session-groups";
const SIDEBAR_WIDTH_KEY = "pi-sidebar-width";

const DEFAULT_PREFS: WorkspacePrefs = { group: "workspace", order: "recent", show: 3, statusFilter: "all" };

const DEFAULT_SIDEBAR_WIDTH = 260; // baocode workbench.dart:263
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

/** SidebarIconButton: 24px, radius 5, a codicon at 16 in muted ink */
function SideIconButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="titlebar-no-drag pressable flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
    >
      <span className={`codicon codicon-${icon} text-[16px]`} aria-hidden />
    </button>
  );
}

/** _NavRow: a 22px list row — codicon 15 in muted ink, 8px, the label at 12.5 */
function SideNavRow({
  icon,
  label,
  title,
  selected = false,
  onClick,
}: {
  icon: string;
  label: string;
  title?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "pressable flex h-[22px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-ui-caption transition-colors duration-[120ms]",
        selected ? "bg-accent-tint text-ink" : "text-ink hover:bg-hover",
      )}
    >
      <span className={`codicon codicon-${icon} shrink-0 text-[15px] text-ink-2`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
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
  onSearch,
  onNewInWorkspace,
  collapsed,
  onCollapsedChange,
  userName,
}: {
  state: HostState;
  view: SidebarView;
  onView: (view: SidebarView) => void;
  onNew: () => void;
  onSelect: (path: string) => void;
  onSearch: () => void;
  onNewInWorkspace?: (cwd: string) => void;
  /** owned by the app so the title bar can toggle the same state */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** the account row's name — the person, not the provider */
  userName?: string;
}) {
  const [all, setAll] = useState<SessionListItem[]>(state.sessions);
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => loadSidebarPrefs(DEFAULT_PREFS));
  const [renamed, setRenamed] = useState<Record<string, string>>(() => load(RENAME_KEY, {}));
  const [readAt, setReadAt] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const [sessionGroups, setSessionGroups] = useState<SessionGroups>(() => loadSessionGroups());
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

  useEffect(() => saveSidebarPrefs(prefs), [prefs]);
  useEffect(() => localStorage.setItem(RENAME_KEY, JSON.stringify(renamed)), [renamed]);
  useEffect(() => localStorage.setItem(READ_KEY, JSON.stringify(readAt)), [readAt]);
  useEffect(() => localStorage.setItem(SESSION_GROUPS_KEY, JSON.stringify(sessionGroups)), [sessionGroups]);
  /* Settings edits the same prefs; the module fans the change back out here */
  useEffect(() => onSidebarPrefs(setPrefs), []);

  /* "New chat in group": pi's newSession carries no return value, so the
   * session's file is claimed the moment the snapshot reports it, then the
   * pending marker is dropped — a failed create leaves nothing assigned. */
  const pendingGroupRef = useRef<string | null>(null);
  const sessionFile = state.snapshot?.sessionFile;
  useEffect(() => {
    const group = pendingGroupRef.current;
    if (!sessionFile || !group) return;
    pendingGroupRef.current = null;
    setSessionGroups((current) => ({ ...current, assign: { ...current.assign, [sessionFile]: group } }));
  }, [sessionFile]);

  const openSession = (path: string) => {
    setReadAt((current) => ({ ...current, [path]: Date.now() }));
    onSelect(path);
  };

  return (
    /* baocode's sidebar (lib/sidebar/sidebar.dart): bare on the window's
       colour, no outline — the conversation's card beside it is the edge */
    <aside
      data-side-pane="open"
      aria-label="Sessions"
      className="relative flex h-full shrink-0 flex-col overflow-hidden select-none"
      style={{ width: sidebarWidth }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* _buildTopBar: under the traffic lights, 30px on the cards' first
            line (6px gap + 30), the collapse button at its right end */}
        <div className="titlebar-drag flex h-9 shrink-0 items-end justify-end pr-1.5">
          <div className="flex h-[30px] items-center">
            <SideIconButton
              label={t("Collapse sidebar")}
              icon="layout-sidebar-left"
              onClick={() => setCollapsed(true)}
            />
          </div>
        </div>

        {/* New Agent: padding 8 / contentInset 8 / 8 / 6 */}
        <div className="px-2 pt-2 pb-1.5">
          <button
            type="button"
            onClick={onNew}
            title={t("New Agent")}
            className="pressable flex h-[30px] w-full items-center gap-1.5 rounded-control border border-line bg-page px-2 text-left text-ui-caption text-ink transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--ink)_7%,var(--page))]"
          >
            <PlusIcon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("New Agent")}</span>
          </button>
        </div>

        {/* _NavRow: 22px rows, 6px in from the pane, 8px inside; icon 15 muted */}
        <div className="flex flex-col px-1.5">
          <SideNavRow
            icon="search"
            label={t("Search")}
            title={chords.palette ? `${t("Search")} (${formatChord(chords.palette)})` : t("Search")}
            onClick={onSearch}
          />
          <SideNavRow icon="plug" label={t("Customize")} selected={view === "customize"} onClick={() => onView("customize")} />
        </div>
        <div className="h-1 shrink-0" />

        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceList
            sessions={all}
            prefs={prefs}
            onPrefs={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
            renamed={renamed}
            activePath={state.snapshot?.sessionFile}
            readAt={readAt}
            cwd={state.cwd}
            homeDir={state.homeDir}
            onReadAll={() =>
              setReadAt(Object.fromEntries(all.map((session) => [session.path, Date.now()])))
            }
            onSelect={openSession}
            onRename={(key, label) => setRenamed((current) => ({ ...current, [key]: label }))}
            onNewInWorkspace={onNewInWorkspace}
            onNewInGroup={(group) => {
              pendingGroupRef.current = group;
              onNew();
            }}
            sessionGroups={sessionGroups}
            onSessionGroups={setSessionGroups}
          />
        </div>

        {/* _buildFooterRow: no line over it; 26px of buttons, 6px in — the
            settings gear at its end (no account row: baocode has none) */}
        <div className="flex h-[26px] shrink-0 items-center justify-end px-1.5 mt-1.5 mb-px">
          <SideIconButton label={t("Settings")} icon="settings-gear" onClick={() => onView("settings")} />
        </div>
      </div>

      {/* resizer handle */}
      {true ? (
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
