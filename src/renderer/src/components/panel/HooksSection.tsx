import { useCallback, useEffect, useState } from "react";
import type { PluginInfo, PluginRoots } from "@shared/types";
import { cn } from "../../lib/cn";
import { t, tf, useLocale } from "../../lib/i18n";
import { Card, Chip, EmptyState } from "../ui";
import { FolderOpenIcon, RefreshIcon } from "../icons";
import { Row, Section, Switch } from "./SettingsParts";

/**
 * 钩子 — the extension event stream.
 *
 * Pi has no separate hook format: a hook is an extension module that calls
 * `pi.on(event, handler)`. So this section is the list of modules that can
 * carry those subscriptions, plus the catalogue of events they may subscribe
 * to. Everything here reads and writes the files the Pi CLI already uses; the
 * shell stores no hook state of its own.
 */

type EventSpec = { name: string; hint: string; block?: boolean };
type EventGroup = { label: string; events: EventSpec[] };

const EVENT_GROUPS: EventGroup[] = [
  {
    label: "Agent lifecycle",
    events: [
      { name: "session_start", hint: "a session has opened" },
      { name: "session_shutdown", hint: "the session is closing" },
      { name: "project_trust", hint: "ask whether this folder may be trusted" },
      { name: "resources_discover", hint: "skills, prompts and extensions were scanned" },
      { name: "before_agent_start", hint: "the agent is about to run" },
      { name: "agent_start", hint: "a run began" },
      { name: "agent_end", hint: "a run finished" },
      { name: "agent_settled", hint: "nothing is pending any more" },
      { name: "turn_start", hint: "one model turn begins" },
      { name: "turn_end", hint: "one model turn ended" },
    ],
  },
  {
    label: "Tools",
    events: [
      { name: "tool_call", hint: "a tool is about to run", block: true },
      { name: "tool_result", hint: "rewrite what a tool returned" },
      { name: "tool_execution_start", hint: "progress shown in the transcript" },
      { name: "tool_execution_end", hint: "that tool call ended" },
      { name: "user_bash", hint: "a `!` command typed in the composer" },
    ],
  },
  {
    label: "Provider requests",
    events: [
      { name: "context", hint: "the context is assembled before the request" },
      { name: "before_provider_headers", hint: "add or change request headers" },
      { name: "before_provider_request", hint: "the payload on its way out" },
      { name: "after_provider_response", hint: "what came back" },
      { name: "message_start", hint: "a message begins streaming" },
      { name: "message_update", hint: "each streamed chunk" },
      { name: "message_end", hint: "the message is complete" },
      { name: "model_select", hint: "the model changed" },
      { name: "thinking_level_select", hint: "the thinking level changed" },
    ],
  },
  {
    label: "Interaction",
    events: [{ name: "input", hint: "a prompt is about to be sent", block: true }],
  },
];

const SCOPE_LABEL: Record<PluginInfo["scope"], string> = {
  global: "Global",
  project: "Project",
  configured: "Configured",
};

export function HooksSection() {
  useLocale();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [roots, setRoots] = useState<PluginRoots | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [found, folders] = await Promise.all([window.pi.getPlugins(), window.pi.getPluginRoots()]);
      setPlugins(found);
      setRoots(folders);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (plugin: PluginInfo, enabled: boolean) => {
    setPlugins(await window.pi.setPluginEnabled(plugin.path, plugin.kind, enabled));
  };

  const hooks = plugins.filter((plugin) => plugin.kind === "extension" || plugin.kind === "package");

  return (
    /* the page's title and its note come from the settings page */
    <div className="flex flex-col gap-5">

      <Section
        title={t("Installed hooks")}
        index={0}
        actions={
          <div className="flex shrink-0 items-center gap-1.5">
            <Chip
              onClick={() => roots && void window.pi.openPath(roots.globalExtensions)}
              disabled={!roots}
              title={roots?.globalExtensionsLabel}
            >
              <FolderOpenIcon size={12} />
              {t("Open the extensions folder")}
            </Chip>
            <Chip onClick={() => void load()}>
              <RefreshIcon size={12} />
              {t("Refresh")}
            </Chip>
          </div>
        }
      >
        {!hooks.length && !loading ? (
          <div className="px-4 py-4">
            <EmptyState
              title={t("No hooks installed")}
              body={t("Drop a .ts file in ~/.pi/agent/extensions, or .pi/extensions inside this project, and reload.")}
            />
          </div>
        ) : null}
        {hooks.map((plugin) => (
          <Row
            key={plugin.id}
            title={
              <span className="flex items-center gap-2">
                <span className={cn("truncate", !plugin.enabled && "text-ink-3 line-through")}>{plugin.name}</span>
                <span className="shrink-0 rounded-tiny bg-hover-2 px-1 text-ui-xs text-ink-3">
                  {t(SCOPE_LABEL[plugin.scope])}
                </span>
                {plugin.error ? (
                  <span className="shrink-0 rounded-tiny bg-red-tint px-1 text-ui-xs text-red">
                    {t(plugin.error)}
                  </span>
                ) : null}
              </span>
            }
            hint={plugin.description ?? plugin.path}
          >
            <span className="font-mono text-ui-xs text-ink-3">
              {plugin.kind === "package" ? "package" : "pi.on(…)"}
            </span>
            <button
              type="button"
              aria-label={t("Reveal in explorer")}
              title={plugin.path}
              onClick={() => void window.pi.showItem(plugin.path)}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover-2 hover:text-ink"
            >
              <FolderOpenIcon size={13} />
            </button>
            {plugin.toggleable ? (
              <Switch on={plugin.enabled} onClick={() => void toggle(plugin, !plugin.enabled)} />
            ) : (
              <span className="text-ui-xs text-ink-3">{t("not toggleable")}</span>
            )}
          </Row>
        ))}
      </Section>

      {/* a settings group: the heading over its card */}
      <section className="flex flex-col">
      <h2 className="pb-2 pl-2 text-ui-caption font-medium text-ink-2">{t("Hook events")}</h2>
      <Card index={1} className="overflow-hidden">
        <div className="flex flex-col gap-4 px-3.5 py-3">
          {EVENT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 text-ui-meta font-medium text-ink-2">
                {t(group.label)}
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {group.events.map((event) => (
                  <div key={event.name} className="flex items-baseline gap-2">
                    <code className="shrink-0 font-mono text-ui-sm text-ink">{event.name}</code>
                    <span className="min-w-0 flex-1 truncate text-ui-sm text-ink-3" title={t(event.hint)}>
                      {t(event.hint)}
                    </span>
                    {event.block ? (
                      <span className="shrink-0 rounded-tiny bg-orange-tint px-1 text-ui-xs text-orange">
                        {t("Can block the call")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      </section>

      <p className="px-1 text-ui-sm leading-relaxed text-ink-3">
        {roots
          ? tf("Hooks are loaded from {folders} and run with the agent's own permissions.", {
              folders: `${roots.globalExtensionsLabel} · ${roots.projectExtensionsLabel}`,
            })
          : t("Drop a .ts file in ~/.pi/agent/extensions, or .pi/extensions inside this project, and reload.")}
      </p>
    </div>
  );
}
