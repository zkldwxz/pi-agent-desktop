import { useMemo, useState } from "react";
import type { PluginInfo, PluginKind } from "@shared/types";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import { FolderOpenIcon, PuzzleIcon, SearchIcon, TrashIcon } from "../components/icons";
import { Card, Chip, EmptyState, Skeleton } from "../components/ui";

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
      title={disabled ? t("Declared in settings.json — toggle it there") : on ? t("Disable") : t("Enable")}
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
          transition: "transform 240ms var(--ease-out-strong-css)",
        }}
      />
    </button>
  );
}

export function PluginsView({
  plugins,
  loading,
  onToggle,
  onDelete,
  onOpen,
}: {
  plugins: PluginInfo[];
  loading: boolean;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onDelete: (plugin: PluginInfo) => void;
  onOpen: (plugin: PluginInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PluginKind | "all">("all");
  const [confirming, setConfirming] = useState<string | null>(null);

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

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5 px-8 pt-10 pb-10">
        <div className="flex items-center gap-2">
          <Chip active={kind === "all"} onClick={() => setKind("all")} index={0}>
            {t("All")}
          </Chip>
          {(Object.keys(KIND_LABEL) as PluginKind[]).map((key, index) => {
            const total = plugins.filter((plugin) => plugin.kind === key).length;
            if (!total) return null;
            return (
              <Chip key={key} active={kind === key} onClick={() => setKind(key)} index={index + 1}>
                {t(KIND_LABEL[key])}
                <span className="tabular-nums text-ink-3">{total}</span>
              </Chip>
            );
          })}
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-chip bg-field px-2.5 shadow-hairline">
            <SearchIcon size={12} className="shrink-0 text-ink-3" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Filter by name, description or path")}
              className="min-w-0 flex-1 bg-transparent text-ui-caption text-ink outline-none placeholder:text-ink-4"
            />
          </div>
        </div>

        {!loading && errored.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-orange-tint px-4 py-2.5 text-ui-caption text-orange">
            <span>
              {tf(errored.length === 1 ? "{count} entry could not be loaded" : "{count} entries could not be loaded", {
                count: errored.length,
              })}
            </span>
            <span className="font-mono text-ui-xs">{errored.map((plugin) => plugin.name).join(", ")}</span>
          </div>
        ) : null}

        {loading && !plugins.length ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[78px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={plugins.length ? t("No plugins match the filter") : t("No plugins installed")}
            body={
              plugins.length
                ? t("Try a different keyword or switch the category filter.")
                : t("Drop an extension into ~/.pi/agent/extensions/ or .pi/extensions/ and it will appear here.")
            }
          />
        ) : (
          groups.map(([groupKind, items], groupIndex) => (
            <div key={groupKind} className="flex flex-col gap-3">
              <div
                className="flex items-center gap-2 pt-1 text-ui-caption text-ink-3"
                style={{ animation: "fade-in 240ms ease-out both" }}
              >
                <span className="font-medium tracking-[0.5px] text-ink-2">{t(KIND_LABEL[groupKind]).toUpperCase()}</span>
                <span className="tabular-nums">{items.length}</span>
              </div>
              {items.map((plugin, index) => (
                <Card
                  key={plugin.id}
                  index={groupIndex * 3 + index}
                  className={cn(
                    "flex items-center gap-4 p-4 transition-colors duration-150 hover:bg-hover",
                    !plugin.enabled && "opacity-75",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-control",
                      plugin.enabled ? "bg-accent-tint text-accent-ink" : "bg-field text-ink-3",
                    )}
                  >
                    <PuzzleIcon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-ui-base font-medium text-ink">{plugin.name}</span>
                      <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-ui-xs text-ink-3">
                        {plugin.scope}
                      </span>
                      {plugin.error ? (
                        <span className="inline-flex h-5 items-center rounded-chip bg-red-tint px-1.5 text-ui-xs text-red">
                          {plugin.error}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-ui-caption text-ink-3">{plugin.description ?? plugin.path}</div>
                    <div className="mt-1 truncate font-mono text-ui-xs text-ink-3">{plugin.path}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-ui-xs text-ink-3 tabular-nums">
                    {formatBytes(plugin.sizeBytes)}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Toggle
                      on={plugin.enabled}
                      disabled={!plugin.toggleable}
                      label={plugin.name}
                      onClick={() => onToggle(plugin, !plugin.enabled)}
                    />
                    <button
                      type="button"
                      title={t("Reveal in explorer")}
                      onClick={() => onOpen(plugin)}
                      className="pressable flex size-7 items-center justify-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      <FolderOpenIcon size={14} />
                    </button>
                    {confirming === plugin.id ? (
                      <div
                        className="flex items-center gap-1.5"
                        style={{ animation: "pop-in 180ms var(--ease-out-strong-css) both", transformOrigin: "right center" }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(plugin);
                            setConfirming(null);
                          }}
                          className="pressable inline-flex h-7 items-center rounded-chip bg-red px-2.5 text-ui-sm text-white"
                        >
                          {t("Move to trash")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="pressable inline-flex h-7 items-center rounded-chip bg-field px-2.5 text-ui-sm text-ink-2 hover:bg-hover-2"
                        >
                          {t("Cancel")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title={t("Delete")}
                        disabled={!plugin.toggleable}
                        onClick={() => setConfirming(plugin.id)}
                        className={cn(
                          "pressable flex size-7 items-center justify-center rounded-control text-ink-3 hover:bg-red-tint hover:text-red",
                          !plugin.toggleable && "opacity-40",
                        )}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ))
        )}

        <div className="pt-1 text-ui-sm leading-relaxed text-ink-3">
          {t("Disabling moves the file to")} <span className="font-mono">extensions.disabled/</span>{" "}
          {t("next to its folder, so the Pi CLI sees the same change. Deleting moves it to")}{" "}
          <span className="font-mono">~/.pi/agent/trash/</span>.
        </div>
      </div>
    </div>
  );
}
