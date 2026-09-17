import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ExtensionAPI,
  AgentSession,
  AgentSessionRuntime,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type {
  ChatMessage,
  ContextBreakdown,
  ContextPart,
  HostState,
  ModelEdit,
  ModelInfo,
  PluginInfo,
  PromptPayload,
  RuntimeSettings,
  DesktopConfig,
  SlashCommand,
  ToolActivity,
} from "@shared/types";
import type { TerminalResult } from "@shared/workspace";
import { readModelsFile, removeModelFromFile, writeModelEdit } from "./model-config";
import { deletePlugin, listPlugins, setPluginEnabled } from "./plugins";
import { serializeMessage, serializeMessages, serializeModel, serializeSessionList, thinkingLevelsFor } from "./serialize";
import { registerBrowserTools } from "./browser-extension";
import { EMPTY_TODOS, registerTodoTools, type TodoState } from "./todo-extension";
import { readConfig } from "./install";
import { UiBridge } from "./ui-bridge";
import type { UiAnswer, UiNotification, UiRequest } from "@shared/ui";
import type { BrowserHost } from "./browser";

export type HostListener = (payload: {
  state: HostState;
  messages: ChatMessage[];
  tools: ToolActivity[];
  uiRequest?: UiRequest | null;
  notifications?: UiNotification[];
}) => void;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface ProviderLike {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
}

function availableThinkingLevels(model: { reasoning: boolean; thinkingLevelMap?: Record<string, string | null> }): string[] {
  return thinkingLevelsFor({
    id: "",
    name: "",
    provider: "",
    contextWindow: 0,
    maxTokens: 0,
    ...model,
  });
}

export class PiHost {
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private listener: HostListener | null = null;
  private cwd: string;
  private agentDir = getAgentDir();
  private sessions: HostState["sessions"] = [];
  private models: ModelInfo[] = [];
  private commands: SlashCommand[] = [];
  private tools = new Map<string, ToolActivity>();
  private connected = false;
  private error?: string;
  private starting: Promise<void> | null = null;
  private settingsManager: SettingsManager;
  private todos: TodoState = EMPTY_TODOS;
  private desktop: DesktopConfig | null = null;
  readonly ui = new UiBridge((request, notifications) => this.listener?.({ state: this.buildState(), messages: this.messages(), tools: this.toolActivity(), uiRequest: request, notifications }));

  constructor(cwd: string, private readonly getBrowser: () => BrowserHost | null = () => null) {
    this.cwd = cwd;
    this.settingsManager = SettingsManager.create(cwd, this.agentDir);
  }

  onChange(listener: HostListener): void {
    this.listener = listener;
  }

