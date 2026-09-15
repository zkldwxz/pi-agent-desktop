import { useEffect, useState } from "react";
import type { HostState, ModelEdit, PluginInfo } from "@shared/types";
import { cn } from "../lib/cn";
import { GlideList } from "../components/motion";
import { ModelsView } from "./ModelsView";
import { PluginsView } from "./PluginsView";
import { ViewHeader } from "../components/ui";
import { ExtensionFlow } from "./ExtensionFlow";

type Tab = "plugins" | "skills" | "models" | "rules";

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: "plugins", label: "Extensions", hint: "global and project extensions, plus configured packages" },
  { key: "skills", label: "Skills", hint: "instruction sets the agent loads on demand" },
  { key: "models", label: "Models", hint: "thinking depth, image input, context window, output limits" },
  { key: "rules", label: "Rules", hint: "context files the agent reads at the start of every session" },
];

/**
 * Customize.
 *
 * One place for everything that shapes the agent: extensions, skills, models and
 * rules. These used to sit in the main rail, which made the rail four items
 * long and mixed "where am I working" with "how is the agent configured".
 *
 * Plugins and skills are the same underlying list filtered by kind, so there is
 * no second source of truth.
 */
export function CustomizeView({
  state,
  plugins,
  loading,
  dockToggle,
  onRefresh,
  onToggle,
  onDelete,
  onOpen,
  onUseModel,
  onSaveModel,
  onDeleteModel,
  onSetDefaultModel,
  onReload,
}: {
  state: HostState;
  plugins: PluginInfo[];
  loading: boolean;
  /** the right panel's trigger, positioned by the shell */
  dockToggle?: React.ReactNode;
  onRefresh: () => void;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onDelete: (plugin: PluginInfo) => void;
  onOpen: (plugin: PluginInfo) => void;
  onUseModel: (provider: string, modelId: string) => void;
  onSaveModel: (edit: ModelEdit) => void;
  onDeleteModel: (provider: string, modelId: string) => void;
  onSetDefaultModel: (provider: string, modelId: string) => void;
  onReload: () => void;
}) {
  const [tab, setTab] = useState<Tab>("plugins");

  // extensions and skills come from one list; keep the tab in range if it empties
  useEffect(() => {
    if (tab === "skills" && !plugins.some((plugin) => plugin.kind === "skill") && !loading) setTab("plugins");
  }, [tab, plugins, loading]);

  const extensions = plugins.filter((plugin) => plugin.kind === "extension" || plugin.kind === "package");
  const skills = plugins.filter((plugin) => plugin.kind === "skill");
  const rules = plugins.filter((plugin) => plugin.kind === "prompt" || plugin.kind === "theme");
  const active = TABS.find((entry) => entry.key === tab)!;

  const counts: Record<Tab, number> = {
    plugins: extensions.length,
    skills: skills.length,
    models: state.models.length,
    rules: rules.length,
  };

  return (
    <>
      <ViewHeader
        title="Customize"
        subtitle={active.hint}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                onReload();
              }}
              className="pressable inline-flex h-6 items-center rounded-chip bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
            >
              Rescan
            </button>
            {dockToggle}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r border-line bg-canvas p-2">
          <GlideList rowSelector="[data-cat]" highlightClassName="bg-hover-2" radius={7}>
            {TABS.map((entry) => (
              <button
                key={entry.key}
                data-cat
                type="button"
                onClick={() => setTab(entry.key)}
                className={cn(
                  "glide-row pressable flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left",
                  tab === entry.key ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{entry.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-3 tabular-nums">{counts[entry.key]}</span>
              </button>
            ))}
          </GlideList>
        </nav>

        <div key={tab} className="view-enter scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          {tab === "plugins" ? (
            <div className="shrink-0 border-b border-line px-4 py-3">
              <ExtensionFlow state={state} />
            </div>
          ) : null}
          {tab === "models" ? (
            <ModelsView
              state={state}
              onRefresh={onReload}
              onUseModel={onUseModel}
              onSave={onSaveModel}
              onDeleteOverride={onDeleteModel}
              onSetDefault={onSetDefaultModel}
            />
          ) : tab === "rules" ? (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
              {rules.length ? (
                <PluginsView
                  bare
                  plugins={rules}
                  loading={loading}
                  onRefresh={onRefresh}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onOpen={onOpen}
                />
              ) : (
                <div className="rounded-card border border-dashed border-line-strong px-4 py-8 text-center text-[12px] text-ink-3">
                  No prompt templates or themes found. Add a <span className="font-mono text-ink-2">.md</span> file under{" "}
                  <span className="font-mono text-ink-2">~/.pi/agent/prompts/</span> and rescan.
                </div>
              )}
            </div>
          ) : (
            <PluginsView
              bare
              plugins={tab === "skills" ? skills : extensions}
              loading={loading}
              onRefresh={onRefresh}
              onToggle={onToggle}
              onDelete={onDelete}
              onOpen={onOpen}
            />
          )}
        </div>
      </div>
    </>
  );
}
