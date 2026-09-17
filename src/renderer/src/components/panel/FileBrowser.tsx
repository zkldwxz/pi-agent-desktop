import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "@shared/workspace";
import { cn } from "../../lib/cn";
import { ChevronDownIcon, EyeIcon, FolderIcon, RefreshIcon } from "../icons";

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`;
  return `${bytes}B`;
}

/**
 * Project file browser for the sidebar.
 *
 * Lazy per-directory listing (one IPC per expanded folder, not a full tree
 * walk), so opening a large repo stays instant. Directories sort first, and
 * the noisy ones (`node_modules`, `.git`, build output) are hidden until the
 * user asks for them.
 */
export function FileBrowser({
  root,
  activePath,
  onOpen,
  onReveal,
  showAll: showAllProp,
  onShowAll,
}: {
  root: string;
  activePath?: string;
  onOpen: (entry: FileEntry) => void;
  onReveal: (path: string) => void;
  /** when provided the parent owns the toggle, so it survives panel switches */
  showAll?: boolean;
  onShowAll?: (showAll: boolean) => void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, FileEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [localShowAll, setLocalShowAll] = useState(false);
  const showAll = showAllProp ?? localShowAll;
  const setShowAll = (value: boolean) => (onShowAll ? onShowAll(value) : setLocalShowAll(value));
  const [error, setError] = useState<string | undefined>(undefined);
  const loadedFor = useRef<string>("");

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const listing = await window.pi.listDir(root, showAll);
    setEntries(listing.entries);
    setError(listing.error);
    setLoading(false);
    loadedFor.current = root;
  }, [root, showAll]);

  useEffect(() => {
    void loadRoot();
    setExpanded({});
  }, [loadRoot]);

  const toggle = async (dir: FileEntry) => {
    if (expanded[dir.path]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[dir.path];
        return next;
      });
      return;
    }
    const listing = await window.pi.listDir(dir.path, showAll);
    setExpanded((current) => ({ ...current, [dir.path]: listing.entries }));
  };

  const Row = ({
    entry,
    depth,
    nested,
  }: {
    entry: FileEntry;
    depth: number;
    nested?: boolean;
  }) => {
    const isOpen = Boolean(expanded[entry.path]);
    const active = activePath === entry.path;
    return (
      <>
        <button
          type="button"
          onClick={() => (entry.kind === "dir" ? void toggle(entry) : onOpen(entry))}
          onContextMenu={(event) => {
            event.preventDefault();
            onReveal(entry.path);
          }}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn(
            "group/file pressable row-enter flex h-7 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left",
            active ? "bg-surface text-ink shadow-hairline" : "text-ink-2 hover:bg-hover",
          )}
        >
          {entry.kind === "dir" ? (
            <span className="relative flex size-3.5 shrink-0 items-center justify-center text-ink-3">
              <FolderIcon
                size={13}
                className="absolute transition-opacity duration-150 group-hover/file:opacity-0"
              />
              <ChevronDownIcon
                size={12}
                strokeWidth={2.2}
                className="absolute opacity-0 transition-[opacity,transform] duration-150 group-hover/file:opacity-100"
                style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
              />
            </span>
          ) : (
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              <span className="size-[5px] rounded-[1px] bg-line-strong" />
            </span>
          )}
          <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", active && "font-medium")}>{entry.name}</span>
          {entry.kind === "file" && entry.size !== undefined ? (
            <span className="shrink-0 font-mono text-[9.5px] text-ink-3 tabular-nums">{formatSize(entry.size)}</span>
          ) : null}
        </button>
        {isOpen && nested
          ? (expanded[entry.path] ?? []).map((child) => (
              <Row key={child.path} entry={child} depth={depth + 1} nested />
            ))
          : null}
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{root}</span>
        <button
          type="button"
          title={showAll ? "Hide ignored folders" : "Show ignored folders"}
          onClick={() => setShowAll(!showAll)}
          className={cn(
            "pressable flex size-6 items-center justify-center rounded-[5px]",
            showAll ? "bg-field text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          <EyeIcon size={12} />
        </button>
        <button
          type="button"
          title="Refresh"
          onClick={() => void loadRoot()}
          className="pressable flex size-6 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <RefreshIcon size={12} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-1 py-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="h-6 rounded-[6px] bg-hover-2"
                style={{ animation: `fade-in 300ms ease-out ${index * 40}ms both` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="px-1 py-4 text-[11.5px] text-red">{error}</div>
        ) : entries.length === 0 ? (
          <div className="px-1 py-4 text-[11.5px] text-ink-3">Empty folder.</div>
        ) : (
          <div className="flex flex-col gap-px">
            {entries.map((entry) => (
              <Row key={entry.path} entry={entry} depth={0} nested />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
