import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionListItem } from "@shared/types";
import { cn } from "../../lib/cn";
import { GlideList, stagger } from "../motion";
import { Popover } from "../motion";
import { ValuePill } from "../beautiful/atoms/ValuePill";
import {
  ChevronDownIcon,
  FolderIcon,
  ListIcon,
  LoaderIcon,
  PlusIcon,
  RefreshIcon,
} from "../icons";
import { relativeTime } from "../../lib/format";

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

function StatusGlyph({ status }: { status: SessionListItem["status"] }) {
  if (status === "running") return <LoaderIcon size={12} className="spin-fast text-accent" />;
  if (status === "failed") return <span className="size-[7px] rounded-full bg-red" />;
  return <span className="size-[7px] rounded-full bg-line-strong" />;
}

function MenuRow({
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
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{label}</span>
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
}) {
  // collapsed by default: an empty map means every workspace starts closed
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const [draft, setDraft] = useState("");
  /* The conversation you just picked. The host takes a round trip to switch the
   * session, so the row answers the click itself: it highlights immediately and
   * holds keyboard focus, which is also what lets the next arrow key move. */
  const [picked, setPicked] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!picked) return;
    rowRefs.current.get(picked)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setPicked(null), 1200);
    return () => window.clearTimeout(timer);
  }, [picked]);

  const choose = (path: string) => {
    setPicked(path);
    onSelect(path);
  };

  const workspaces = useMemo(() => groupSessions(sessions, prefs, renamed), [sessions, prefs, renamed]);
  const allOpen = workspaces.length > 0 && workspaces.every((workspace) => open[workspace.key]);

  if (!sessions.length) {
    return (
      <div className="flex flex-col gap-2 px-3 py-4">
        <span className="text-[11.5px] text-ink-3">No sessions yet.</span>
        <button
          type="button"
          onClick={onAddFolder}
          className="pressable inline-flex h-7 w-fit items-center gap-1.5 rounded-chip bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
        >
          <PlusIcon size={11} />
          Add a folder
        </button>
      </div>
    );
  }

  const unread = sessions.filter((session) => Date.parse(session.modified) > (readAt[session.path] ?? 0)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header — the filter menu from the reference, and nothing else.
          The chat search that used to grow out of the magnifier here was a
          registry demo: the command palette (Ctrl K) is the real search. */}
      <div className="flex items-center gap-1 px-2.5 pb-1">
        <span className="text-[11px] tracking-[0.3px] text-ink-3">Workspaces</span>
        <span className="flex-1" />
        {unread ? (
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-medium text-white tabular-nums"
            title={`${unread} conversation${unread === 1 ? "" : "s"} updated since you last read them`}
          >
            {unread}
          </span>
        ) : null}
        <div className="relative">
          <button
            type="button"
            data-popover-trigger
            aria-label="Workspace options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              "pressable flex size-5 items-center justify-center rounded-[5px]",
              menuOpen ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
            )}
          >
            <ListIcon size={11} />
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchor="top-right" className="w-52 p-1">
            <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
              <MenuRow
                label="Grouping"
                value={
                  prefs.group === "workspace" ? "Workspace" : prefs.group === "date" ? "Date" : "Status"
                }
                onClick={() =>
                  onPrefs({
                    group: prefs.group === "workspace" ? "date" : prefs.group === "date" ? "status" : "workspace",
                  })
                }
              />
              <MenuRow
                label="Ordering"
                value={prefs.order === "recent" ? "Recent" : "Name"}
                onClick={() => onPrefs({ order: prefs.order === "recent" ? "name" : "recent" })}
              />
              <MenuRow
                label="Show"
                value={prefs.show === 0 ? "All" : `${prefs.show} chats`}
                onClick={() => onPrefs({ show: prefs.show === 3 ? 5 : prefs.show === 5 ? 0 : 3 })}
              />

              <div className="my-1 border-t border-line px-2 pt-1.5 pb-0.5 text-[10.5px] tracking-[0.4px] text-ink-3">
                FILTERS
              </div>
              <MenuRow
                label="Status"
                value={
                  prefs.statusFilter === "all" ? "Any" : prefs.statusFilter === "running" ? "Running" : "Failed"
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
                label={allOpen ? "Expand All" : "Collapse All"}
                onClick={() => {
                  if (allOpen) setOpen({});
                  else setOpen(Object.fromEntries(workspaces.map((workspace) => [workspace.key, true])));
                }}
              />
              <MenuRow label="Mark All as Read" hint={unread ? String(unread) : undefined} onClick={onReadAll} />
            </GlideList>
          </Popover>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        {workspaces.map((workspace, groupIndex) => {
          const isOpen = Boolean(open[workspace.key]);
          const sorted = workspace.sessions;
          const limit = prefs.show === 0 ? sorted.length : prefs.show;
          const isExpanded = Boolean(expanded[workspace.key]);
          const visible = isExpanded ? sorted : sorted.slice(0, limit);
          const hidden = sorted.length - visible.length;
          const running = sorted.some((session) => session.status === "running");
          const workspaceUnread = sorted.filter(
            (session) => Date.parse(session.modified) > (readAt[session.path] ?? 0),
          ).length;

          return (
            <section key={workspace.key} className="mb-1" style={stagger(groupIndex)}>
              <div className="group/ws flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => setOpen((current) => ({ ...current, [workspace.key]: !isOpen }))}
                  className="pressable flex h-7.5 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] px-1 text-left hover:bg-hover-2"
                >
                  {/* one slot, two glyphs: the folder at rest, the disclosure
                      chevron on hover and while the group is open. The swap is
                      pure CSS (peer/group opacity), so it costs no state. */}
                  {/* the colour label leads the row: a glance down the left
                      edge reads every group's state without hunting for a dot
                      on the far right. */}
                  {workspaceUnread ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                      title={`${workspaceUnread} unread`}
                    />
                  ) : null}
                  <span className="relative flex size-3.5 shrink-0 items-center justify-center text-ink-3">
                    <FolderIcon
                      size={13}
                      className={cn(
                        "absolute transition-opacity duration-100",
                        isOpen ? "opacity-0" : "group-hover/ws:opacity-0",
                      )}
                    />
                    <ChevronDownIcon
                      size={12}
                      strokeWidth={2.2}
                      className={cn(
                        "absolute transition-[opacity,transform] duration-150",
                        isOpen ? "opacity-100" : "opacity-0 group-hover/ws:opacity-100",
                      )}
                      style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{workspace.label}</span>
                  {running ? <StatusGlyph status="running" /> : null}
                  <ValuePill tone={running ? "accent" : "neutral"} className="shrink-0 !text-[10px] !px-1.5">
                    {sorted.length}
                  </ValuePill>
                </button>
                <button
                  type="button"
                  title="Rename workspace"
                  onClick={() => {
                    setRenaming({ key: workspace.key, label: workspace.label });
                    setDraft(workspace.label);
                  }}
                  className="pressable flex size-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover/ws:opacity-100"
                >
                  ✎
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
                    aria-label="Workspace name"
                    className="h-6 min-w-0 flex-1 rounded-[5px] bg-field px-1.5 text-[11.5px] text-ink outline-none"
                  />
                  <button type="submit" className="pressable h-6 rounded-[5px] bg-ink px-2 text-[11px] text-canvas">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onAddFolder}
                    title="Add another folder"
                    className="pressable flex size-6 items-center justify-center rounded-[5px] bg-field text-ink-2 hover:bg-hover-2"
                  >
                    <PlusIcon size={11} />
                  </button>
                </form>
              ) : null}

              {/* collapsed workspaces render nothing at all — no preload */}
              <div className="collapse-grid" data-open={isOpen}>
                <div className="min-h-0 overflow-hidden">
                  {isOpen ? (
                    <GlideList className="flex flex-col gap-px pl-4">
                      {visible.map((session, index) => {
                        const isUnread = Date.parse(session.modified) > (readAt[session.path] ?? 0);
                        const active = session.path === activePath || session.path === picked;
                        return (
                          <button
                            key={session.path}
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
                              "glide-row pressable flex w-full items-center gap-2 rounded-[6px] py-1 pr-2 pl-[24px] text-left outline-none",
                              "focus-visible:bg-surface focus-visible:shadow-hairline",
                              active && "row-picked bg-surface shadow-hairline",
                            )}
                          >
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-[12.5px]",
                                active ? "font-medium text-ink" : isUnread ? "text-ink" : "text-ink-2",
                              )}
                            >
                              {session.name || session.firstMessage || "New session"}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-ink-3 tabular-nums">
                              {relativeTime(session.modified)}
                            </span>
                          </button>
                        );
                      })}
                      {hidden > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((current) => ({ ...current, [workspace.key]: true }))}
                          className="pressable flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                        >
                          <ChevronDownIcon size={10} />
                          Show {hidden} more
                        </button>
                      ) : null}
                      {isExpanded && sorted.length > limit ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((current) => ({ ...current, [workspace.key]: false }))}
                          className="pressable flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                        >
                          <ChevronDownIcon size={10} className="rotate-180" />
                          Show less
                        </button>
                      ) : null}
                    </GlideList>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}

        <button
          type="button"
          onClick={onAddFolder}
          className="pressable mt-1 flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          <RefreshIcon size={11} />
          Open another folder
        </button>
      </div>
    </div>
  );
}
