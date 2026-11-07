import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpConfigView, McpExposure, McpScope, McpServerConfig, McpServerView } from "@shared/mcp";
import { MCP_EXPOSURES, validateMcpServerConfig } from "@shared/mcp";
import type { RuntimeSettings } from "@shared/types";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import { Chip, EmptyState, Skeleton } from "../components/ui";
import { CheckIcon, HookIcon, PlusIcon, RefreshIcon, TrashIcon } from "../components/icons";

/**
 * MCP servers.
 *
 * The entries live in `mcp.json` — the agent directory's and the project's — and
 * the session reads them through pi's own MCP extension. This screen is the
 * editor for that file: add, change, enable, disable, remove, and sign in. It
 * reads the files directly rather than asking the session, so an entry pi will
 * not load (disabled, mistyped, or in a project pi does not trust yet) is still
 * visible and fixable here.
 *
 * Connection state is read off the session's tool names: a server whose tools
 * registered is `mcp__<name>__…`, so "connected" means the same thing to this
 * screen as it does to the model.
 */

type Draft = {
  name: string;
  scope: McpScope;
  kind: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  description: string;
  timeout: string;
  exposure: McpExposure;
  enabled: boolean;
};

const NEW = "__new__";

/** One line per argument. */
function linesToArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `KEY=VALUE` per line, for `env` and `headers`. */
function linesToPairs(text: string): Record<string, string> | undefined {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    pairs[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return Object.keys(pairs).length ? pairs : undefined;
}

function pairsToLines(pairs?: Record<string, string>): string {
  return pairs ? Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join("\n") : "";
}

function draftFrom(server: McpServerView): Draft {
  const config = server.config as unknown as Record<string, unknown>;
  const stdio = typeof config.command === "string";
  return {
    name: server.name,
    scope: server.scope,
    kind: stdio ? "stdio" : "http",
    command: typeof config.command === "string" ? config.command : "",
    args: Array.isArray(config.args) ? (config.args as string[]).join("\n") : "",
    env: pairsToLines(config.env as Record<string, string> | undefined),
    url: typeof config.url === "string" ? config.url : "",
    headers: pairsToLines(config.headers as Record<string, string> | undefined),
    description: typeof config.description === "string" ? config.description : "",
    timeout: typeof config.timeout === "number" ? String(config.timeout) : "",
    exposure: server.exposure,
    enabled: server.enabled,
  };
}

const emptyDraft = (): Draft => ({
  name: "",
  scope: "global",
  kind: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  description: "",
  timeout: "",
  exposure: "codemode",
  enabled: true,
});

/**
 * The form's fields as a config entry.
 *
 * Keys the form does not model — `oauth`, `toolExposure`, `cwd` — are carried
 * over from what is already in the file, so opening a server here and saving it
 * never strips a setting that was written by hand. Empty fields are left out
 * entirely; the main process strips keys that only mean the default.
 */
function toConfig(draft: Draft, previous?: McpServerConfig): McpServerConfig {
  const next: Record<string, unknown> = { ...(previous as unknown as Record<string, unknown> | undefined) };
  next.type = draft.kind;
  delete next.command;
  delete next.args;
  delete next.env;
  delete next.url;
  delete next.headers;
  if (draft.kind === "stdio") {
    next.command = draft.command.trim();
    const args = linesToArgs(draft.args);
    if (args.length) next.args = args;
    const env = linesToPairs(draft.env);
    if (env) next.env = env;
  } else {
    next.url = draft.url.trim();
    const headers = linesToPairs(draft.headers);
    if (headers) next.headers = headers;
  }
  next.description = draft.description.trim();
  const timeout = Number(draft.timeout);
  next.timeout = draft.timeout.trim() && Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;
  next.exposure = draft.exposure;
  next.enabled = draft.enabled;
  return next as unknown as McpServerConfig;
}

/** pi spells a server's namespace by replacing everything but `[A-Za-z0-9_]`. */
const namespaceOf = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * The tool pi ships as an extension rather than as a built-in.
 *
 * It is registered inactive, so `defaultTools` is the switch: `+name` adds it
 * to the default set, `-name` vetoes it. A `codemode` MCP server turns it on
 * by itself, which is why the veto exists at all.
 */
const TOOL_SWITCHES: Array<{ tool: string; hint: string }> = [
  { tool: "codemode", hint: "codemode — the model writes one script that calls tools in a single turn" },
];

function toolEnabled(list: string[] | undefined, tool: string): boolean {
  const entries = list ?? [];
  if (entries.includes(`-${tool}`)) return false;
  return entries.includes(tool) || entries.includes(`+${tool}`);
}

function setTool(list: string[] | undefined, tool: string, on: boolean): string[] {
  const before = list ?? [];
  const mentioned = before.some((entry) => entry === tool || entry === `+${tool}`);
  const rest = before.filter((entry) => entry !== tool && entry !== `+${tool}` && entry !== `-${tool}`);
  if (on) return [...rest, `+${tool}`];
  /* Turning off a tool nobody mentioned would leave a `-codemode` line in the
     settings file for a switch that was never on — record the veto only when
     there was something to veto. */
  return mentioned ? [...rest, `-${tool}`] : rest;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ui-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-ui-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

const inputClass = "h-7 w-full rounded-control bg-field px-2 font-mono text-ui-caption text-ink outline-none";

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn("pressable relative h-[18px] w-8 shrink-0 rounded-full", on ? "bg-green" : "bg-line-strong")}
      style={{ transition: "background-color 200ms ease-out" }}
    >
      <span
        className="absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow"
        style={{ transform: on ? "translateX(14px)" : "translateX(0)", transition: "transform 240ms var(--ease-out-strong-css)" }}
      />
    </button>
  );
}

