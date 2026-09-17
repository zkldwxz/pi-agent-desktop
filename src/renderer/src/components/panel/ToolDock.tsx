import { Suspense, lazy, memo, useEffect, useState, type ReactNode } from "react";
import type { ChatMessage, HostState } from "@shared/types";
import type { FileEntry } from "@shared/workspace";
import { cn } from "../../lib/cn";
// The dock is always mounted but its panels are not; each arrives on demand.
const ChangesPanel = lazy(() => import("./ChangesPanel").then((m) => ({ default: m.ChangesPanel })));
const FileBrowser = lazy(() => import("./FileBrowser").then((m) => ({ default: m.FileBrowser })));
const TerminalPanel = lazy(() => import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const TodoPanel = lazy(() => import("./TodoPanel").then((m) => ({ default: m.TodoPanel })));
const CanvasPanel = lazy(() => import("./CanvasPanel").then((m) => ({ default: m.CanvasPanel })));

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
  ChevronDownIcon,
  CheckCircleIcon,
  FilePenIcon,
  FolderIcon,
  GlobeIcon,
  LayersIcon,
  TerminalIcon,
} from "../icons";

/** The panels the dock can show, in the order they appear. */
export type DockTool = "file" | "terminal" | "changes" | "browser" | "canvas" | "tasks";

const TOOLS: Array<{ key: DockTool; label: string; icon: ReactNode }> = [
  { key: "file", label: "Files", icon: <FolderIcon size={14} /> },
  { key: "terminal", label: "Terminal", icon: <TerminalIcon size={14} /> },
  { key: "changes", label: "Changes", icon: <FilePenIcon size={14} /> },
  { key: "browser", label: "Browser", icon: <GlobeIcon size={14} /> },
  { key: "canvas", label: "Canvas", icon: <LayersIcon size={14} /> },
  { key: "tasks", label: "Tasks", icon: <CheckCircleIcon size={14} /> },
];

const WIDTH_OPEN = 340;

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/**
 * The right-hand dock.
 *
 * The panel is a small vertical nav on the left and the selected tool on the
 * right, so switching tools is one click and never hides the list. It is opened
 * and closed by `DockToggle`, which sits in the header of the current view — the
 * strip that used to hold a second toggle against the window edge is gone, so
 * there is exactly one control for one panel.
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
  onOpenDiff,
  onReveal,
  onJumpToTurn,
  onOpenBrowser,
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
  onOpenDiff: (path: string) => void;
  onReveal: (path: string) => void;
  onJumpToTurn: (key: string) => void;
  /** the native browser view needs the whole window, so it leaves the dock */
  onOpenBrowser: () => void;
}) {
  // (the memo is what keeps a streaming answer from re-rendering this subtree
  // on every token — its inputs are deferred by the app)
  const [showAll, setShowAll] = useState(false);
  const workspaceName = baseName(cwd);
  /* no tool picked yet lands on Files — tabs are one click, always */
  const activeTool: DockTool = tool ?? "file";
  const width = open ? WIDTH_OPEN : 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

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
      className={`flex h-full shrink-0 flex-col overflow-hidden bg-canvas ${open ? "border-l border-line" : ""}`}
      style={{ width, transition: "width 280ms cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ width: WIDTH_OPEN, opacity: open ? 1 : 0 }}>
        {open ? (
          <>
            {/* Cursor-style tab strip: every tool is one click, always visible */}
            <header className="flex h-[42px] shrink-0 items-center gap-0.5 border-b border-line px-2">
              {TOOLS.map((entry, index) => (
                <button
                  key={entry.key}
                  type="button"
                  title={entry.label}
                  aria-pressed={activeTool === entry.key}
                  onClick={() => pick(entry.key)}
                  style={{ animation: `row-enter 240ms cubic-bezier(0.23,1,0.32,1) ${index * 25}ms both` }}
                  className={cn(
                    "pressable flex size-7 items-center justify-center rounded-[6px]",
                    activeTool === entry.key ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
                  )}
                >
                  {entry.icon}
                </button>
              ))}
            </header>

            <div key={activeTool} className="view-enter flex min-h-0 flex-1 flex-col">
              {activeTool === "changes" ? (
                <Suspense fallback={<DockSkeleton />}>
                  <ChangesPanel messages={messages} activeFile={activeChangeFile} onOpen={(change) => onOpenDiff(change.file)} />
                </Suspense>
              ) : activeTool === "file" ? (
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
              ) : activeTool === "canvas" ? (
                <Suspense fallback={<DockSkeleton />}>
                  <CanvasPanel messages={messages} onJumpToTurn={onJumpToTurn} />
                </Suspense>
              ) : activeTool === "tasks" ? (
                <Suspense fallback={<DockSkeleton />}>
                  <TodoPanel state={state} messages={messages} onJumpToTurn={onJumpToTurn} />
                </Suspense>
              ) : (
                <Suspense fallback={<DockSkeleton />}>
                  <TerminalPanel cwd={cwd} />
                </Suspense>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* No edge strip: the panel's toggle is the button in the view header,
          which when open sits immediately to the left of this column. A second
          toggle against the window edge would be two controls for one panel. */}
    </aside>
  );
});