  getCwd(): string {
    return this.cwd;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }
    this.connected = false;
  }

  async setCwd(cwd: string): Promise<void> {
    if (cwd === this.cwd && this.runtime) return;
    this.cwd = cwd;
    await this.dispose();
    this.settingsManager = SettingsManager.create(cwd, this.agentDir);
    await this.start();
  }

  async prompt(payload: PromptPayload): Promise<void> {
    const session = this.requireSession();
    const text = payload.text.trim();
    if (!text) return;
    const options = payload.images?.length ? { images: payload.images as never } : undefined;
    if (session.isStreaming) {
      const behavior = payload.streamingBehavior ?? "followUp";
      if (behavior === "steer") await session.steer(text, options?.images);
      else await session.followUp(text, options?.images);
      return;
    }
    await session.prompt(text, options);
  }

  async abort(): Promise<void> {
    await this.requireSession().abort();
    this.emit();
  }

  /**
   * Run a shell command through the agent's own bash tool.
   *
   * This deliberately goes through `session.executeBash` rather than spawning a
   * PTY: the output is streamed to the panel *and* recorded in the session, so
   * the next prompt already knows what the command printed. Same shell, same
   * config, same context the agent sees.
   */
  async runBash(command: string, onChunk: (delta: string) => void): Promise<TerminalResult> {
    const session = this.requireSession();
    const runId = `run-${Date.now().toString(36)}`;
    const startedAt = Date.now();
    try {
      const result = await session.executeBash(command, (chunk) => onChunk(chunk), { id: runId });
      return {
        runId,
        command,
        output: result.output ?? "",
        exitCode: result.exitCode,
        cancelled: Boolean(result.cancelled),
        truncated: Boolean(result.truncated),
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.emit();
    }
  }

  abortBash(): void {
    this.requireSession().abortBash();
  }

  bashState(): { running: boolean; command?: string } {
    const session = this.runtime?.session;
    return { running: Boolean(session?.isBashRunning) };
  }

  async newSession(): Promise<void> {
    await this.requireRuntime().newSession();
    this.todos = EMPTY_TODOS;
    this.tools.clear();
    await this.bindSession();
    await this.refreshSessions();
    this.emit();
  }

  async switchSession(sessionPath: string): Promise<void> {
    const result = await this.requireRuntime().switchSession(sessionPath);
    if (result.cancelled) return;
    this.restoreTodos();
    this.tools.clear();
    await this.bindSession();
    await this.refreshSessions();
    this.emit();
  }

  /** The prompts this session can be branched from, oldest first. */
  forkTargets(): { entryId: string; text: string }[] {
    try {
      return this.requireSession()
        .getUserMessagesForForking()
        .map((item) => ({ entryId: item.entryId, text: item.text.slice(0, 120) }));
    } catch {
      return [];
    }
  }

  /**
   * Branch the conversation from the prompt at `index`.
   *
   * Forking writes a new session file rather than editing the current one, so
   * the original transcript survives and the app switches to the branch.
   */
  async forkAt(index: number): Promise<{ cancelled: boolean }> {
    const target = this.forkTargets()[index];
    if (!target) throw new Error("No prompt to fork from at that position.");
    const result = await this.requireRuntime().fork(target.entryId);
    if (result.cancelled) return { cancelled: true };
    this.todos = EMPTY_TODOS;
    this.tools.clear();
    await this.bindSession();
    await this.refreshSessions();
    this.restoreTodos();
    this.emit();
    return { cancelled: false };
  }

  /** What is queued right now, plus the delivery modes. */
  queueState(): HostState["queue"] {
    const session = this.runtime?.session;
    return {
      steering: [...(session?.getSteeringMessages() ?? [])],
      followUp: [...(session?.getFollowUpMessages() ?? [])],
      steeringMode: session?.steeringMode ?? "one-at-a-time",
      followUpMode: session?.followUpMode ?? "one-at-a-time",
    };
  }

  /** Queue a message that interrupts after the current tool batch. */
  async steer(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.requireSession().steer(trimmed);
    this.emit();
  }

  /** Queue a message delivered once the agent stops. */
  async followUp(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.requireSession().followUp(trimmed);
    this.emit();
  }

  /**
   * Drain the queue and hand the text back.
   *
   * pi only offers an all-or-nothing clear, so removing a single entry means
   * clearing and re-queueing the rest — which is also what makes "put it back
   * in the editor" possible.
   */
  clearQueue(): HostState["queue"] & { texts: string[] } {
    const session = this.requireSession();
    const { steering, followUp } = session.clearQueue();
    this.emit();
    return { ...this.queueState(), texts: [...steering, ...followUp] };
  }

  async removeQueued(kind: "steering" | "followUp", index: number): Promise<void> {
    const session = this.requireSession();
    const { steering, followUp } = session.clearQueue();
    const keep = kind === "steering" ? steering : followUp;
    const dropped = kind === "steering" ? followUp : steering;
    for (const text of dropped) await session.followUp(text);
    for (const [position, text] of keep.entries()) {
      if (position === index) continue;
      if (kind === "steering") await session.steer(text);
      else await session.followUp(text);
    }
    this.emit();
  }

  setQueueMode(kind: "steering" | "followUp", mode: "all" | "one-at-a-time"): void {
    const session = this.requireSession();
    if (kind === "steering") session.setSteeringMode(mode);
    else session.setFollowUpMode(mode);
    this.emit();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const session = this.requireSession();
    const model = session.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await session.setModel(model);
    this.emit();
  }

  async setThinkingLevel(level: string): Promise<void> {
    const session = this.requireSession();
    session.setThinkingLevel(level as never);
    const model = session.model;
    if (model) this.settingsManager.setModelThinkingLevel(model.provider, model.id, level as never);
    await this.settingsManager.flush();
    this.emit();
  }

  async setSessionName(name: string): Promise<void> {
    this.requireSession().setSessionName(name);
    await this.refreshSessions();
    this.emit();
  }

  async reload(): Promise<void> {
    await this.requireSession().reload();
    await this.refreshModels();
    await this.refreshCommands();
    this.emit();
  }

  async updateSettings(patch: Partial<RuntimeSettings>): Promise<void> {
    if (patch.blockImages !== undefined) this.settingsManager.setBlockImages(patch.blockImages);
    if (patch.imageAutoResize !== undefined) this.settingsManager.setImageAutoResize(patch.imageAutoResize);
    if (patch.showCacheMissNotices !== undefined) this.settingsManager.setShowCacheMissNotices(patch.showCacheMissNotices);
    if (patch.hideThinkingBlock !== undefined) this.settingsManager.setHideThinkingBlock(patch.hideThinkingBlock);
    if (patch.shellPath !== undefined) this.settingsManager.setShellPath(patch.shellPath || undefined);
    if (patch.shellCommandPrefix !== undefined) this.settingsManager.setShellCommandPrefix(patch.shellCommandPrefix || undefined);
    if (patch.npmCommand !== undefined) this.settingsManager.setNpmCommand(patch.npmCommand.length ? patch.npmCommand : undefined);
    if (patch.defaultThinkingLevel) this.settingsManager.setDefaultThinkingLevel(patch.defaultThinkingLevel as never);
    if (patch.defaultProvider && patch.defaultModel) {
      this.settingsManager.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
    }
    if (patch.modelThinkingLevels) {
      const current = this.settingsManager.getAllModelThinkingLevels() as Record<string, string>;
      for (const key of Object.keys(current)) {
        if (!(key in patch.modelThinkingLevels)) {
          const [provider, ...rest] = key.split("/");
          this.settingsManager.removeModelThinkingLevel(provider, rest.join("/"));
        }
      }
      for (const [key, level] of Object.entries(patch.modelThinkingLevels)) {
        const [provider, ...rest] = key.split("/");
        this.settingsManager.setModelThinkingLevel(provider, rest.join("/"), level as never);
      }
    }
    if (patch.thinkingBudgets) {
      const current = this.settingsManager.getThinkingBudgets() ?? {};
      this.settingsManager.applyOverrides({ thinkingBudgets: { ...current, ...patch.thinkingBudgets } });
    }
    if (patch.enabledModels) this.settingsManager.setEnabledModels(patch.enabledModels);
    await this.settingsManager.flush();
    const errors = this.settingsManager.drainErrors();
    if (errors.length) throw new Error(errors.map((entry) => entry.error.message).join("; "));
    await this.reload();
  }

  async saveModelEdit(edit: ModelEdit): Promise<void> {
    writeModelEdit(edit);
    await this.refreshModels();
    this.emit();
  }

  async deleteModel(provider: string, modelId: string): Promise<void> {
    removeModelFromFile(provider, modelId);
    await this.refreshModels();
    this.emit();
  }

  plugins(): PluginInfo[] {
    return listPlugins(this.cwd);
  }

  async setPluginEnabled(path: string, kind: PluginInfo["kind"], enabled: boolean): Promise<PluginInfo[]> {
    setPluginEnabled(path, kind, enabled);
    await this.reload();
    return this.plugins();
  }

  async deletePlugin(path: string, kind: PluginInfo["kind"]): Promise<PluginInfo[]> {
    deletePlugin(path, kind);
    await this.reload();
    return this.plugins();
  }

  /** Re-read the task list the agent last wrote in this session. */
  private restoreTodos(): void {
    try {
      const entries = this.runtime?.session.sessionManager.getEntries() ?? [];
      let latest: TodoState | undefined;
      for (const entry of entries) {
        const record = entry as { type?: string; customType?: string; data?: unknown };
        if (record.type !== "custom" || record.customType !== "todo-state") continue;
        latest = record.data as TodoState;
      }
      this.todos = latest ?? EMPTY_TODOS;
    } catch {
      this.todos = EMPTY_TODOS;
    }
  }

  /** Every session on disk, across all projects — the sidebar groups these into workspaces. */
  async allSessions(): Promise<HostState["sessions"]> {
    try {
      const listed = await SessionManager.listAll();
      return serializeSessionList(listed, this.runtime?.session?.sessionFile, false);
    } catch {
      return this.sessions;
    }
  }

  /** Delete all session files belonging to a workspace, removing it from history. */
  async deleteWorkspace(workspaceCwd: string): Promise<void> {
    const normalized = workspaceCwd.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    const all = await SessionManager.listAll();
    const matches = all.filter((s) => {
      const c = (s.cwd || "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
      return c === normalized;
    });
    const dirSet = new Set<string>();
    for (const s of matches) {
      if (s.path && existsSync(s.path)) {
        try {
          rmSync(s.path, { force: true });
        } catch {
          /* ignore deletion error */
        }
        dirSet.add(dirname(s.path));
      }
    }
    for (const dir of dirSet) {
      try {
        if (existsSync(dir) && readdirSync(dir).length === 0) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        /* ignore directory removal error */
      }
    }
    const currentNorm = this.cwd.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    if (currentNorm === normalized) {
      await this.newSession();
    }
    await this.refreshSessions();
    this.emit();
  }

  /** Tool names the session exposes — used to confirm extensions registered. */
  toolNames(): string[] {
    try {
      return this.runtime?.session.getAllTools().map((tool) => tool.name) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * What is occupying the context window.
   *
   * Every part is measured from the thing itself — the session's own system
   * prompt, each tool's name/description/JSON schema, the size of each skill
   * file — and converted to tokens with the same rough ratio, so the rows are
   * comparable with each other. These are estimates and the panel says so; the
   * exact per-part counts only exist inside the provider's request.
   */
  contextBreakdown(): ContextBreakdown {
    const session = this.runtime?.session;
    const parts: ContextPart[] = [];

    if (session) {
      try {
        const prompt = session.systemPrompt;
        if (prompt) {
          parts.push({
            key: "system",
            label: "System prompt",
            tokens: estimateTokens(prompt.length),
            detail: `${prompt.length.toLocaleString()} chars`,
          });
        }
      } catch {
        /* the session may not be able to build a prompt yet */
      }

      try {
        const tools = session.getAllTools();
        let chars = 0;
        for (const tool of tools) {
          chars += tool.name.length + (tool.description?.length ?? 0);
          for (const line of tool.promptGuidelines ?? []) chars += line.length;
          try {
            chars += JSON.stringify(tool.parameters ?? {}).length;
          } catch {
            /* an unserialisable schema still has a name and a description */
          }
        }
        parts.push({
          key: "tools",
          label: "Tool definitions",
          tokens: estimateTokens(chars),
          detail: `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
        });
      } catch {
        /* no session, no tools */
      }
    }

    const skills = this.plugins().filter((plugin) => plugin.kind === "skill");
    const skillBytes = skills.reduce((sum, skill) => sum + (skill.sizeBytes ?? 0), 0);
    if (skills.length) {
      parts.push({
        key: "skills",
        label: "Skills",
        tokens: estimateTokens(skillBytes),
        detail: `${skills.length} available`,
      });
    }

    const rules = this.plugins().filter((plugin) => plugin.kind === "prompt");
    const ruleBytes = rules.reduce((sum, rule) => sum + (rule.sizeBytes ?? 0), 0);
    if (rules.length) {
      parts.push({
        key: "templates",
        label: "Prompt templates",
        tokens: estimateTokens(ruleBytes),
        detail: `${rules.length} registered`,
      });
    }

    const usage = (() => {
      try {
        return session?.getSessionStats().contextUsage ?? null;
      } catch {
        return null;
      }
    })();

    return {
      parts,
      used: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? session?.model?.contextWindow ?? 0,
      percent: usage?.percent ?? null,
    };
  }

  snapshot(): HostState {
    return this.buildState();
  }

  private lastSerialized: { log: unknown; out: ChatMessage[] } | null = null;

  messages(): ChatMessage[] {
    const session = this.runtime?.session;
    if (!session) return [];
    /* The serialization cost of the whole log lives in this method, and the
     * host calls it on every emitted event — most of which change nothing in
     * the transcript. Identity-checking the message array plus the streaming
     * message makes every such emit a no-op. */
    /* the streaming message may be an unstable object — append it whenever it
     * is present (it is cheap: one message) and cache only the settled log */
    const log = session.messages;
    const stream = session.state.streamingMessage as unknown;
    if (!stream) {
      if (this.lastSerialized?.log === log) return this.lastSerialized.out;
      const out = serializeMessages(log, undefined);
      this.lastSerialized = { log, out };
      return out;
    }
    const settled =
      this.lastSerialized?.log === log
        ? this.lastSerialized.out
        : (this.lastSerialized = { log, out: serializeMessages(log, undefined) }).out;
    return [...settled, serializeMessage(stream, settled.length, true)];
  }

  toolActivity(): ToolActivity[] {
    return [...this.tools.values()];
  }

  private async boot(): Promise<void> {
    this.error = undefined;
    this.desktop = await readConfig();
    const agentDir = this.agentDir;
    const settingsManager = this.settingsManager;

    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager,
        // The browser tools are a pi extension, not an MCP server: the agent runs
        // in this process, so the tools call the embedded view directly.
        resourceLoaderOptions: {
          // capabilities the user enabled on the welcome screen
          extensionFactories: [
            ...(this.desktop?.capabilities.browser
              ? [
                  {
                    name: "pi-desktop-browser",
                    factory: (pi: ExtensionAPI) => registerBrowserTools(pi, this.getBrowser),
                  },
                ]
              : []),
            ...(this.desktop?.capabilities.todos
              ? [
                  {
                    name: "pi-desktop-todos",
                    factory: (pi: ExtensionAPI) =>
                      registerTodoTools(pi, {
                        initial: this.todos,
                        onChange: (state) => {
                          this.todos = state;
                          this.emit();
                        },
                      }),
                  },
                ]
              : []),
          ],
        },
      });
      return {
        ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    this.runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: this.cwd,
      agentDir,
      sessionManager: SessionManager.continueRecent(this.cwd),
    });

    this.connected = true;
    await this.bindSession();
    this.restoreTodos();
    await this.refreshSessions();
    await this.refreshModels();
    this.emit();
  }

  private async bindSession(): Promise<void> {
    this.unsubscribe?.();
    const session = this.requireSession();
    // route extension dialogs to the window; "rpc" marks them dialog-capable
    await session.bindExtensions({ mode: "rpc", uiContext: this.ui.context("extension") });
    this.unsubscribe = session.subscribe((event) => this.onEvent(event));
    this.refreshCommands();
  }

  private onEvent(event: AgentSessionEvent): void {
    if (event.type === "tool_execution_start") {
      this.tools.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: "running",
        startedAt: Date.now(),
      });
    }
    if (event.type === "tool_execution_update") {
      const current = this.tools.get(event.toolCallId);
      this.tools.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: "running",
        resultText: current?.resultText,
        details: current?.details,
        startedAt: current?.startedAt ?? Date.now(),
      });
    }
    if (event.type === "tool_execution_end") {
      const result = event.result as { content?: unknown; details?: unknown } | undefined;
      const current = this.tools.get(event.toolCallId);
      this.tools.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: current?.args,
        status: event.isError ? "error" : "done",
        resultText: summarizeToolResult(result),
        details: result?.details,
        startedAt: current?.startedAt ?? Date.now(),
        endedAt: Date.now(),
      });
    }
    if (event.type === "agent_settled") {
      for (const tool of this.tools.values()) {
        if (tool.status === "running") tool.status = "done";
      }
      void this.refreshSessions();
    }
    this.emit();
  }

  private async refreshSessions(): Promise<void> {
    const listed = await SessionManager.list(this.cwd);
    const session = this.runtime?.session;
    this.sessions = serializeSessionList(listed, session?.sessionFile, session?.isStreaming);
  }

  private async refreshModels(): Promise<void> {
    const session = this.runtime?.session;
    if (!session) {
      this.models = [];
      return;
    }
    const available = await session.modelRuntime.getAvailable();
    const file = readModelsFile();
    this.models = available.map((model) => {
      const fromFile = Boolean(file.providers?.[model.provider]?.models?.some((entry) => entry.id === model.id));
      const info = serializeModel(model as never)!;
      return {
        ...info,
        thinkingLevels: availableThinkingLevels(model as never),
        thinkingLevelMap: (model as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap,
        source: fromFile ? "models.json" : "builtin",
      } satisfies ModelInfo;
    });
  }

  private refreshCommands(): void {
    const session = this.runtime?.session;
    if (!session) {
      this.commands = [];
      return;
    }
    this.commands = session.promptTemplates.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      source: prompt.filePath ? "prompt" : "builtin",
    }));
  }

  private providerRows() {
    const session = this.runtime?.session;
    if (!session) return [];
    const providers = session.modelRuntime.getProviders() as unknown as ProviderLike[];
    const counts = new Map<string, number>();
    for (const model of this.models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    const file = readModelsFile();
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
      api: provider.api ?? "unknown",
      baseUrl: provider.baseUrl,
      modelCount: counts.get(provider.id) ?? 0,
      hasAuth: session.modelRuntime.hasConfiguredAuth(provider.id),
      editable: Boolean(file.providers?.[provider.id]),
    }));
  }

  private runtimeSettings(): RuntimeSettings {
    const settings = this.settingsManager.getGlobalSettings();
    return {
      blockImages: this.settingsManager.getBlockImages(),
      imageAutoResize: this.settingsManager.getImageAutoResize(),
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      defaultThinkingLevel: settings.defaultThinkingLevel,
      modelThinkingLevels: this.settingsManager.getAllModelThinkingLevels() as Record<string, string>,
      thinkingBudgets: this.settingsManager.getThinkingBudgets() as Record<string, number> | undefined,
      enabledModels: settings.enabledModels,
      defaultTools: settings.defaultTools,
      compaction: this.settingsManager.getCompactionSettings(),
      retry: this.settingsManager.getRetrySettings(),
      showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
      hideThinkingBlock: this.settingsManager.getHideThinkingBlock(),
      shellPath: this.settingsManager.getShellPath(),
      shellCommandPrefix: this.settingsManager.getShellCommandPrefix(),
      npmCommand: this.settingsManager.getNpmCommand(),
    };
  }

  /* coalesce bursts: tool events fire several times per tool call, and each
   * emitted payload used to re-serialize the whole transcript synchronously */
  private emitScheduled = false;

  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    setTimeout(() => {
      this.emitScheduled = false;
      this.listener?.({
        state: this.buildState(),
        messages: this.messages(),
        tools: this.toolActivity(),
      });
    }, 16);
  }

  private buildState(): HostState {
    const session = this.runtime?.session;
    return {
      cwd: this.cwd,
      connected: this.connected,
      error: this.error ?? session?.state.errorMessage,
      sessions: this.sessions,
      models: this.models,
      providers: this.providerRows(),
      commands: this.commands,
      settings: this.runtimeSettings(),
      todos: this.todos.items,
      tools: this.toolNames(),
      queue: this.queueState(),
      snapshot: session
        ? {
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            sessionName: session.sessionName,
            cwd: this.cwd,
            model: this.models.find(
              (model) => model.provider === session.model?.provider && model.id === session.model?.id,
            ) ?? serializeModel(session.model),
            thinkingLevel: session.thinkingLevel,
            thinkingLevels: session.getAvailableThinkingLevels(),
            isStreaming: session.isStreaming,
            isIdle: session.isIdle,
            isCompacting: session.isCompacting,
            errorMessage: session.state.errorMessage,
            messageCount: session.messages.length,
            pendingMessageCount: session.pendingMessageCount,
            stats: (() => {
              try {
                const stats = session.getSessionStats();
                return {
                  tokens: stats.tokens,
                  cost: stats.cost,
                  contextUsage: stats.contextUsage
                    ? {
                        tokens: stats.contextUsage.tokens ?? null,
                        contextWindow: stats.contextUsage.contextWindow,
                        percent: stats.contextUsage.percent ?? null,
                      }
                    : undefined,
                };
              } catch {
                return undefined;
              }
            })(),
          }
        : null,
    };
  }

  private requireRuntime(): AgentSessionRuntime {
    if (!this.runtime) throw new Error("Pi agent is not connected yet.");
    return this.runtime;
  }

  private requireSession(): AgentSession {
    return this.requireRuntime().session;
  }
}

function summarizeToolResult(result: { content?: unknown } | undefined): string | undefined {
  if (!result) return undefined;
  if (typeof result.content === "string") return result.content.slice(0, 400);
  if (!Array.isArray(result.content)) return undefined;
  return result.content
    .map((block) => {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 400);
}

/** Rough tokens-from-characters. English and code land near 4; a JSON schema is denser. */
function estimateTokens(chars: number): number {
  return chars > 0 ? Math.round(chars / 4) : 0;
}
