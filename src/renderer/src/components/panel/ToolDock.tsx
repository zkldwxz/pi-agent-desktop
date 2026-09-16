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
const WIDTH_COMPACT = 232;

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
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const width = open ? (tool ? WIDTH_OPEN : WIDTH_COMPACT) : 0;
  const workspaceName = baseName(cwd);

  useEffect(() => {
    if (openFile) setOpenTabs((current) => (current.includes(openFile) ? current : [openFile, ...current].slice(0, 6)));
  }, [openFile]);

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
    onTool(tool === key ? null : key);
    onOpenChange(true);
  };

  return (
    <aside
      className={`flex h-full shrink-0 flex-row overflow-hidden bg-canvas ${open ? "border-l border-line" : ""}`}
      style={{ width, transition: "width 280ms cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div
        className="flex min-h-0 flex-col"
        style={{ width: tool ? WIDTH_OPEN : WIDTH_COMPACT, opacity: open ? 1 : 0 }}
      >
        {open ? (
          <div key={tool ?? "compact"} className="view-enter flex min-h-0 flex-1 flex-col">
            {tool ? (
              <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line px-3">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                  {TOOLS.find((entry) => entry.key === tool)?.label}
                </span>
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={() => onTool(null)}
                  className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <ChevronDownIcon size={13} className="-rotate-90" />
                </button>
              </header>
            ) : null}

            {tool === null ? (
              /* nothing picked yet — open files, then the tools */
              <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
                <div className="px-1 pb-1 text-[10.5px] tracking-[0.4px] text-ink-3">OPEN TABS</div>
                {openTabs.length ? (
                  openTabs.map((tab, index) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => onOpenDiff(tab)}
                      style={{ animation: `row-enter 360ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 4) * 35}ms both` }}
                      className="pressable flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-hover"
                    >
                      <FilePenIcon size={12} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{baseName(tab)}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-1.5 pb-1 text-[11px] text-ink-3">No files open.</div>
                )}

                <div className="px-1 pt-3 pb-1 text-[10.5px] tracking-[0.4px] text-ink-3">
                  ON {workspaceName.toUpperCase()}
                </div>
                {TOOLS.map((entry, index) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => pick(entry.key)}
                    style={{
                      animation: `row-enter 360ms cubic-bezier(0.23,1,0.32,1) ${Math.min(openTabs.length + index, 4) * 35}ms both`,
                    }}
                    className="pressable flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-hover"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">{entry.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{entry.label}</span>
                  </button>
                ))}
              </div>
            ) : tool === "changes" ? (
              <Suspense fallback={<DockSkeleton />}>
                <ChangesPanel messages={messages} activeFile={activeChangeFile} onOpen={(change) => onOpenDiff(change.file)} />
              </Suspense>
            ) : tool === "file" ? (
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
            ) : tool === "canvas" ? (
              <Suspense fallback={<DockSkeleton />}>
                <CanvasPanel messages={messages} onJumpToTurn={onJumpToTurn} />
              </Suspense>
            ) : tool === "tasks" ? (
              <Suspense fallback={<DockSkeleton />}>
                <TodoPanel state={state} messages={messages} onJumpToTurn={onJumpToTurn} />
              </Suspense>
            ) : (
              <Suspense fallback={<DockSkeleton />}>
                <TerminalPanel cwd={cwd} />
              </Suspense>
            )}
          </div>
        ) : null}
      </div>

      {/* No edge strip: the panel's toggle is the button in the view header,
          which when open sits immediately to the left of this column. A second
          toggle against the window edge would be two controls for one panel. */}
    </aside>
  );
});
