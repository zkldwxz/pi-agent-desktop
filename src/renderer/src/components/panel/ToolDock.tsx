import { Suspense, lazy, memo, useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChatMessage, HostState, PlanAction } from "@shared/types";
import type { ChangeEntry } from "./ChangesPanel";
import type { FileEntry } from "@shared/workspace";
import { cn } from "../../lib/cn";
import { t, useLocale } from "../../lib/i18n";
// The dock is always mounted but its panels are not; each arrives on demand.
const ChangesPanel = lazy(() => import("./ChangesPanel").then((m) => ({ default: m.ChangesPanel })));
const ScmPanel = lazy(() => import("./ScmPanel").then((m) => ({ default: m.ScmPanel })));
const FileBrowser = lazy(() => import("./FileBrowser").then((m) => ({ default: m.FileBrowser })));
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const FileViewer = lazy(() => import("./FileViewer").then((m) => ({ default: m.FileViewer })));
const SessionOutline = lazy(() => import("./SessionOutline").then((m) => ({ default: m.SessionOutline })));
const PlanPanel = lazy(() => import("./PlanPanel").then((m) => ({ default: m.PlanPanel })));
const AgentFleetPanel = lazy(() => import("./AgentFleetPanel").then((m) => ({ default: m.AgentFleetPanel })));

/**
 * Inline placeholder for a dock panel.
 *
 * The reference's shape, at its own pitch: 12px of padding, 16px rows 6px apart,
 * each row a 32×12 gutter chip beside a 12px bar. That reads as a listing, which
 * is what every panel in here is; the seven fat bars this replaced read as a
 * form, and since the panel usually lands in well under 200ms, they were also a
 * *moving* form — the shared `Skeleton` sweeps. Static on purpose: a sweep is a
 * claim that something is being fetched, and at this duration it is a flicker.
 */
