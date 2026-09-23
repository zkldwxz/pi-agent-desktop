import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
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
  FleetAgent,
  HostState,
  ModelEdit,
  ModelInfo,
  PlanAction,
  PlanState,
  PluginInfo,
  PromptPayload,
  RuntimeSettings,
  DesktopConfig,
  SlashCommand,
  ToolActivity,
  UltraMode,
  UltraSetting,
} from "@shared/types";
import type { TerminalResult } from "@shared/workspace";
import { readModelsFile, removeModelFromFile, writeModelEdit } from "./model-config";
import { deletePlugin, listPlugins, setPluginEnabled, createRule } from "./plugins";
import { serializeMessage, serializeMessages, serializeModel, serializeSessionList, thinkingLevelsFor, withUltra } from "./serialize";
import { registerBrowserTools } from "./browser-extension";
import { registerDesktopBridge } from "./desktop-bridge-extension";
import { registerSubagentTools, type NamedExtensionFactory } from "./subagent-tools-extension";
import { registerAgentTools } from "./agent-tools/extension";
import { registerWebTools } from "./web/extension";
import { EMPTY_PLAN } from "./plan-state";
import { EMPTY_TODOS, registerTodoTools, type TodoState } from "./todo-extension";
import { registerUltraPolicy } from "./ultra-extension";
import { readConfig, writeConfig } from "./install";
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

/**
 * The tool factories every session runs.
 *
 * The main session loads them straight from the list in `boot()`; a sub-agent
 * session gets the identical pair through the provisioning extension below,
 * which answers agent-team's `agent-team:configure-tools` request. One
 * definition, so a sub-agent's tool surface cannot drift away from its
 * parent's — the only difference is the team tools, which a path plugin
 * registers and a sub-agent's loader deliberately never reads from disk.
 */
const SESSION_TOOLS: NamedExtensionFactory[] = [
  { name: "pi-desktop-web", factory: registerWebTools },
  { name: "pi-desktop-agent-tools", factory: registerAgentTools },
];

export class PiHost {
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private listener: HostListener | null = null;
  private cwd: string;
  private agentDir = getAgentDir();
  private sessions: HostState["sessions"] = [];
  private models: ModelInfo[] = [];
  /** every model the runtime knows, disabled ones included — the settings
   *  list reads this; every picker reads the enabled `models` */
  private allModels: ModelInfo[] = [];
  private commands: SlashCommand[] = [];
  private tools = new Map<string, ToolActivity>();
  private connected = false;
  private error?: string;
  private starting: Promise<void> | null = null;
  private settingsManager: SettingsManager;
  private todos: TodoState = EMPTY_TODOS;
  /** what the plan-mode extension is doing, mirrored from its bus */
  private plan: PlanState = EMPTY_PLAN;
  /** the delegation fleet, mirrored from the agent-team extension's bus */
  private fleet: FleetAgent[] = [];
  /** the event bus the extensions share — how interrupts reach the team */
  private teamBus: { emit(channel: string, data: unknown): void } | null = null;
  /** names of commands that extensions registered — they dispatch, never queue */
  private pluginCommands = new Set<string>();
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

