import { useEffect, useState } from "react";
import type { CatalogItem, HostState, ModelEdit, PluginInfo } from "@shared/types";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { GlideList } from "../components/motion";
import { ModelsView } from "./ModelsView";
import { PluginsView } from "./PluginsView";
import { ViewHeader } from "../components/ui";
import { ExtensionFlow } from "./ExtensionFlow";
import { ArrowLeftIcon, GlobeIcon, LayersIcon, ListChecksIcon, ListIcon, SparkIcon } from "../components/icons";

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
  onBack,
  /** create a rule stub in the named scope, then rescan */
  onCreateRule,
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
  /** leave this view — the sidebar no longer carries a Home row */
  onBack?: () => void;
  onCreateRule?: (scope: "global" | "project", name: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("plugins");
  const [ruleName, setRuleName] = useState("");
  const [creatingRule, setCreatingRule] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const submitRule = async (scope: "global" | "project") => {
    const name = ruleName.trim();
    if (!name || creatingRule || !onCreateRule) return;
    setCreatingRule(true);
    setRuleError(null);
    try {
      await onCreateRule(scope, name);
      setRuleName("");
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingRule(false);
    }
  };

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
        title={t("Customize")}
        subtitle={t(active.hint)}
        leading={
          <button
            type="button"
            aria-label={t("Back to the conversation")}
            title={t("Back")}
            onClick={onBack}
            className="pressable -ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <ArrowLeftIcon size={14} />
          </button>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                onReload();
              }}
              className="pressable inline-flex h-7 items-center rounded-chip bg-field px-2.5 text-ui-caption text-ink-2 hover:bg-hover-2"
            >
              {t("Rescan")}
            </button>
            {dockToggle}
          </div>
        }
      />

      {/* Both columns start below the header with the same offset: the tab rail
          and the list read as one row at eye level instead of two things pinned
          to the top edge that you have to look up to find. */}
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-r border-line bg-canvas px-3 pt-10">
          <GlideList rowSelector="[data-cat]" highlightClassName="bg-hover-2" radius={8}>
            {TABS.map((entry) => (
              <button
                key={entry.key}
                data-cat
                type="button"
                onClick={() => setTab(entry.key)}
                className={cn(
                  "glide-row pressable flex h-9 w-full items-center gap-2.5 rounded-control px-3 text-left",
                  tab === entry.key ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-ui-base">{t(entry.label)}</span>
                <span className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">{counts[entry.key]}</span>
              </button>
            ))}
          </GlideList>
        </nav>

        <div key={tab} className="view-enter scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          {tab === "plugins" ? (
            <div className="shrink-0 border-b border-line px-8 pt-10 pb-8">
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
            <>
              {/* rule creation: one name, two destinations */}
              <div className="shrink-0 px-8 pt-8">
                <div className="flex items-center gap-2 rounded-card bg-surface p-2 shadow-hairline">
                  <input
                    value={ruleName}
                    onChange={(event) => setRuleName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing && ruleName.trim()) {
                        event.preventDefault();
                        void submitRule("global");
                      }
                    }}
                    placeholder={t("Rule name")}
                    aria-label={t("Rule name")}
                    className="h-7.5 min-w-0 flex-1 rounded-chip bg-field px-2.5 text-ui-caption text-ink outline-none placeholder:text-ink-4"
                  />
                  <button
                    type="button"
                    disabled={!ruleName.trim() || creatingRule}
                    onClick={() => void submitRule("global")}
                    className="pressable h-7.5 shrink-0 rounded-chip bg-ink px-3 text-ui-sm font-medium text-canvas disabled:opacity-40"
                  >
                    {t("New global rule")}
                  </button>
                  <button
                    type="button"
                    disabled={!ruleName.trim() || creatingRule}
                    onClick={() => void submitRule("project")}
                    className="pressable h-7.5 shrink-0 rounded-chip bg-field px-3 text-ui-sm font-medium text-ink-2 hover:bg-hover-2 hover:text-ink disabled:opacity-40"
                  >
                    {t("New project rule")}
                  </button>
                </div>
                {ruleError ? <div className="mt-1.5 px-1 text-ui-sm text-red">{ruleError}</div> : null}
              </div>
              {rules.length ? (
                <div className="mt-4 flex min-h-0 flex-1 flex-col px-8">
                  <PluginsView plugins={rules} loading={loading} onToggle={onToggle} onDelete={onDelete} onOpen={onOpen} />
                </div>
              ) : (
                <div className="px-8 pt-6">
                  <div className="rounded-card border border-dashed border-line-strong px-6 py-12 text-center text-ui-caption text-ink-3">
                    {t("No rules yet")}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* the bundled picks: extensions and skills this app ships, one
                  click each — the onboarding checklist, available forever */}
              <BundledPicks kind={tab === "skills" ? "skill" : "extension"} onRefresh={onRefresh} />
              <PluginsView
                plugins={tab === "skills" ? skills : extensions}
                loading={loading}
                onToggle={onToggle}
                onDelete={onDelete}
                onOpen={onOpen}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

const PICK_ICON: Record<string, React.ReactNode> = {
  "skill:browser-design": <SparkIcon size={16} />,
  "skill:browser-ops": <GlobeIcon size={16} />,
  "skill:plan-with-tasks": <ListIcon size={16} />,
  "extension:plan-mode": <ListChecksIcon size={16} />,
  "extension:agent-team": <LayersIcon size={16} />,
};

/**
 * The bundled catalogue as always-available one-click installs.
 *
 * Extensions live in the onboarding checklist and nowhere else, so a machine
 * onboarded before an extension shipped had no way to add it later — this is
 * that path, permanent. Installing and removing run through the same catalogue
 * writer the welcome screen uses, so a removal here also records the "do not
 * reinstall" marker the startup sync respects.
 */
function BundledPicks({ kind, onRefresh }: { kind: "extension" | "skill"; onRefresh: () => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      window.pi.getCatalog().then((catalog) => {
        if (!cancelled) setItems(catalog.filter((item) => item.kind === kind));
      });
    void load();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const apply = async (item: CatalogItem) => {
    setBusyId(item.id);
    try {
      /* the wanted set is everything currently installed plus this toggle —
         the capabilities ride along so their flags are never clobbered */
      const wanted = new Set(items.filter((entry) => entry.installed).map((entry) => entry.id));
      if (wanted.has(item.id)) wanted.delete(item.id);
      else wanted.add(item.id);
      await window.pi.applyCatalog([...wanted]);
      onRefresh();
      const catalog = await window.pi.getCatalog();
      setItems(catalog.filter((entry) => entry.kind === kind));
    } catch {
      /* the row keeps its previous state; the error surfaces on rescan */
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) return null;

  return (
    <div className="shrink-0 px-8 pt-8">
      <div className="mb-2 flex items-baseline gap-2 px-0.5">
        <h2 className="text-ui-caption font-medium text-ink">{t("Recommended")}</h2>
        <span className="text-ui-sm text-ink-3">{t("bundled with this app — one click to install")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-card bg-surface p-3 shadow-hairline"
            style={{ animation: `fade-up 420ms var(--ease-out-strong-css) ${index * 45}ms both` }}
          >
            <span className="mt-px shrink-0 text-ink-3">{PICK_ICON[item.id] ?? <SparkIcon size={16} />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-ui-caption font-medium text-ink">{item.name}</span>
                {item.installed ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-flex h-4.5 items-center rounded-full bg-green-tint px-1.5 text-ui-xs text-green">
                      {t("Installed")}
                    </span>
                    {item.kind === "capability" ? (
                      <span className="inline-flex h-4.5 items-center rounded-full bg-accent-tint px-1.5 text-ui-xs text-accent-ink">
                        {t("Built in")}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-ui-sm leading-snug text-ink-3">{item.description}</span>
            </span>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => void apply(item)}
              className={cn(
                "pressable h-7 shrink-0 rounded-chip px-2.5 text-ui-sm font-medium disabled:opacity-40",
                item.installed
                  ? "border border-line bg-page text-ink-2 hover:bg-hover hover:text-ink"
                  : "bg-ink text-canvas",
              )}
            >
              {item.installed ? t("Uninstall") : t("Install")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
