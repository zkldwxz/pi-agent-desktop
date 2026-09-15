import { useMemo, useState } from "react";
import type { PluginInfo, PluginKind } from "@shared/types";
import { cn } from "../lib/cn";
import { FolderOpenIcon, PuzzleIcon, RefreshIcon, SearchIcon, TrashIcon } from "../components/icons";
import { Card, Chip, EmptyState, Skeleton, ViewHeader } from "../components/ui";

const KIND_LABEL: Record<PluginKind, string> = {
  extension: "Extensions",
  package: "Packages",
  skill: "Skills",
  prompt: "Prompts",
  theme: "Themes",
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function Toggle({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={disabled ? "Declared in settings.json — toggle it there" : on ? "Disable" : "Enable"}
      className={cn(
        "pressable relative h-[18px] w-8 shrink-0 rounded-full",
        on ? "bg-green" : "bg-line-strong",
        disabled && "opacity-40",
      )}
      style={{ transition: "background-color 200ms ease-out" }}
    >
      <span
        className="absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow"
        style={{
          transform: on ? "translateX(14px)" : "translateX(0)",
          transition: "transform 240ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />
    </button>
  );
}

export function PluginsView({
  plugins,
  loading,
  bare = false,
  onRefresh,
  onToggle,
  onDelete,
  onOpen,
}: {
  plugins: PluginInfo[];
  loading: boolean;
  /** when embedded in another view, skip the header and let the host own it */
  bare?: boolean;
  onRefresh: () => void;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onDelete: (plugin: PluginInfo) => void;
  onOpen: (plugin: PluginInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PluginKind | "all">("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins.filter((plugin) => {
      if (kind !== "all" && plugin.kind !== kind) return false;
      if (!q) return true;
      return `${plugin.name} ${plugin.description ?? ""} ${plugin.path}`.toLowerCase().includes(q);
    });
  }, [plugins, query, kind]);

  const groups = useMemo(() => {
    const map = new Map<PluginKind, PluginInfo[]>();
    for (const plugin of filtered) {
      const list = map.get(plugin.kind) ?? [];
      list.push(plugin);
      map.set(plugin.kind, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const errored = plugins.filter((plugin) => plugin.error);

  const counts = useMemo(
    () => ({
      total: plugins.length,
      enabled: plugins.filter((plugin) => plugin.enabled).length,
      disabled: plugins.filter((plugin) => !plugin.enabled).length,
    }),
    [plugins],
  );

  return (
    <>
      {bare ? null : (
      <ViewHeader
        title="Plugins"
        subtitle={`${counts.total} installed · ${counts.enabled} enabled · ${counts.disabled} disabled`}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="flex h-6 items-center gap-1.5 rounded-chip bg-field px-2">
              <SearchIcon size={12} className="text-ink-3" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter plugins"
                className="w-40 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <Chip
              onClick={() => {
                setError(undefined);
                try {
                  onRefresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
              title="Rescan plugin folders"
            >
              <RefreshIcon size={12} />
              Rescan
            </Chip>
          </div>
        }
      />
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className={bare ? "flex w-full flex-col gap-3 px-3 pb-3" : "mx-auto flex w-full max-w-[1180px] flex-col gap-3 p-4"}>
          <div className="flex items-center gap-1">
            <Chip active={kind === "all"} onClick={() => setKind("all")} index={0}>
              All
            </Chip>
            {(Object.keys(KIND_LABEL) as PluginKind[]).map((key, index) => {
              const total = plugins.filter((plugin) => plugin.kind === key).length;
              if (!total) return null;
              return (
                <Chip key={key} active={kind === key} onClick={() => setKind(key)} index={index + 1}>
                  {KIND_LABEL[key]}
                  <span className="tabular-nums text-ink-3">{total}</span>
                </Chip>
              );
            })}
          </div>

          {error ? (
            <div
              className="flex items-start gap-2 rounded-card bg-red-tint px-3 py-2 text-[12px] text-red"
              style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
            >
              <span className="min-w-0 flex-1">Could not read the plugin folders: {error}</span>
              <button
                type="button"
                onClick={() => setError(undefined)}
                className="pressable shrink-0 rounded-chip px-1.5 py-0.5 hover:bg-red/10"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {!loading && errored.length ? (
            <div className="flex flex-wrap items-center gap-2 rounded-card bg-orange-tint px-3 py-2 text-[11.5px] text-orange">
              <span>{errored.length} entr{errored.length === 1 ? "y" : "ies"} could not be loaded</span>
              <span className="font-mono text-[10.5px]">{errored.map((plugin) => plugin.name).join(", ")}</span>
            </div>
          ) : null}

          {loading && !plugins.length ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-[62px]" index={index} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={plugins.length ? "No plugins match the filter" : "No plugins installed"}
              body={
                plugins.length
                  ? "Try a different keyword or switch the category filter."
                  : "Drop an extension into ~/.pi/agent/extensions/ or .pi/extensions/ and it will appear here."
              }
            />
          ) : (
            groups.map(([groupKind, items], groupIndex) => (
              <div key={groupKind} className="flex flex-col gap-2">
                <div
                  className="flex items-center gap-2 text-[11.5px] text-ink-3"
                  style={{ animation: "fade-in 240ms ease-out both" }}
                >
                  <span className="font-medium tracking-[0.4px] text-ink-2">{KIND_LABEL[groupKind].toUpperCase()}</span>
                  <span className="tabular-nums">{items.length}</span>
                </div>
                {items.map((plugin, index) => (
                  <Card
                    key={plugin.id}
                    index={groupIndex * 3 + index}
                    className={cn("flex items-center gap-3 p-3 transition-colors duration-150 hover:bg-hover", !plugin.enabled && "opacity-75")}
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-control",
                        plugin.enabled ? "bg-accent-tint text-accent-ink" : "bg-field text-ink-3",
                      )}
                    >
                      <PuzzleIcon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-ink">{plugin.name}</span>
                        <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-[10px] text-ink-3">
                          {plugin.scope}
                        </span>
                        {plugin.error ? (
                          <span className="inline-flex h-5 items-center rounded-chip bg-red-tint px-1.5 text-[10.5px] text-red">
                            {plugin.error}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{plugin.description ?? plugin.path}</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">{plugin.path}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10.5px] text-ink-3 tabular-nums">
                      {formatBytes(plugin.sizeBytes)}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Toggle
                        on={plugin.enabled}
                        disabled={!plugin.toggleable}
                        label={plugin.name}
                        onClick={() => onToggle(plugin, !plugin.enabled)}
                      />
                      <button
                        type="button"
                        title="Reveal in explorer"
                        onClick={() => onOpen(plugin)}
                        className="pressable flex size-7 items-center justify-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        <FolderOpenIcon size={13} />
                      </button>
                      {confirming === plugin.id ? (
                        <div
                          className="flex items-center gap-1"
                          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "right center" }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onDelete(plugin);
                              setConfirming(null);
                            }}
                            className="pressable inline-flex h-6 items-center rounded-chip bg-red px-2 text-[11px] text-white"
                          >
                            Move to trash
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            className="pressable inline-flex h-6 items-center rounded-chip bg-field px-2 text-[11px] text-ink-2 hover:bg-hover-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Delete"
                          disabled={!plugin.toggleable}
                          onClick={() => setConfirming(plugin.id)}
                          className={cn(
                            "pressable flex size-7 items-center justify-center rounded-control text-ink-3 hover:bg-red-tint hover:text-red",
                            !plugin.toggleable && "opacity-40",
                          )}
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ))
          )}

          <div className="text-[11px] text-ink-3">
            Disabling moves the file to <span className="font-mono">extensions.disabled/</span> next to its folder, so the Pi CLI
            sees the same change. Deleting moves it to <span className="font-mono">~/.pi/agent/trash/</span>.
          </div>
        </div>
      </div>
    </>
  );
}
