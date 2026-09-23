import { Suspense, lazy, memo, useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChatMessage, HostState, PlanAction } from "@shared/types";
import type { ChangeEntry } from "./ChangesPanel";
import type { FileEntry } from "@shared/workspace";
import { cn } from "../../lib/cn";
import { t, useLocale } from "../../lib/i18n";
// The dock is always mounted but its panels are not; each arrives on demand.
const ChangesPanel = lazy(() => import("./ChangesPanel").then((m) => ({ default: m.ChangesPanel })));
const FileBrowser = lazy(() => import("./FileBrowser").then((m) => ({ default: m.FileBrowser })));
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const FileViewer = lazy(() => import("./FileViewer").then((m) => ({ default: m.FileViewer })));
const SessionOutline = lazy(() => import("./SessionOutline").then((m) => ({ default: m.SessionOutline })));
const PlanPanel = lazy(() => import("./PlanPanel").then((m) => ({ default: m.PlanPanel })));
const AgentFleetPanel = lazy(() => import("./AgentFleetPanel").then((m) => ({ default: m.AgentFleetPanel })));

/** Inline placeholder for a dock panel — small, it is a sidebar column. */
function DockSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="h-6 rounded-[6px] bg-hover-2"
          style={{ animation: `fade-in 300ms ease-out ${index * 40}ms both` }}
        />
      ))}
    </div>
  );
}

import {
  FilePenIcon,
  FolderIcon,
  GaugeIcon,
  GlobeIcon,
  ListChecksIcon,
  MessageIcon,
  TerminalIcon,
  UsersIcon,
} from "../icons";

/**
 * The panels the dock can show. There is no to-do tile and no plan tile: the
 * agent's list is written out in the task monitor, and a plan is a markdown
 * file the window opens on its own — the panel arrives with the plan, it is not
 * something you go looking for in a launcher. The fleet tab is the same idea:
 * it appears in the strip only while sub-agents exist.
 */
export type DockTool = "file" | "terminal" | "changes" | "browser" | "session" | "plan" | "agents";

/* labels are translated at render time, the keys stay stable */
const TOOL_LABEL: Record<DockTool, string> = {
  file: "Files",
  terminal: "Terminal",
  changes: "Changes",
  browser: "Browser",
  session: "Session",
  plan: "Plan",
  agents: "Agents",
};

const TOOL_ICON: Record<DockTool, (size: number) => ReactNode> = {
  file: (size) => <FolderIcon size={size} />,
  terminal: (size) => <TerminalIcon size={size} />,
  changes: (size) => <FilePenIcon size={size} />,
  browser: (size) => <GlobeIcon size={size} />,
  session: (size) => <MessageIcon size={size} />,
  plan: (size) => <ListChecksIcon size={size} />,
  agents: (size) => <UsersIcon size={size} />,
};

/** The launcher's order, read across two columns. */
const LAUNCHER: DockTool[] = ["changes", "browser", "terminal", "file", "session"];

/**
 * The dock's landing screen: one tile per tool, big enough to hit without
 * hunting. Picking a tile puts that panel in its place; the grid comes back from
 * the strip's first button or Escape.
 */