function DockSkeleton() {
  const widths = [72, 58, 86, 64, 78, 52, 90, 68, 48, 82];
  return (
    <div className="flex flex-col gap-[6px] p-[12px]" aria-hidden>
      {widths.map((width, index) => (
        <div key={index} className="flex h-[16px] shrink-0 items-center gap-[8px]">
          <span className="h-[12px] w-[32px] shrink-0 rounded-tiny bg-hover" />
          <span className="h-[12px] rounded-tiny bg-hover-2" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

import {
  FilePenIcon,
  FolderIcon,
  GaugeIcon,
  GitBranchIcon,
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
export type DockTool = "file" | "terminal" | "changes" | "scm" | "browser" | "session" | "plan" | "agents";

/* labels are translated at render time, the keys stay stable */
const TOOL_LABEL: Record<DockTool, string> = {
  file: "Files",
  terminal: "Terminal",
  changes: "Changes",
  scm: "Source control",
  browser: "Browser",
  session: "Session",
  plan: "Plan",
  agents: "Agents",
};

const TOOL_ICON: Record<DockTool, (size: number) => ReactNode> = {
  file: (size) => <FolderIcon size={size} />,
  terminal: (size) => <TerminalIcon size={size} />,
  changes: (size) => <FilePenIcon size={size} />,
  scm: (size) => <GitBranchIcon size={size} />,
  browser: (size) => <GlobeIcon size={size} />,
  session: (size) => <MessageIcon size={size} />,
  plan: (size) => <ListChecksIcon size={size} />,
  agents: (size) => <UsersIcon size={size} />,
};

/** The launcher's order, read across two columns. */
const LAUNCHER: DockTool[] = ["changes", "scm", "browser", "terminal", "file", "session"];

/**
 * The dock's landing screen: one tile per tool, big enough to hit without
 * hunting. Picking a tile puts that panel in its place; the grid comes back from
 * the strip's first button or Escape.
 */
function DockLauncher({ tools, onPick }: { tools: DockTool[]; onPick: (tool: DockTool) => void }) {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-[12px]">
      {/* `my-auto` rather than `items-center`: the grid is centred while it fits,
          and scrolls from the top once five tiles no longer do. The tile is the
          reference's 88px with a 6px gutter, and its label is the dock's one
          size — 14px medium — not a caption: a tile is a title, and this column
          has exactly one title size. */}
      <div className="my-auto grid grid-cols-2 gap-[6px]">
        {tools.map((key, index) => (
          <button
            key={key}
            type="button"
            title={t(TOOL_LABEL[key])}
            onClick={() => onPick(key)}
            style={{ animation: `row-enter 240ms var(--ease-out-strong-css) ${index * 30}ms both` }}
            className="pressable flex h-[88px] flex-col items-center justify-center gap-[8px] rounded-card bg-surface shadow-hairline transition-colors duration-100 hover:bg-hover"
          >
            <span className="text-ink-3">{TOOL_ICON[key](18)}</span>
            <span className="text-ui-base font-medium leading-none text-ink-2">{t(TOOL_LABEL[key])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const WIDTH_DEFAULT = 340;
/** the panel may be dragged down to this and no further — the reference's floor */
const WIDTH_MIN = 240;
const DOCK_WIDTH_KEY = "pi:dock-width";

/* A terminal at 340 columns nothing useful, so the column is draggable — but it
 * stops short of squeezing the chat away, which is the wider pane by rights.
 * 240px is the floor the reference uses: below it a file row's name and its
 * counts cannot both be read, and the drag simply stops there rather than
 * collapsing the panel out from under the pointer. */
function clampDockWidth(value: number): number {
  const max = Math.max(WIDTH_DEFAULT, Math.min(720, window.innerWidth - 520));
  return Math.round(Math.min(Math.max(value, WIDTH_MIN), max));
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
 *
 * Open and close are two different motions on purpose. The column's *width* is
 * what slides; the panel itself never re-lays-out while it does, because its
 * contents are pinned to their final width and only their opacity rides along.
 * Re-wrapping a terminal or a diff on every frame of a 280ms slide is what the
 * close used to do, and it is what made it look like the panel was tearing
 * rather than leaving.
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
  windowControls,
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
  /** off macOS, the window's buttons: they end this card's header while it is
   *  the rightmost one */
  windowControls?: ReactNode;
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
      /* The gutter is 4px on the right and the bottom, and none on the left or
         top: the seam between the conversation and this column is the resize
         handle's own hit area, which is what ZCode does (`p-1 pl-0 pt-0` over a
         4px `w-1` handle) — a gutter *plus* a handle costs 3% of a 340px column
         twice over. Values are px, not rem utilities, because this app's root
         font-size is 14px: `px-1` would be 3.5px, and the reference's scale here
         is genuinely 4.

         The inner wrapper is what fades. While the panel is closing, this
         element's content keeps its full `width` and only its opacity moves:
         animating the width the way it used to meant every row inside re-wrapped
         on every frame of the slide, which is the wobble that made the close feel
         wrong. The outer element owns the width, the inner one owns the fade. */
      /* an island beside the conversation's: 6px apart (the parent row
         carries the window-edge gaps) */
      className={cn("relative flex h-full shrink-0 flex-col", open ? "pl-1.5" : null)}
      style={{
        width: open ? width + 6 : 0,
        /* 200ms on Tailwind's own `ease-out` (0, 0, 0.2, 1) — the reference's
           slide. The old 280ms on `--ease-link-css` spent most of its travel in
           the first 80ms and then crawled, which read as a stutter rather than
           as a panel arriving. */
        transition: resizing ? "none" : "width 200ms cubic-bezier(0, 0, 0.2, 1)",
      }}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden rounded-window border border-line bg-page",
          !open && "pointer-events-none",
        )}
        style={{
          width,
          opacity: open ? 1 : 0,
          transition: resizing ? "none" : "opacity 200ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        {open ? (
          activeTool === null ? (
            <DockLauncher tools={LAUNCHER} onPick={pick} />
          ) : (
            <>
              {/* Back to the launcher, then every tool one click away.
                  Geometry is the reference's tab bar: a 48px row of 28px chips
                  with 4px between them and 8px at each end — 10px of air above
                  and below a 28px chip is what makes the row read as a bar
                  rather than as icons floating in the frame. px values, because
                  `size-7` is 24.5px under this app's 14px root. */}
              {/* the card's header, as high as the conversation card's (30) so
                  the two rows run on one line across the window */}
              <header className="titlebar-drag flex h-[30px] shrink-0 items-center gap-0.5 px-1.5">
                <button
                  type="button"
                  title={t("All tools")}
                  onClick={() => onTool(null)}
                  className="titlebar-no-drag pressable flex size-6 items-center justify-center rounded-[5px] text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <GaugeIcon size={14} />
                </button>
                <span aria-hidden className="mx-[4px] h-4 w-px shrink-0 bg-line" />
                {stripTools.map((entry, index) => (
                  <button
                    key={entry}
                    type="button"
                    title={t(TOOL_LABEL[entry])}
                    aria-pressed={activeTool === entry}
                    onClick={() => pick(entry)}
                    style={{ animation: `row-enter 240ms var(--ease-out-strong-css) ${index * 25}ms both` }}
                    className={cn(
                      "titlebar-no-drag pressable flex size-6 items-center justify-center rounded-[5px]",
                      activeTool === entry ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                    )}
                  >
                    {TOOL_ICON[entry](14)}
                  </button>
                ))}
                {windowControls ? (
                  <>
                    <span className="flex-1" />
                    {windowControls}
                  </>
                ) : null}
              </header>

              <div key={activeTool} className="view-enter flex min-h-0 flex-1 flex-col">
                {activeTool === "changes" ? (
                  <Suspense fallback={<DockSkeleton />}>
                    <ChangesPanel messages={messages} activeFile={activeChangeFile} onOpen={onOpenDiff} />
                  </Suspense>
                ) : activeTool === "scm" ? (
                  <Suspense fallback={<DockSkeleton />}>
                    <ScmPanel cwd={cwd} onOpenFile={onOpenFile} />
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
        /* The grab strip is the gap, not the panel: an 8px hit area straddling
           the seam, with a 2px indicator inset by the frame's own radius at both
           ends — the shape ZCode's resize handles have. The indicator is 2px and
           appears on hover only; a permanently painted strip is a second border
           between two panes that already have one each. */
        <div
          onMouseDown={onStartResize}
          onDoubleClick={resetWidth}
          title={t("Drag to resize, double-click to reset")}
          className="group/dock-resizer absolute inset-y-0 -left-[4px] z-30 w-[8px] cursor-col-resize"
        >
          <div
            className={cn(
              "absolute inset-y-[10px] left-1/2 w-[2px] -translate-x-1/2 rounded-full transition-opacity duration-150",
              resizing ? "bg-accent opacity-100" : "bg-line-strong opacity-0 group-hover/dock-resizer:opacity-100",
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