export function McpView({
  settings,
  onUpdateSettings,
}: {
  settings: RuntimeSettings;
  onUpdateSettings: (patch: Partial<RuntimeSettings>) => void;
}) {
  const [config, setConfig] = useState<McpConfigView | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const isNew = selected === NEW;

  const load = useCallback(async () => {
    try {
      const [next, live] = await Promise.all([window.pi.getMcpConfig(), window.pi.getMcpConnected()]);
      setConfig(next);
      setConnected(live);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const servers = config?.servers ?? [];
  const selectedServer = useMemo(
    () => servers.find((server) => server.name === selected) ?? null,
    [servers, selected],
  );

  const run = async (action: () => Promise<McpConfigView>) => {
    setBusy(true);
    setError(null);
    try {
      setConfig(await action());
      setConnected(await window.pi.getMcpConnected());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (server: McpServerView) => {
    setNotice(null);
    if (selected === server.name) {
      setSelected(null);
      setDraft(null);
      return;
    }
    setSelected(server.name);
    setDraft(draftFrom(server));
  };

  const startNew = () => {
    setNotice(null);
    setSelected(NEW);
    setDraft(emptyDraft());
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError(t("A server name is required."));
      return;
    }
    if (draft.kind === "stdio" && !draft.command.trim()) {
      setError(t("A stdio server needs a command."));
      return;
    }
    if (draft.kind === "http" && !draft.url.trim()) {
      setError(t("An HTTP server needs a URL."));
      return;
    }
    /* The same rules pi will apply when it loads the file, run here so an
     * invalid entry fails beside the field instead of as a failed save. The
     * main process validates again — this is feedback, not the gate. */
    const previous = isNew ? undefined : selectedServer?.config;
    const candidate = toConfig(draft, previous);
    const invalid = validateMcpServerConfig(name, candidate);
    if (typeof invalid === "string") {
      setError(invalid);
      return;
    }
    /* Editing a server keeps it in the file that defines it; a new one goes
     * where the form says. Writing a project entry over a global one would move
     * the credential into the repository. */
    const scope = isNew ? draft.scope : (selectedServer?.scope ?? draft.scope);
    setBusy(true);
    setError(null);
    try {
      setConfig(await window.pi.writeMcpServer(scope, name, candidate));
      setConnected(await window.pi.getMcpConnected());
      setNotice(tf("Saved {name}", { name }));
      setSelected(name);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (server: McpServerView) => {
    setConfirming(null);
    setSelected(null);
    setDraft(null);
    await run(() => window.pi.removeMcpServer(server.scope, server.name));
  };

  const signIn = async (server: McpServerView, command: "login" | "logout" | "reconnect") => {
    setError(null);
    setNotice(tf("Running /mcp {command} {name}…", { command, name: server.name }));
    try {
      await window.pi.mcpCommand(command, server.name);
      setNotice(tf("{name}: {command} finished", { name: server.name, command }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await load();
    }
  };

  const statusOf = (server: McpServerView): { label: string; tone: "green" | "ink" | "orange" } => {
    if (!server.enabled) return { label: t("Disabled"), tone: "ink" };
    if (connected.includes(namespaceOf(server.name))) return { label: t("Connected"), tone: "green" };
    return { label: t("Not connected"), tone: "orange" };
  };

  if (!config) {
    return (
      <div className="flex flex-col gap-3 p-8">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <span className="shrink-0 text-ui-caption font-medium text-ink-2">
          {tf("{count} servers", { count: servers.length })}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-xs text-ink-3">
          {t("tools reach the model as mcp__server__tool")}
        </span>
        <Chip onClick={() => void load()} title={t("Reload")}>
          <RefreshIcon size={12} />
          {t("Reload")}
        </Chip>
        <Chip onClick={startNew} title={t("Add an MCP server")}>
          <PlusIcon size={12} />
          {t("Add server")}
        </Chip>
      </div>

      {config.errors.length ? (
        <div className="shrink-0 border-b border-line bg-orange-tint px-6 py-2 text-ui-caption text-orange">
          {config.errors.map((line) => (
            <div key={line} className="truncate font-mono text-ui-xs">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {error || notice ? (
        <div
          className={cn(
            "shrink-0 border-b border-line px-6 py-2 text-ui-caption",
            error ? "bg-red-tint text-red" : "bg-inset text-ink-3",
          )}
        >
          {error ?? notice}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
          {servers.length === 0 ? (
            <EmptyState
              title={t("No MCP servers yet")}
              body={t("Add one here, or drop an mcpServers entry into ~/.pi/agent/mcp.json.")}
            />
          ) : (
            servers.map((server) => {
              const status = statusOf(server);
              const raw = server.config as unknown as Record<string, unknown>;
              const where = typeof raw.command === "string" ? (raw.command as string) : String(raw.url ?? "");
              return (
                <div
                  key={`${server.scope}:${server.name}`}
                  className={cn(
                    "flex items-center gap-3 rounded-card p-3 shadow-card",
                    selected === server.name ? "bg-accent-tint" : "bg-surface hover:bg-hover",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openEditor(server)}
                    className="pressable-soft pressable flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-ui-caption font-medium text-ink">{server.name}</span>
                      <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-ui-xs text-ink-3">
                        {server.scope}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded-chip px-1.5 text-ui-xs",
                          status.tone === "green"
                            ? "bg-green-tint text-green"
                            : status.tone === "orange"
                              ? "bg-orange-tint text-orange"
                              : "bg-field text-ink-3",
                        )}
                      >
                        {status.label}
                      </span>
                      <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 text-ui-xs text-ink-3">
                        {server.exposure}
                      </span>
                    </span>
                    <span className="w-full truncate font-mono text-ui-xs text-ink-3">{where}</span>
                  </button>
                  <Switch
                    on={server.enabled}
                    label={server.name}
                    onClick={() => void run(() => window.pi.patchMcpServer(server.scope, server.name, { enabled: !server.enabled }))}
                  />
                  {confirming === server.name ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void remove(server)}
                        className="pressable inline-flex h-7 items-center rounded-chip bg-red px-2.5 text-ui-sm text-white"
                      >
                        {t("Remove")}
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
                      onClick={() => setConfirming(server.name)}
                      className="pressable flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3 hover:bg-red-tint hover:text-red"
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {draft ? (
          <aside className="animate-slide-in-right scrollbar-thin w-[340px] shrink-0 overflow-y-auto border-l border-line bg-canvas p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-caption font-medium text-ink">
                  {isNew ? t("New MCP server") : draft.name}
                </div>
                <div className="font-mono text-ui-xs text-ink-3">
                  {isNew ? t("written to mcp.json") : (selectedServer?.file ?? "")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setDraft(null);
                }}
                className="pressable rounded-chip px-1.5 py-0.5 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink"
              >
                {t("Close")}
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              <Field label={t("Name")} hint={t("letters, digits, _ and - only")}>
                <input
                  value={draft.name}
                  disabled={!isNew}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="filesystem"
                  className={cn(inputClass, !isNew && "opacity-60")}
                />
              </Field>

              {isNew ? (
                <Field label={t("Scope")} hint={t("global servers are yours; project servers travel with the checkout")}>
                  <div className="flex gap-1.5">
                    {(["global", "project"] as McpScope[]).map((scope) => (
                      <Chip key={scope} active={draft.scope === scope} onClick={() => setDraft({ ...draft, scope })}>
                        {t(scope === "global" ? "Global" : "Project")}
                      </Chip>
                    ))}
                  </div>
                </Field>
              ) : null}

              <Field label={t("Connection")}>
                <div className="flex gap-1.5">
                  <Chip active={draft.kind === "stdio"} onClick={() => setDraft({ ...draft, kind: "stdio" })}>
                    {t("stdio")}
                  </Chip>
                  <Chip active={draft.kind === "http"} onClick={() => setDraft({ ...draft, kind: "http" })}>
                    {t("HTTP")}
                  </Chip>
                </div>
              </Field>

              {draft.kind === "stdio" ? (
                <>
                  <Field label={t("Command")} hint={t("one executable, not a shell line")}>
                    <input
                      value={draft.command}
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                      placeholder="npx"
                      className={inputClass}
                    />
                  </Field>
                  <Field label={t("Arguments")} hint={t("one per line")}>
                    <textarea
                      value={draft.args}
                      onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                      className="scrollbar-thin h-24 w-full resize-none rounded-control bg-field p-2 font-mono text-ui-xs text-ink outline-none"
                    />
                  </Field>
                  <Field label={t("Environment")} hint={t("KEY=VALUE per line, ${VAR} is expanded")}>
                    <textarea
                      value={draft.env}
                      onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                      placeholder="API_KEY=${TOOLS_KEY}"
                      className="scrollbar-thin h-16 w-full resize-none rounded-control bg-field p-2 font-mono text-ui-xs text-ink outline-none"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="URL">
                    <input
                      value={draft.url}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      placeholder="https://mcp.sentry.dev/mcp"
                      className={inputClass}
                    />
                  </Field>
                  <Field label={t("Headers")} hint={t("KEY=VALUE per line, ${VAR} is expanded")}>
                    <textarea
                      value={draft.headers}
                      onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                      placeholder="Authorization=Bearer ${DOCS_TOKEN}"
                      className="scrollbar-thin h-16 w-full resize-none rounded-control bg-field p-2 font-mono text-ui-xs text-ink outline-none"
                    />
                  </Field>
                </>
              )}

              <Field label={t("Description")} hint={t("one sentence — it lists the server in the system prompt")}>
                <input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  className="h-7 w-full rounded-control bg-field px-2 text-ui-caption text-ink outline-none"
                />
              </Field>

              <Field label={t("Tool exposure")}>
                <select
                  value={draft.exposure}
                  onChange={(event) => setDraft({ ...draft, exposure: event.target.value as McpExposure })}
                  className="h-7 w-full rounded-control bg-field px-2 text-ui-caption text-ink outline-none"
                >
                  {MCP_EXPOSURES.map((exposure) => (
                    <option key={exposure} value={exposure}>
                      {exposure}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="-mt-1.5 text-ui-xs leading-relaxed text-ink-3">
                {t(
                  "codemode keeps the tools out of the model's declarations and lets scripts call them; direct declares them right away; hidden makes them unreachable.",
                )}
              </p>

              <div className="flex items-center justify-between rounded-control bg-surface px-2.5 py-2 shadow-hairline">
                <div>
                  <div className="text-ui-caption text-ink">{t("Enabled")}</div>
                  <div className="text-ui-xs text-ink-3">{t("a disabled server stays in the file")}</div>
                </div>
                <Switch on={draft.enabled} label={t("Enabled")} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} />
              </div>

              <Field label={t("Timeout")} hint={t("seconds per request, default 60")}>
                <input
                  value={draft.timeout}
                  onChange={(event) => setDraft({ ...draft, timeout: event.target.value })}
                  placeholder="60"
                  className={inputClass}
                />
              </Field>

              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="pressable-soft pressable flex h-7 items-center justify-center gap-1.5 rounded-control bg-ink text-ui-caption font-medium text-canvas disabled:opacity-40"
                >
                  <CheckIcon size={12} />
                  {isNew ? t("Add server") : t("Save")}
                </button>
                {!isNew && selectedServer ? (
                  <>
                    {draft.kind === "http" ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void signIn(selectedServer, "login")}
                          className="pressable-soft pressable flex h-7 items-center justify-center gap-1.5 rounded-control bg-surface text-ui-caption text-ink shadow-btn hover:bg-inset disabled:opacity-40"
                        >
                          <HookIcon size={12} />
                          {t("Sign in")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void signIn(selectedServer, "logout")}
                          className="pressable-soft pressable h-7 rounded-control bg-surface text-ui-caption text-ink-2 shadow-btn hover:bg-inset disabled:opacity-40"
                        >
                          {t("Sign out")}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void signIn(selectedServer, "reconnect")}
                      className="pressable-soft pressable h-7 rounded-control bg-surface text-ui-caption text-ink-2 shadow-btn hover:bg-inset disabled:opacity-40"
                    >
                      {t("Reconnect")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </aside>
        ) : (
          <aside className="scrollbar-thin w-[340px] shrink-0 space-y-3 overflow-y-auto border-l border-line bg-canvas p-4">
            <div className="rounded-card bg-surface p-3 shadow-hairline">
              <div className="text-ui-caption font-medium text-ink">{t("Tool extensions")}</div>
              <div className="mt-2 flex flex-col gap-2.5">
                {TOOL_SWITCHES.map((entry) => {
                  const on = toolEnabled(settings.defaultTools, entry.tool);
                  return (
                    <div key={entry.tool} className="flex items-start gap-2.5">
                      <span className="mt-0.5">
                        <Switch
                          on={on}
                          label={entry.tool}
                          onClick={() => onUpdateSettings({ defaultTools: setTool(settings.defaultTools, entry.tool, !on) })}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-ui-caption text-ink">{entry.tool}</span>
                        <span className="block text-ui-xs leading-snug text-ink-3">{t(entry.hint)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2.5 text-ui-xs leading-relaxed text-ink-3">
                {t(
                  "A server with codemode exposure switches it on by itself; turning it off here records an explicit veto.",
                )}
              </p>
            </div>
            <div className="rounded-card bg-surface p-3 shadow-hairline">
              <div className="text-ui-caption font-medium text-ink">{t("How servers reach the model")}</div>
              <p className="mt-1.5 text-ui-xs leading-relaxed text-ink-3">
                {t(
                  "Servers come from ~/.pi/agent/mcp.json and, in a trusted project, .pi/mcp.json. A project entry replaces a global one with the same name. Tools are named mcp__server__tool and every call runs through the same permission pipeline as a built-in tool.",
                )}
              </p>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