function DockLauncher({ tools, onPick }: { tools: DockTool[]; onPick: (tool: DockTool) => void }) {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      {/* `my-auto` rather than `items-center`: the grid is centred while it fits,
          and scrolls from the top once five tiles no longer do */}
      <div className="my-auto grid grid-cols-2 gap-2.5">
        {tools.map((key, index) => (
          <button
            key={key}
            type="button"
            title={t(TOOL_LABEL[key])}
            onClick={() => onPick(key)}
            style={{ animation: `row-enter 240ms cubic-bezier(0.23,1,0.32,1) ${index * 30}ms both` }}
            className="pressable flex h-[84px] flex-col items-center justify-center gap-2 rounded-card bg-surface shadow-hairline transition-colors duration-100 hover:bg-hover"
          >
            <span className="text-ink-3">{TOOL_ICON[key](18)}</span>
            <span className="text-[12.5px] leading-none text-ink-2">{t(TOOL_LABEL[key])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const WIDTH_DEFAULT = 340;
const DOCK_WIDTH_KEY = "pi:dock-width";

/* A terminal at 340 columns nothing useful, so the column is draggable — but it
 * stops short of squeezing the chat away, which is the wider pane by rights. */
function clampDockWidth(value: number): number {
  const max = Math.max(WIDTH_DEFAULT, Math.min(720, window.innerWidth - 520));
  return Math.round(Math.min(Math.max(value, WIDTH_DEFAULT), max));
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/**
 * The right-hand dock.
 *
 * It opens on a launcher — a tile per tool — and picking one puts that panel in
 * place, with a strip along the top to switch or come back. Opening the dock on
 * a panel made you guess which one was last; the grid says what is in here.
 * It is opened and closed by `DockToggle`, which sits in the header of the
 * current view, so there is exactly one control for one panel.
 */
export const ToolDock = memo(function ToolDock({
  state,
  open,
  onOpenChange,
  tool,
  onTool,
  cwd,
  messages,
  openFile,
  onOpenFile,
  activeChangeFile,
  /** the active change entry, for the viewer's diff header */
  activeChange,
  onOpenDiff,
  onReveal,
  onJumpToTurn,
  onOpenBrowser,
  onCloseFile,
  buildModel,
  onPlanAction,
  /** fleet interrupts — one sub-agent by name, or every running one */
  onFleetInterrupt,
  /** quote lines from the viewer into the composer */
  onAddToChat,
}: {
  state: HostState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: DockTool | null;
  onTool: (tool: DockTool | null) => void;
  cwd: string;
  messages: ChatMessage[];
  openFile?: string;
  onOpenFile: (entry: FileEntry) => void;
  activeChangeFile?: string;
  activeChange?: ChangeEntry | null;
  onOpenDiff: (change: ChangeEntry) => void;
  onReveal: (path: string) => void;
  onJumpToTurn: (key: string) => void;
  /** the native browser view needs the whole window, so it leaves the dock */
  onOpenBrowser: () => void;
  onCloseFile: () => void;
  /** the model Build last ran with, so the plan tab's picker opens on it */
  buildModel?: { provider: string; id: string };
  onPlanAction: (action: PlanAction) => void;
  onFleetInterrupt: (name?: string) => void;
  onAddToChat?: (text: string) => void;
}) {
  // (the memo is what keeps a streaming answer from re-rendering this subtree
  // on every token — its inputs are deferred by the app)
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(DOCK_WIDTH_KEY)) || 0;
      return clampDockWidth(saved || WIDTH_DEFAULT);
    } catch {
      return WIDTH_DEFAULT;
    }
  });
  const [resizing, setResizing] = useState(false);
  useLocale();
  const workspaceName = baseName(cwd);
  /* The plan panel is not a launcher option — it is the document a plan opens,
     so it arrives when the extension writes one (see App) and stays while the
     user is reading it. The fleet tab rides the strip only while a fleet
     exists: an empty agents panel is a dead tile. */
  const activeTool: DockTool | null = tool;
  const stripTools: DockTool[] = state.fleet.length ? [...LAUNCHER, "agents"] : LAUNCHER;

  const onStartResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setResizing(true);
      const onMove = (moveEvent: MouseEvent) => setWidth(clampDockWidth(startWidth + (startX - moveEvent.clientX)));
      const onUp = (upEvent: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setResizing(false);
        const next = clampDockWidth(startWidth + (startX - upEvent.clientX));
        setWidth(next);
        try {
          localStorage.setItem(DOCK_WIDTH_KEY, String(next));
        } catch {}
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width],
  );

  const resetWidth = useCallback(() => {
    setWidth(WIDTH_DEFAULT);
    try {
      localStorage.setItem(DOCK_WIDTH_KEY, String(WIDTH_DEFAULT));
    } catch {}
  }, []);

  // while dragging, lock the cursor and kill text selection app-wide
  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [resizing]);

  // a window that shrinks below the saved width would push the chat off-screen
  useEffect(() => {
    const onResize = () => setWidth((current) => clampDockWidth(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      /* the grid is the way out of a panel; a second Escape closes the dock */
      if (activeTool) onTool(null);
      else onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, activeTool, onTool, onOpenChange]);

  /* Browser is the one exception: it is a native WebContentsView that needs room
   * for DevTools, so picking it hands off to the main column and shuts the dock.
   * The rest render in the panel. */
  const pick = (key: DockTool) => {
    if (key === "browser") {
      onTool(null);
      onOpenBrowser();
      return;
    }
    onTool(key);
    onOpenChange(true);
  };

  void workspaceName;

  return (
    <aside
      className={cn("relative flex h-full shrink-0 flex-col overflow-hidden bg-canvas", open && "border-l border-line")}
      style={{ width: open ? width : 0, transition: resizing ? "none" : "width 280ms cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ width, opacity: open ? 1 : 0 }}>
        {open ? (
          activeTool === null ? (
            <DockLauncher tools={LAUNCHER} onPick={pick} />
          ) : (
            <>
              {/* back to the launcher, then every tool one click away */}
              <header className="flex h-[42px] shrink-0 items-center gap-0.5 border-b border-line px-2">
                <button
                  type="button"
                  title={t("All tools")}
                  onClick={() => onTool(null)}
                  className="pressable flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <GaugeIcon size={14} />
                </button>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
                {stripTools.map((entry, index) => (
                  <button
                    key={entry}
                    type="button"
                    title={t(TOOL_LABEL[entry])}
                    aria-pressed={activeTool === entry}
                    onClick={() => pick(entry)}
                    style={{ animation: `row-enter 240ms cubic-bezier(0.23,1,0.32,1) ${index * 25}ms both` }}
                    className={cn(
                      "pressable flex size-7 items-center justify-center rounded-[6px]",
                      activeTool === entry ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
                    )}
                  >
                    {TOOL_ICON[entry](14)}
                  </button>
                ))}
              </header>

              <div key={activeTool} className="view-enter flex min-h-0 flex-1 flex-col">
                {activeTool === "changes" ? (
                  <Suspense fallback={<DockSkeleton />}>
                    <ChangesPanel messages={messages} activeFile={activeChangeFile} onOpen={onOpenDiff} />
                  </Suspense>
                ) : activeTool === "file" ? (
                  /* a file replaces the tree inside the same tab — closing the
                     viewer walks back to the tree it came from */
                  openFile ? (
                    <Suspense fallback={<DockSkeleton />}>
                      <FileViewer
                        path={openFile}
                        diffLines={activeChange && (activeChange.path ?? activeChange.file) === openFile ? activeChange.diffLines : undefined}
                        onClose={onCloseFile}
                        onReveal={onReveal}
                        onAddToChat={onAddToChat}
                      />
                    </Suspense>
                  ) : (
                    <Suspense fallback={<DockSkeleton />}>
                      <FileBrowser
                        root={cwd}
                        activePath={openFile}
                        onOpen={onOpenFile}
                        onReveal={onReveal}
                        showAll={showAll}
                        onShowAll={setShowAll}
                      />
                    </Suspense>
                  )
                ) : activeTool === "plan" ? (
                  <Suspense fallback={<DockSkeleton />}>
                    <PlanPanel state={state} buildModel={buildModel} onAction={onPlanAction} />
                  </Suspense>
                ) : activeTool === "agents" ? (
                  <Suspense fallback={<DockSkeleton />}>
                    <AgentFleetPanel fleet={state.fleet} onInterrupt={onFleetInterrupt} />
                  </Suspense>
                ) : activeTool === "session" ? (
                  /* every prompt this session, in order; a row jumps back to its turn */
                  <Suspense fallback={<DockSkeleton />}>
                    <SessionOutline messages={messages} onJump={onJumpToTurn} />
                  </Suspense>
                ) : (
                  <Suspense fallback={<DockSkeleton />}>
                    <TerminalPanel cwd={cwd} />
                  </Suspense>
                )}
              </div>
            </>
          )
        ) : null}
      </div>

      {/* The seam on the left edge is the resize handle; the border is what it
          grabs. Double-click puts it back to the design width. */}
      {open ? (
        <div
          onMouseDown={onStartResize}
          onDoubleClick={resetWidth}
          title={t("Drag to resize, double-click to reset")}
          className="group/dock-resizer absolute inset-y-0 left-0 z-30 w-1.5 cursor-col-resize"
        >
          <div
            className={cn(
              "mx-auto h-full w-px transition-colors duration-150",
              resizing ? "bg-accent" : "bg-transparent group-hover/dock-resizer:bg-accent/50",
            )}
          />
        </div>
      ) : null}

      {/* No edge strip: the panel's toggle is the button in the view header,
          which when open sits immediately to the left of this column. A second
          toggle against the window edge would be two controls for one panel. */}
    </aside>
  );
});