  /** Agent bash configuration is independent of interactive terminal shells. */
  getShellPath(): string | undefined {
    return this.settingsManager.getShellPath();
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
    this.interruptFleet();
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }
    this.teamBus = null;
    this.connected = false;
  }

  async setCwd(cwd: string): Promise<void> {
    if (cwd === this.cwd && this.runtime) return;
    this.cwd = cwd;
    await this.dispose();
    this.settingsManager = SettingsManager.create(cwd, this.agentDir);
    try {
      await this.start();
    } catch (error) {
      /* switching folders is the New Agent menu's job; a boot failure there
       * must not die silently inside a void'd promise */
      const message = error instanceof Error ? error.message : String(error);
      this.ui.context("host").notify(`Could not open ${cwd}: ${message}`, "error");
      throw error;
    }
  }

  async prompt(payload: PromptPayload): Promise<void> {
    const session = this.requireSession();
    const text = payload.text.trim();
    if (!text) return;
    const images = payload.images?.length ? (payload.images as never) : undefined;
    /* Plugin commands — `/plan`, `/todos`, anything an extension registers —
     * are dispatched by pi itself, immediately and even mid-stream, but only
     * through `prompt()`. `steer`/`followUp` reject extension commands outright,
     * so a command must never be routed into the queue. */
    if (session.isStreaming && !this.isPluginCommand(text)) {
      const behavior = payload.streamingBehavior ?? "followUp";
      if (behavior === "steer") await session.steer(text, images);
      else await session.followUp(text, images);
      return;
    }
    await session.prompt(text, images ? { images } : undefined);
  }

  private isPluginCommand(text: string): boolean {
    const match = /^\/([a-z0-9:_-]+)/i.exec(text);
    return match ? this.pluginCommands.has(match[1].toLowerCase()) : false;
  }

  async abort(): Promise<void> {
    /* Suppress completion wakes before abort settles the parent's turn. */
    this.interruptFleet();
    await this.requireSession().abort();
    this.emit();
  }

  /** Ask the agent-team extension to interrupt one sub-agent (by name) or all. */
  fleetInterrupt(name?: string): void {
    if (!name) {
      this.interruptFleet();
      return;
    }
    try {
      this.teamBus?.emit("agent-team:interrupt", { name });
    } catch {
      /* the runtime is gone; the plugin's own shutdown handles cleanup */
    }
  }

  private interruptFleet(): void {
    try {
      this.teamBus?.emit("agent-team:interrupt-all", null);
    } catch {
      /* ignore */
    }
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
    let swapped: { cancelled: boolean };
    try {
      swapped = await this.requireRuntime().newSession();
    } catch (error) {
      /* a silent failure here reads as "the New Agent button does nothing" —
       * the click is real, the rejection is invisible. Surface it as a window
       * notification and rethrow so the IPC caller also sees the failure. */
      const message = error instanceof Error ? error.message : String(error);
      this.ui.context("host").notify(`Could not start a new session: ${message}`, "error");
      throw error;
    }
    // an extension vetoed the switch (and usually asked the user first): nothing changed
    if (swapped.cancelled) return;
    this.todos = EMPTY_TODOS;
    this.tools.clear();
    /* Paint the new (empty) conversation *before* the extensions are re-attached.
     * The session has already been swapped at this point, so a `bindSession`
     * that throws used to leave the old transcript hanging on screen — which is
     * indistinguishable from a dead button. The sidebar list is a background refresh. */
    this.emit();
    this.refreshSessionsInBackground();
    try {
      await this.bindSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ui.context("host").notify(`The new session started, but its extensions failed: ${message}`, "error");
      throw error;
    }
  }

  async switchSession(sessionPath: string): Promise<void> {
    const result = await this.requireRuntime().switchSession(sessionPath);
    if (result.cancelled) return;
    this.restoreTodos();
    this.tools.clear();
    await this.bindSession();
    // Opening a conversation is the critical path: emit the transcript
    // immediately and let SessionManager.list re-read the project's session
    // files in the background instead of blocking the swap behind it.
    this.emit();
    this.refreshSessionsInBackground();
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
    this.restoreTodos();
    // emit the branch immediately; the session list follows in the background
    this.emit();
    this.refreshSessionsInBackground();
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
    for (const [position, text] of steering.entries()) {
      if (kind !== "steering" || position !== index) await session.steer(text);
    }
    for (const [position, text] of followUp.entries()) {
      if (kind !== "followUp" || position !== index) await session.followUp(text);
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
    if (!this.modelEnabled({ provider, id: modelId })) {
      throw new Error(
        `${provider}/${modelId} is disabled. Turn it back on in Settings ▸ Models & thinking before switching to it.`,
      );
    }
    await session.setModel(model);
    this.emit();
  }

  async setThinkingLevel(level: string): Promise<void> {
    const session = this.requireSession();
    /* pi clamps a level it does not know down to the model's lowest, so Ultra is
       translated here rather than sent: the request is Max, and the delegation
       policy the composer adds is what makes the two differ. */
    const ultra = level === "ultra";
    if (!withUltra(session.getAvailableThinkingLevels(), this.ultraMode(session)).includes(level)) {
      throw new Error(`Thinking level is not available for this model: ${level}`);
    }
    const wire = (ultra ? "max" : level) as never;
    session.setThinkingLevel(wire);
    const model = session.model;
    if (model) {
      const key = `${model.provider}/${model.id}`;
      const entry = this.desktop?.ultra[key];
      if (entry && this.desktop) {
        this.desktop = { ...this.desktop, ultra: { ...this.desktop.ultra, [key]: { ...entry, picked: ultra } } };
        this.desktop = await writeConfig({ ultra: this.desktop.ultra });
      }
      this.settingsManager.setModelThinkingLevel(model.provider, model.id, wire);
    }
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
    this.refreshCommands();
    this.emit();
  }

  /**
   * Drive plan mode.
   *
   * The feature is a plugin (`~/.pi/agent/extensions/plan-mode`, the same file
   * the CLI loads), and these are its own subcommands — sent through `prompt()`
   * so pi dispatches them exactly as if they had been typed. The window adds
   * only what a command line cannot do for itself: pressing the button, and
   * switching the model the build runs on.
   */
  async planAction(payload: PlanAction): Promise<void> {
    const session = this.requireSession();
    const note = payload.note?.trim();
    if (!this.pluginCommands.has("plan")) throw new Error("The Plan mode extension is not enabled.");
    if (payload.action === "build") {
      if (this.plan.phase !== "review" || !this.plan.steps.length) throw new Error("No plan is awaiting approval.");
      if (!session.isIdle) throw new Error("Wait for the agent to settle before building the plan.");
      /* Build with what planned it, or with whatever the user picked — either
       * way it is the model the next turn must run on, so it is set first and
       * remembered for the next plan. */
      if (payload.model) {
        await this.setModel(payload.model.provider, payload.model.id);
        this.desktop = await writeConfig({ buildModel: payload.model });
      }
    }
    const text = payload.action === "refine" && note ? `/plan refine ${note}` : `/plan ${payload.action === "toggle" ? "" : payload.action}`;
    await session.prompt(text.trim());
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
    if (patch.ultra !== undefined) {
      /* an entry survives only while it names a mode, and `picked` is dropped
         with it — clearing Ultra for the running model is what takes the label
         off the composer without a second round trip */
      const ultra: Record<string, UltraSetting> = {};
      for (const [key, entry] of Object.entries(patch.ultra)) {
        if (entry?.mode) ultra[key] = { mode: entry.mode, picked: Boolean(entry.picked) };
      }
      this.desktop = await writeConfig({ ultra });
    }
    if (patch.agents !== undefined) {
      /* the agent-team plugin reads this block from disk when its session
       * binds — write it, then reload so the new limits take effect now */
      this.desktop = await writeConfig({ agents: patch.agents });
    }
    if (patch.terminal !== undefined) {
      /* the terminal pane resolves this on every spawn — no reload needed */
      this.desktop = await writeConfig({ terminal: patch.terminal });
    }
    if (patch.thinkingBudgets) {
      const current = this.settingsManager.getThinkingBudgets() ?? {};
      this.settingsManager.applyOverrides({ thinkingBudgets: { ...current, ...patch.thinkingBudgets } });
    }
    if (patch.enabledModels) {
      /* Disabling the model the session is running on would leave the window
         pointed at something it then refuses to select. The switch is refused
         here, with the reason, instead of quietly unsetting the session model. */
      const current = this.runtime?.session?.model;
      if (current && !this.patternAllows(patch.enabledModels, current)) {
        throw new Error(
          `${current.provider}/${current.id} is the model this session is running on. Switch to another model before disabling it.`,
        );
      }
      this.settingsManager.setEnabledModels(patch.enabledModels);
    }
    await this.settingsManager.flush();
    const errors = this.settingsManager.drainErrors();
    if (errors.length) throw new Error(errors.map((entry) => entry.error.message).join("; "));
    // Desktop-only preferences are read on demand. Reloading the session here
    // would shut down a running fleet just because the user changed shells.
    if (Object.keys(patch).every((key) => key === "terminal" || key === "ultra")) {
      if (patch.ultra !== undefined) await this.refreshModels();
      this.emit();
      return;
    }
    await this.reload();
  }

  async saveModelEdit(edit: ModelEdit): Promise<void> {
    writeModelEdit(edit);
    await this.reloadModelsFromDisk();
    this.emit();
  }

  async deleteModel(provider: string, modelId: string): Promise<void> {
    removeModelFromFile(provider, modelId);
    await this.reloadModelsFromDisk();
    this.emit();
  }

  /**
   * Re-read models.json into the live session, then recompute the list.
   *
   * `refreshModels` alone only re-reads the runtime's in-memory catalogue,
   * which changes when the runtime recomposes its providers — writing the file
   * and stopping there is exactly why a saved model used to need a restart.
   * `refresh({allowNetwork:false})` re-reads the file and recomposes without
   * touching the network. pi reports an entry it cannot compose (a provider
   * naming no models, no baseUrl and no key) as a per-provider error rather
   * than a throw, so it is collected, the list is recomputed anyway, and the
   * error is raised afterwards for the renderer to show — the write already
   * happened, so silence would be the one wrong answer.
   */
  private async reloadModelsFromDisk(): Promise<void> {
    const session = this.runtime?.session;
    let failure: Error | undefined;
    if (session) {
      try {
        const result = await session.modelRuntime.refresh({ allowNetwork: false });
        const first = [...result.errors.values()][0];
        if (first) failure = first instanceof Error ? first : new Error(String(first));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }
    await this.refreshModels();
    if (failure) throw failure;
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

  async createRule(scope: "global" | "project", name: string): Promise<PluginInfo[]> {
    createRule(this.cwd, scope, name);
    await this.reload();
    return this.plugins();
  }

  /**
   * Where pasted images live: the app's own directory under the OS temp root.
   * Sources that are already temporary files are copied here so a system temp
   * cleaner cannot yank the referenced path out from under the conversation.
   */
  private pasteImageDir(): string {
    return join(app.getPath("temp"), "pi-agent-desktop", "paste-images");
  }

  /** drop everything in the paste dir older than 24 hours — called on save
   *  and on boot, so the folder never grows without bound */
  private purgeOldPasteImages(): void {
    const dir = this.pasteImageDir();
    if (!existsSync(dir)) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true });
        } catch {
          /* a file that refuses to die is not worth the session */
        }
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Persist a pasted image (data URL) into the app's paste directory and
   * return the path the conversation should reference.
   */
  async savePasteImage(dataUrl: string, extension = "png"): Promise<string> {
    const match = /^data:image\/([a-z+]+);base64,(.+)$/i.exec(dataUrl);
    const base64 = match?.[2] ?? dataUrl.replace(/^data:[^,]*,/, "");
    const ext = (match?.[1] ?? extension).replace(/[^a-z0-9]/gi, "") || "png";
    const dir = this.pasteImageDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.purgeOldPasteImages();
    const file = join(dir, `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
    writeFileSync(file, Buffer.from(base64, "base64"));
    return file;
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

  private lastSerialized: { log: unknown; length: number; out: ChatMessage[] } | null = null;

  messages(): ChatMessage[] {
    const session = this.runtime?.session;
    if (!session) return [];
    /* The serialization cost of the whole log lives in this method, and the
     * host calls it on every emitted event — most of which change nothing in
     * the transcript. Cache on array identity *and length*: pi appends into
     * the same array reference, so identity alone would serve a transcript
     * that is missing its newest messages. */
    const log = session.messages;
    const stream = session.state.streamingMessage as unknown;
    const last = this.lastSerialized;
    if (last && last.log === log && last.length === log.length) {
      if (!stream) return last.out;
      return [...last.out, serializeMessage(stream, last.out.length, true)];
    }
    const out = serializeMessages(log, undefined);
    this.lastSerialized = { log, length: log.length, out };
    if (!stream) return out;
    return [...out, serializeMessage(stream, out.length, true)];
  }

  toolActivity(): ToolActivity[] {
    return [...this.tools.values()];
  }

  private async boot(): Promise<void> {
    this.error = undefined;
    this.purgeOldPasteImages();
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
          extensionFactories: [
            /* The window's tools, in every session. A sub-agent session loads
               the same two factories — agent-team asks the provisioning
               listener below for them, so the sub-agent's surface is this
               list minus the team tools. */
            ...SESSION_TOOLS,
            {
              name: "pi-desktop-subagent-tools",
              factory: (pi: ExtensionAPI) => registerSubagentTools(pi, SESSION_TOOLS),
            },
            // capabilities the user enabled on the welcome screen
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
            /* Not gated on a capability the way the two above are: the depth can
               change without the session being rebuilt, so the handler has to be
               installed and ask each turn. It costs nothing while it is off. */
            {
              name: "pi-desktop-ultra",
              factory: (pi: ExtensionAPI) =>
                registerUltraPolicy(pi, {
                  isUltra: () => this.ultraActive(),
                  maxAgents: () => this.desktop?.agents.maxConcurrent ?? 3,
                }),
            },
            /* The window's own plumbing. Plan mode lives in `~/.pi/agent/extensions`
               as a normal plugin, so the only way to see what it is doing is to
               listen on the bus it publishes to; the same widget carries the real
               slash-command list. Always installed: it is how the UI hears about
               plugins it knows nothing about. */
            {
              name: "pi-desktop-bridge",
              factory: (pi: ExtensionAPI) => {
                /* the shared bus, kept for the interrupts the window sends down */
                this.teamBus = { emit: (channel: string, data: unknown) => pi.events.emit(channel, data) };
                return registerDesktopBridge(pi, {
                  onPlanState: (state) => {
                    this.plan = state;
                    this.emit();
                  },
                  onFleetState: (agents) => {
                    this.fleet = agents;
                    this.emit();
                  },
                  onCommands: (commands) => {
                    this.pluginCommands = new Set(commands.map((command) => command.name.toLowerCase()));
                    this.commands = commands;
                    this.emit();
                  },
                });
              },
            },
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
    /* The previous session's list is not this one's. Both are repopulated by the
     * desktop bridge, which reports commands and plan state during binding. */
    this.commands = [];
    this.pluginCommands = new Set();
    this.plan = EMPTY_PLAN;
    this.fleet = [];
    // The factory already supplied this session's bus before binding.
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
      // the sidebar reads this list — emit again once the scan lands
      void this.refreshSessions().then(() => this.emit()).catch(() => undefined);
    }
    // any event is a hint the transcript (and maybe a brand-new session file)
    // changed; throttled so streaming does not rescan the session dir per token
    this.maybeRefreshSessions();
    this.emit();
  }

  private lastSessionsRefresh = 0;

  private maybeRefreshSessions(): void {
    const now = Date.now();
    if (now - this.lastSessionsRefresh < 2000) return;
    this.lastSessionsRefresh = now;
    void this.refreshSessions().then(() => this.emit()).catch(() => undefined);
  }

  private async refreshSessions(): Promise<void> {
    const cwd = this.cwd;
    const listed = await SessionManager.list(cwd);
    if (cwd !== this.cwd) return;
    const session = this.runtime?.session;
    this.sessions = serializeSessionList(listed, session?.sessionFile, session?.isStreaming);
  }

  /**
   * Refresh the sidebar's session list without gating the transcript on it.
   *
   * `SessionManager.list` re-reads the head of every `.jsonl` in the project,
   * which is tens to hundreds of ms on a machine with a long history. Session
   * swaps, new sessions and forks need that list to be *eventually* right, not
   * synchronously — so it runs off the critical path and re-emits when it lands.
   */
  private refreshSessionsInBackground(): void {
    void this.refreshSessions().then(() => this.emit()).catch(() => undefined);
  }

  /** Ultra borrows Max's request, so the flag that says which one the user
   *  picked has to live on this side of the wire. */
  private ultraMode(session: AgentSession | null | undefined): UltraMode | undefined {
    const model = session?.model;
    if (!model || !this.desktop) return undefined;
    return this.desktop.ultra[`${model.provider}/${model.id}`]?.mode;
  }

  /** Whether the session is running at Ultra, not merely at Max. */
  private ultraActive(): boolean {
    const session = this.runtime?.session ?? null;
    if (!session || session.thinkingLevel !== "max") return false;
    const model = session.model;
    if (!model || !this.desktop) return false;
    const entry = this.desktop.ultra[`${model.provider}/${model.id}`];
    return Boolean(entry?.mode && entry.picked);
  }

  private async refreshModels(): Promise<void> {
    const session = this.runtime?.session;
    if (!session) {
      this.allModels = [];
      this.models = [];
      return;
    }
    const available = await session.modelRuntime.getAvailable();
    const file = readModelsFile();
    this.editableProviders = new Set(Object.keys(file.providers ?? {}));
    const catalogue = available.map((model) => {
      const fromFile = Boolean(file.providers?.[model.provider]?.models?.some((entry) => entry.id === model.id));
      const info = serializeModel(model as never)!;
      return {
        ...info,
        thinkingLevels: withUltra(
          availableThinkingLevels(model as never),
          this.desktop?.ultra[`${model.provider}/${model.id}`]?.mode,
        ),
        thinkingLevelMap: (model as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap,
        source: fromFile ? "models.json" : "builtin",
      } satisfies ModelInfo;
    });
    this.allModels = catalogue;
    /* Disabling is a desktop-level whitelist kept in pi's own `enabledModels`
       field, where an empty list means "all of them" — the same reading the
       CLI gives it. Every picker in the window draws from `models`, so a
       disabled model leaves all of them at once, while the settings list still
       reads `allModels` and can show the row greyed out. Read once, not per
       row: the settings getter hands back a fresh clone every call. */
    const enabledModels = this.settingsManager.getGlobalSettings().enabledModels;
    this.models = catalogue.filter((model) => this.patternAllows(enabledModels, model));
  }

  /** Does the enabled-model whitelist cover this model? A trailing `*` in a
   *  pattern matches a prefix (`anthropic/*`), the shape the CLI accepts. */
  private patternAllows(enabled: string[] | undefined, model: { provider: string; id: string }): boolean {
    if (!enabled?.length) return true;
    const key = `${model.provider}/${model.id}`.toLowerCase();
    return enabled.some((pattern) => {
      const needle = pattern.trim().toLowerCase();
      if (!needle) return false;
      if (needle.endsWith("*")) return key.startsWith(needle.slice(0, -1));
      return needle === key;
    });
  }

  private modelEnabled(model: { provider: string; id: string }): boolean {
    return this.patternAllows(this.settingsManager.getGlobalSettings().enabledModels, model);
  }

  /**
   * The slash-command menu.
   *
   * The authoritative list comes from inside the session (`pi.getCommands()` —
   * extensions, prompt templates and skills at once), which only an extension
   * can call; the desktop bridge reports it. Until it does, prompt templates are
   * the part of that list the host can read for itself.
   */
  private refreshCommands(): void {
    const session = this.runtime?.session;
    if (!session) {
      this.commands = [];
      return;
    }
    if (this.commands.length) return;
    this.commands = session.promptTemplates.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      source: "prompt",
    }));
  }

  private editableProviders = new Set<string>();

  private providerRows() {
    const session = this.runtime?.session;
    if (!session) return [];
    const providers = session.modelRuntime.getProviders() as unknown as ProviderLike[];
    const counts = new Map<string, number>();
    for (const model of this.models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
      api: provider.api ?? "unknown",
      baseUrl: provider.baseUrl,
      modelCount: counts.get(provider.id) ?? 0,
      hasAuth: session.modelRuntime.hasConfiguredAuth(provider.id),
      editable: this.editableProviders.has(provider.id),
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
      ultra: this.desktop?.ultra ?? {},
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
      agents: this.desktop?.agents,
      terminal: this.desktop?.terminal,
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
      allModels: this.allModels,
      providers: this.providerRows(),
      commands: this.commands,
      settings: this.runtimeSettings(),
      todos: this.todos.items,
      plan: this.plan,
      fleet: this.fleet,
      surfaces: this.ui.surfaces(),
      tools: this.toolNames(),
      queue: this.queueState(),
      snapshot: session
        ? {
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            sessionName: session.sessionName,
            cwd: this.cwd,
            model: this.allModels.find(
              (model) => model.provider === session.model?.provider && model.id === session.model?.id,
            ) ?? serializeModel(session.model, this.ultraMode(session)),
            thinkingLevel: this.ultraActive() ? "ultra" : session.thinkingLevel,
            thinkingLevels: withUltra(session.getAvailableThinkingLevels(), this.ultraMode(session)),
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
