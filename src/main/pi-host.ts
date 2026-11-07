import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { app, shell } from "electron";
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
  createCodemodeExtension,
  createMcpExtension,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type {
  AsideState,
  ChannelEdit,
  ChannelInfo,
  ChatMessage,
  ContextBreakdown,
  ContextPart,
  FleetAgent,
  HostState,
  HostUpdate,
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
} from "@shared/types";
import type { TerminalResult } from "@shared/workspace";
import {
  addChannelKey,
  deleteChannel,
  readModelsFile,
  removeChannelKey,
  removeModelFromFile,
  writeChannel,
  writeModelEdit,
} from "./model-config";
import { channelIdOf } from "../shared/channel.ts";
import {
  mcpFile,
  patchMcpServer as patchMcpServerFile,
  readMcpConfig,
  testMcpServer as testMcpServerFile,
  removeMcpServer as removeMcpServerFile,
  writeMcpServer as writeMcpServerFile,
  type McpConfigView,
  type McpScope,
} from "./mcp";
import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import { createRule, deletePlugin, listPlugins, readPluginText, setPluginEnabled, writePluginText } from "./plugins";
import { toolDisplayDetails, serializeMessage, serializeMessages, serializeModel, serializeSessionList, textFromContent, thinkingLevelsFor } from "./serialize";
import { registerBrowserTools } from "./browser-extension";
import { registerDesktopBridge } from "./desktop-bridge-extension";
import { registerSubagentTools, type NamedExtensionFactory } from "./subagent-tools-extension";
import { registerAgentTools } from "./agent-tools/extension";
import { registerWebTools } from "./web/extension";
import { EMPTY_PLAN } from "./plan-state";
import { EMPTY_TODOS, registerTodoTools, type TodoState } from "./todo-extension";
import { readConfig, writeConfig } from "./install";
import { UiBridge } from "./ui-bridge";
import type { UiAnswer, UiNotification, UiRequest } from "@shared/ui";
import type { BrowserHost } from "./browser";
import type { WorkspaceStore } from "./workspaces";
import type { SshHost } from "./remote-ssh";
import type { WorkspaceInfo } from "../shared/workspaces";
import { registerRemoteTools, registerWorkspaceContext } from "./workspace-tools";
import { providerQuota, QUOTA_PROVIDERS } from "./quota";
import type { PlanQuota } from "../shared/quota";

export type HostListener = (payload: HostUpdate) => void;

/** Slash commands the desktop bundles extensions for. A typed command from
 *  this set that no extension registered is a missing plugin, not prose —
 *  the one place the host can say so without guessing at arbitrary input. */
const BUNDLED_COMMANDS = new Set(["plan"]);

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
  private readonly homeDir = homedir();
  private agentDir = getAgentDir();
  private sessions: HostState["sessions"] = [];
  private models: ModelInfo[] = [];
  /** every model the runtime knows, disabled ones included — the settings
   *  list reads this; every picker reads the enabled `models` */
  private allModels: ModelInfo[] = [];
  /** the endpoints the providers fold into, and which endpoint each provider is on */
  private channels: ChannelInfo[] = [];
  private channelByProvider = new Map<string, string>();
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
  /** true once the bridge has reported the command list for this session —
   *  before that, an absent command means "not known yet", not "not installed" */
  private pluginCommandsReady = false;
  private desktop: DesktopConfig | null = null;

  /* ── parallel tasks ─────────────────────────────────────────────
   * pi's runtime owns exactly one live session, and its switchSession
   * aborts any turn in flight — which made opening a second task kill the
   * first. Instead, switching away from a streaming session detaches the
   * whole runtime into this pool, where the run continues uninterrupted;
   * switching back re-promotes it (nothing is reloaded, nothing is lost),
   * and a detached run that settles disposes itself. */
  private detached = new Map<
    string,
    { runtime: AgentSessionRuntime; slotId: string; unsubscribe: () => void }
  >();
  /** session files with a detached turn in flight — the sidebar's spinner */
  private detachedRunning = new Set<string>();
  /** per-runtime identity for bridge gating: a detached runtime's plan,
   *  fleet and command reports must not clobber the active view's */
  private activeSlotId = "boot";
  private slotSeq = 0;
  private slotBridges = new Map<string, { reannounce: () => void; emit: (channel: string, data: unknown) => void }>();
  readonly ui = new UiBridge((request, notifications) => this.listener?.({ state: this.buildState(), messages: this.messages(), tools: this.toolActivity(), uiRequest: request, notifications }));

  private workspace?: WorkspaceInfo;

  constructor(cwd: string, private readonly getBrowser: () => BrowserHost | null = () => null, private readonly workspaceServices?: { store: WorkspaceStore; ssh: SshHost }) {
    this.cwd = cwd;
    this.settingsManager = SettingsManager.create(cwd, this.agentDir);
  }

  onChange(listener: HostListener): void {
    this.listener = listener;
  }

  getCwd(): string {
    return this.cwd;
  }

  assertWorkspaceIdle(): void {
    if (this.runtime?.session.isStreaming || this.runtime?.session.isCompacting || this.runtime?.session.isBashRunning || this.detachedRunning.size || this.fleet.some((agent) => agent.status === "running")) throw new Error("Wait for active tasks to finish before changing workspace folders.");
  }

  async refreshWorkspace(): Promise<void> {
    this.assertWorkspaceIdle();
    this.workspace = await this.workspaceServices?.store.get(this.cwd);
    await this.reload();
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
    /* parallel tasks die with the host — their sessions are persisted turn by
       turn, so nothing is lost that the run had not already written */
    for (const slot of this.detached.values()) {
      slot.unsubscribe();
      await slot.runtime.dispose().catch(() => undefined);
    }
    this.detached.clear();
    this.detachedRunning.clear();
    this.slotBridges.clear();
    await this.disposeAside();
    this.goal = null;
    this.teamBus = null;
    this.connected = false;
  }

  async setCwd(cwd: string): Promise<void> {
    const nextCwd = cwd === "~" ? this.homeDir : cwd;
    if (nextCwd === this.cwd && this.runtime) return;
    // dispose aborts the active agent and its fleet. A folder change must not
    // silently cancel work; same-workspace new chats can still park their turn.
    this.assertWorkspaceIdle();
    this.cwd = nextCwd;
    await this.dispose();
    this.settingsManager = SettingsManager.create(nextCwd, this.agentDir);
    try {
      await this.start();
    } catch (error) {
      /* switching folders is the New Agent menu's job; a boot failure there
       * must not die silently inside a void'd promise */
      const message = error instanceof Error ? error.message : String(error);
      this.ui.context("host").notify(`Could not open ${nextCwd}: ${message}`, "error");
      throw error;
    }
  }

  /* ── session goal (`/goal`) ─────────────────────────────────────────── */

  /** The goal the agent works toward — injected as a system-prompt section
   *  by the desktop bridge while set, gone the run after it clears. */
  private goal: string | null = null;

  setGoal(condition: string | null): void {
    const text = condition?.trim() || null;
    if (text === this.goal) return;
    this.goal = text;
    this.emit();
  }

  /* ── aside questions (`/btw`) ───────────────────────────────────────── */

  /**
   * The aside is a second runtime on the same workspace — a real session
   * with its own file, never the active slot — so a question asked there
   * does not enter the conversation being read. It stays warm between
   * questions (follow-ups have context) until the workspace changes.
   */
  private asideRuntime: AgentSessionRuntime | null = null;
  private asideUnsubscribe: (() => void) | null = null;
  private aside: AsideState | null = null;

  async asideAsk(text: string): Promise<void> {
    const question = text.trim();
    if (!question) return;
    this.requireRuntime(); // the boot must have run — the aside shares its services
    if (!this.asideRuntime) {
      const slotId = `aside-${++this.slotSeq}`;
      this.asideRuntime = await createAgentSessionRuntime(
        this.makeRuntimeFactory(slotId, { agentDir: this.agentDir, settingsManager: this.settingsManager }),
        {
          cwd: this.cwd,
          agentDir: this.agentDir,
          sessionManager: SessionManager.create(this.cwd),
          sessionStartEvent: { type: "session_start", reason: "new" },
        },
      );
      await this.asideRuntime.session.bindExtensions({ mode: "rpc", uiContext: this.ui.context("extension") });
      this.asideUnsubscribe = this.asideRuntime.session.subscribe((event) => this.onAsideEvent(event));
    }
    this.aside = { question, answer: "", running: true };
    this.emit();
    try {
      await this.asideRuntime.session.prompt(question);
    } catch (error) {
      this.aside = { question, answer: "", running: false, error: error instanceof Error ? error.message : String(error) };
      this.emit();
    }
  }

  /** The slim pump: the card needs "done" and the answer, not a transcript. */
  private onAsideEvent(event: AgentSessionEvent): void {
    if (!this.aside) return;
    if (event.type === "agent_settled") {
      const last = this.asideRuntime?.session.messages.at(-1);
      const parts = (last as { role?: string; content?: unknown } | undefined)?.content;
      const answer = Array.isArray(parts)
        ? parts.filter((part) => (part as { type?: string }).type === "text").map((part) => (part as { text?: string }).text ?? "").join("")
        : typeof parts === "string" ? parts : "";
      this.aside = { ...this.aside, answer: answer.trim(), running: false };
    }
    this.emit();
  }

  /** Dismiss the card; the aside session stays parked for follow-ups. */
  asideDismiss(): void {
    this.aside = null;
    this.emit();
  }

  private async disposeAside(): Promise<void> {
    this.asideUnsubscribe?.();
    this.asideUnsubscribe = null;
    await this.asideRuntime?.dispose().catch(() => undefined);
    this.asideRuntime = null;
    this.aside = null;
  }

  async prompt(payload: PromptPayload): Promise<void> {
    const session = this.requireSession();
    if (this.workspace?.sshId) this.workspaceServices?.ssh.connection(this.workspace.sshId);
    const text = payload.text.trim();
    if (!text) return;
    /* A bundled extension command typed while its plugin is missing or disabled
     * would otherwise reach the model as literal text — "/plan" answered as a
     * question about "/plan". Say what is wrong instead of guessing at it. */
    const command = /^\/([a-z0-9:_-]+)/i.exec(text)?.[1]?.toLowerCase();
    if (command && this.pluginCommandsReady && BUNDLED_COMMANDS.has(command) && !this.pluginCommands.has(command)) {
      this.ui
        .context("host")
        .notify(`/${command} is not available — its extension is not installed or is disabled. Manage plugins in Customize.`, "warning");
      return;
    }
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
    /* A streaming task must survive "new chat": park it, then build a fresh
     * runtime around a brand-new session in the same session dir. The SDK's
     * own newSession aborts the current turn, so it is only safe when idle. */
    const parked = this.parkActiveIfNeeded();
    if (parked) {
      const sessionManager = SessionManager.create(this.cwd, parked.sessionDir);
      await this.openRuntimeFor(sessionManager, parked.previousFile, "new");
      this.refreshSessionsInBackground();
      return;
    }

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

  /**
   * Park the active runtime while its turn is still streaming: it keeps
   * running as a detached task, feeding only session-status updates to the
   * sidebar. Returns the parked session's file and dir, or null when the
   * active runtime was idle (nothing to preserve — the caller may rebuild it
   * through the SDK's own switch path, which aborts safely).
   */
  private parkActiveIfNeeded(): { previousFile: string; sessionDir: string } | null {
    const active = this.requireRuntime();
    if (!active.session.isStreaming) return null;
    const previousFile = active.session.sessionFile;
    if (!previousFile) return null;
    const previousSlotId = this.activeSlotId;
    // the main event pump stops for a parked runtime; a slim one takes over
    // that only tracks completion for the sidebar's spinner
    this.unsubscribe?.();
    this.detachedRunning.add(previousFile);
    this.detached.set(previousFile, {
      runtime: active,
      slotId: previousSlotId,
      unsubscribe: active.session.subscribe((event) => this.onDetachedEvent(previousFile, event)),
    });
    return { previousFile, sessionDir: active.session.sessionManager.getSessionDir() };
  }

  /** Background-task events: completion is the only thing worth surfacing —
   *  the run's transcript lands in its own session file, the sidebar spinner
   *  clears, and the detached runtime disposes itself. */
  private onDetachedEvent(sessionFile: string, event: AgentSessionEvent): void {
    if (event.type !== "agent_settled") return;
    const slot = this.detached.get(sessionFile);
    if (slot) {
      this.detached.delete(sessionFile);
      slot.unsubscribe();
      void slot.runtime.dispose().catch(() => undefined);
    }
    this.detachedRunning.delete(sessionFile);
    void this.refreshSessions().then(() => this.emit()).catch(() => undefined);
  }

  /** Wire a runtime in as the active view: subscribe the full event pump,
   *  reset the per-session mirrors, and have its bridge re-announce so plan,
   *  fleet and commands reflect the session being returned to. */
  private async activateRuntime(runtime: AgentSessionRuntime, slotId: string): Promise<void> {
    this.runtime = runtime;
    this.activeSlotId = slotId;
    this.tools.clear();
    this.restoreTodos();
    this.commands = [];
    this.pluginCommands = new Set();
    this.pluginCommandsReady = false;
    this.plan = EMPTY_PLAN;
    this.fleet = [];
    this.unsubscribe?.();
    this.unsubscribe = runtime.session.subscribe((event) => this.onEvent(event));
    this.slotBridges.get(slotId)?.reannounce();
    this.refreshCommands();
    await this.refreshModels();
    this.emit();
    this.refreshSessionsInBackground();
  }

  /** A fresh runtime bound to a specific session file — the parallel-task
   *  path, where the SDK's in-place switch would abort the parked run. */
  private async openRuntimeFor(
    sessionManager: SessionManager,
    previousFile?: string,
    reason: "resume" | "new" = "resume",
  ): Promise<void> {
    const slotId = `slot-${++this.slotSeq}`;
    this.activeSlotId = slotId;
    const runtime = await createAgentSessionRuntime(this.makeRuntimeFactory(slotId, {
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
    }), {
      cwd: sessionManager.getCwd(),
      agentDir: this.agentDir,
      sessionManager,
      sessionStartEvent: { type: "session_start", reason, previousSessionFile: previousFile },
    });
    await runtime.session.bindExtensions({ mode: "rpc", uiContext: this.ui.context("extension") });
    await this.activateRuntime(runtime, slotId);
  }

  async switchSession(sessionPath: string): Promise<void> {
    const active = this.requireRuntime();
    if (active.session.sessionFile === sessionPath) return;
    const targetManager = SessionManager.open(sessionPath);
    const targetCwd = targetManager.getCwd();
    if (targetCwd !== this.cwd) {
      // Local and SSH sessions have different tool transports. Reusing the old
      // service loader would execute a reopened remote conversation locally.
      const previous = active.session.sessionFile;
      const parked = this.parkActiveIfNeeded();
      if (!parked) { this.unsubscribe?.(); await active.dispose(); }
      this.cwd = targetCwd;
      this.settingsManager = SettingsManager.create(targetCwd, this.agentDir);
      this.workspace = await this.workspaceServices?.store.get(targetCwd);
      const target = this.detached.get(sessionPath);
      if (target) { this.detached.delete(sessionPath); this.detachedRunning.delete(sessionPath); target.unsubscribe(); await this.activateRuntime(target.runtime, target.slotId); }
      else await this.openRuntimeFor(targetManager, previous);
      this.refreshSessionsInBackground();
      return;
    }

    const parked = this.parkActiveIfNeeded();
    const target = this.detached.get(sessionPath);
    if (target) {
      // switching back to a task that is still running: re-promote its runtime
      this.detached.delete(sessionPath);
      this.detachedRunning.delete(sessionPath);
      target.unsubscribe();
      await this.activateRuntime(target.runtime, target.slotId);
      return;
    }
    if (parked) {
      // the previous task keeps running detached; the target needs its own
      // runtime, because the SDK's in-place switch would tear down the parked one
      await this.openRuntimeFor(SessionManager.open(sessionPath), parked.previousFile);
      this.refreshSessionsInBackground();
      return;
    }

    // idle: the SDK's own switch is safe — nothing is running to abort
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
  /**
   * The prompts on the path actually being shown, oldest first.
   *
   * Walked from the session's leaf rather than taken from
   * `getUserMessagesForForking()`, which reports every user entry in the file —
   * including the ones a rewind abandoned. Those would shift every index, so
   * the retry button would offer to branch from text that is no longer part of
   * the conversation.
   */
  promptTargets(): { entryId: string; text: string }[] {
    try {
      const session = this.requireSession();
      return session.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "message" && entry.message.role === "user")
        .map((entry) => ({
          entryId: entry.id,
          text: textFromContent((entry as { message: { content?: unknown } }).message.content).slice(0, 120),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Rewind the conversation to just before the prompt at `index` and hand its
   * text back, so editing a sent prompt replaces that turn rather than piling a
   * new one on top of it.
   *
   * pi keeps the session append-only: this moves the leaf pointer to the
   * prompt's parent, so the abandoned turn stays in the file and nothing is
   * rewritten or deleted — which is also why an edit can be undone by navigating
   * back. `navigateTree` refuses to run mid-stream, so editing while the agent
   * is still answering aborts the current response first; that is what
   * "editable while running" has to mean here.
   */
  async rewindTo(index: number): Promise<{ text: string; cancelled: boolean }> {
    const session = this.requireSession();
    const target = this.promptTargets()[index];
    if (!target) throw new Error("No prompt at that position.");
    if (session.isStreaming) {
      await session.abort();
      await session.waitForIdle();
    }
    const result = await session.navigateTree(target.entryId, { summarize: false });
    if (result.cancelled) return { text: "", cancelled: true };
    /* The tool dock describes the turn that was just stepped back from, so it
       goes with it; the todo list is the plan for the turn about to be re-run
       and survives on purpose. */
    this.tools.clear();
    this.emit();
    return { text: result.editorText ?? target.text, cancelled: false };
  }

  /**
   * Branch the conversation from the prompt at `index`.
   *
   * Forking writes a new session file rather than editing the current one, so
   * the original transcript survives and the app switches to the branch.
   */
  async forkAt(index: number): Promise<{ cancelled: boolean }> {
    const target = this.promptTargets()[index];
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
    const offered = session.getAvailableThinkingLevels() as string[];
    if (!offered.includes(level)) {
      /* name what the model does take: the refusal alone leaves the user with a
         dead end, and this is the one message that can tell them the depth is
         the channel's limit rather than a broken control */
      throw new Error(`${level} is not one of this model's depths: ${offered.join(" / ")}`);
    }
    session.setThinkingLevel(level as never);
    const model = session.model;
    if (model) {
      this.settingsManager.setModelThinkingLevel(model.provider, model.id, level as never);
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
    if (Object.keys(patch).every((key) => key === "terminal")) {
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
   * Channels: one endpoint, one provider entry per key.
   *
   * `model-config` owns that shape; each of these writes it and then re-reads
   * the runtime, so a channel added here is pickable in this window without a
   * restart. The names differ from the imported writers so a reader never has
   * to wonder whether a call inside the method is recursion.
   */
  async createChannel(edit: ChannelEdit): Promise<string[]> {
    const ids = writeChannel(edit);
    await this.reloadModelsFromDisk();
    this.emit();
    return ids;
  }

  async removeChannel(channelId: string): Promise<void> {
    deleteChannel(channelId);
    await this.reloadModelsFromDisk();
    this.emit();
  }

  async addKeyToChannel(channelId: string, key: string): Promise<string | undefined> {
    const id = addChannelKey(channelId, key);
    await this.reloadModelsFromDisk();
    this.emit();
    return id;
  }

  async removeKeyFromChannel(providerId: string): Promise<void> {
    removeChannelKey(providerId);
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
    deletePlugin(this.cwd, path, kind);
    await this.reload();
    return this.plugins();
  }

  /** The rule / skill / theme file the in-app editor opened. */
  readPluginText(path: string): string {
    return readPluginText(this.cwd, path);
  }

  /** Prompt templates are cached by the resource loader; saving must refresh it. */
  async writePluginText(path: string, text: string): Promise<void> {
    this.assertWorkspaceIdle();
    writePluginText(this.cwd, path, text);
    await this.reload();
  }

  async createRule(scope: "global" | "project", name: string): Promise<PluginInfo[]> {
    createRule(this.cwd, scope, name);
    await this.reload();
    return this.plugins();
  }

  /* ── MCP servers ─────────────────────────────────────────────────────── */

  /**
   * The servers both `mcp.json` files define, for the management screen.
   *
   * This reads the files directly rather than asking the session, because the
   * screen has to show entries the session will not load — a disabled server,
   * one with a broken command, or a project entry in a project pi does not
   * trust yet.
   */
  mcpConfig(): McpConfigView {
    return readMcpConfig(this.cwd, this.agentDir);
  }

  /** "does this server answer" — the connectivity check the list shows */
  mcpTest(scope: McpScope, name: string): Promise<{ ok: boolean; detail: string }> {
    return testMcpServerFile(this.cwd, this.agentDir, scope, name);
  }

  /** Namespaces whose tools the session actually registered — i.e. connected. */
  mcpConnectedNamespaces(): string[] {
    const connected = new Set<string>();
    for (const name of this.toolNames()) {
      if (!name.startsWith("mcp__")) continue;
      const end = name.indexOf("__", "mcp__".length);
      if (end > 0) connected.add(name.slice("mcp__".length, end));
    }
    return [...connected];
  }

  /** Where a scope's file lives, so the screen can open or name it. */
  mcpFilePath(scope: McpScope): string {
    return mcpFile(this.cwd, this.agentDir, scope);
  }

  /**
   * A pi slash command, run the way the composer runs one.
   *
   * MCP sign-in is the caller: `/mcp login <server>` is pi's own command, so
   * nothing here reimplements OAuth — the extension opens the browser through
   * the `openUrl` hook and waits for the loopback callback.
   */
  async runCommand(text: string): Promise<void> {
    await this.requireSession().prompt(text);
  }

  async writeMcpServer(scope: McpScope, name: string, config: McpServerConfig): Promise<McpConfigView> {
    writeMcpServerFile(this.cwd, this.agentDir, scope, name, config);
    await this.reload();
    return this.mcpConfig();
  }

  async patchMcpServer(
    scope: McpScope,
    name: string,
    patch: { enabled?: boolean; exposure?: McpExposure },
  ): Promise<McpConfigView> {
    patchMcpServerFile(this.cwd, this.agentDir, scope, name, patch);
    await this.reload();
    return this.mcpConfig();
  }

  async removeMcpServer(scope: McpScope, name: string): Promise<McpConfigView> {
    removeMcpServerFile(this.cwd, this.agentDir, scope, name);
    await this.reload();
    return this.mcpConfig();
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
      const rows = serializeSessionList(
        listed,
        this.runtime?.session?.sessionFile,
        Boolean(this.runtime?.session?.isStreaming),
      );
      /* detached parallel tasks stream in runtimes the view is not on — mark
         them running here, or the sidebar shows an unread dot for a live run */
      for (const item of rows) {
        if (this.detachedRunning.has(item.path)) item.status = "running";
      }
      return rows;
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
  /** the settled transcript the renderer was last given, compared by reference */
  private sentSettled: ChatMessage[] | null = null;

  /**
   * The transcript, split into what has finished and what is still moving.
   *
   * `settled` is the cached array the renderer already holds; `all` is what it
   * should show. When the two line up with the previous send, only the streaming
   * message differs and `emit` ships that one message instead of the whole
   * conversation.
   */
  private transcript(): { all: ChatMessage[]; settled: ChatMessage[] } {
    const session = this.runtime?.session;
    if (!session) return { all: [], settled: [] };
    /* The serialization cost of the whole log lives in this method, and the
     * host calls it on every emitted event — most of which change nothing in
     * the transcript. Cache on array identity *and length*: pi appends into
     * the same array reference, so identity alone would serve a transcript
     * that is missing its newest messages. */
    const log = session.messages;
    const stream = session.state.streamingMessage as unknown;
    const last = this.lastSerialized;
    if (last && last.log === log && last.length === log.length) {
      if (!stream) return { all: last.out, settled: last.out };
      return { all: [...last.out, serializeMessage(stream, last.out.length, true)], settled: last.out };
    }
    const out = serializeMessages(log, undefined);
    this.lastSerialized = { log, length: log.length, out };
    if (!stream) return { all: out, settled: out };
    return { all: [...out, serializeMessage(stream, out.length, true)], settled: out };
  }

  messages(): ChatMessage[] {
    return this.transcript().all;
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

    this.workspace = await this.workspaceServices?.store.get(this.cwd);
    const createRuntime = this.makeRuntimeFactory("boot", { agentDir, settingsManager });

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

  /**
   * The runtime factory, parameterized by slot: parallel tasks each build one
   * through here, and every extension callback that feeds host-level UI state
   * is gated on its own slot being the active one — a background task's plan,
   * fleet or command report must never overwrite what the window is showing.
   */
  private makeRuntimeFactory(
    slotId: string,
    io: { agentDir: string; settingsManager: SettingsManager },
  ): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent }) => {
      const workspace = await this.workspaceServices?.store.get(cwd);
      const sessionTools: NamedExtensionFactory[] = workspace?.sshId && this.workspaceServices
        ? [
            { name: "pi-desktop-web", factory: registerWebTools },
            { name: "pi-desktop-remote-tools", factory: (pi) => registerRemoteTools(pi, this.workspaceServices!.ssh, workspace) },
          ]
        : SESSION_TOOLS;
      const services = await createAgentSessionServices({
        cwd,
        agentDir: io.agentDir,
        settingsManager: io.settingsManager,
        // The browser tools are a pi extension, not an MCP server: the agent runs
        // in this process, so the tools call the embedded view directly.
        resourceLoaderOptions: {
          extensionFactories: [
            /* The built-in extensions the CLI loads and SDK sessions do
               not. MCP servers come from `mcp.json` — the one in the agent
               directory and, for a trusted project, the one under `.pi/`.
               `codemode` is registered inactive: it switches on through
               `defaultTools`, or on its own when a server's exposure needs
               it. `openUrl` hands an OAuth authorization page to the real
               browser, which is what the CLI's own sign-in does. */
            createCodemodeExtension(),
            createMcpExtension({ openUrl: (url) => void shell.openExternal(url) }),
            /* The window's tools, in every session. A sub-agent session loads
               the same two factories — agent-team asks the provisioning
               listener below for them, so the sub-agent's surface is this
               list minus the team tools. */
            ...sessionTools,
            ...(workspace && this.workspaceServices ? [{ name: "pi-desktop-workspace-context", factory: (pi: ExtensionAPI) => registerWorkspaceContext(pi, workspace, () => this.workspaceServices!.store.get(cwd)) }] : []),
            {
              name: "pi-desktop-subagent-tools",
              factory: (pi: ExtensionAPI) => registerSubagentTools(pi, sessionTools),
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
                          if (slotId !== this.activeSlotId) return;
                          this.todos = state;
                          this.emit();
                        },
                      }),
                  },
                ]
              : []),
            /* The window's own plumbing. Plan mode lives in `~/.pi/agent/extensions`
               as a normal plugin, so the only way to see what it is doing is to
               listen on the bus it publishes to; the same widget carries the real
               slash-command list. Always installed: it is how the UI hears about
               plugins it knows nothing about. */
            {
              name: "pi-desktop-bridge",
              factory: (pi: ExtensionAPI) => {
                /* the shared bus, kept for the interrupts the window sends down —
                   routed to whichever slot is active, not whoever built last */
                const bridge = registerDesktopBridge(pi, {
                  onPlanState: (state) => {
                    if (slotId !== this.activeSlotId) return;
                    this.plan = state;
                    this.emit();
                  },
                  onFleetState: (agents) => {
                    if (slotId !== this.activeSlotId) return;
                    this.fleet = agents;
                    this.emit();
                  },
                  onCommands: (commands) => {
                    if (slotId !== this.activeSlotId) return;
                    this.pluginCommands = new Set(commands.map((command) => command.name.toLowerCase()));
                    this.pluginCommandsReady = true;
                    this.commands = commands;
                    this.emit();
                  },
                  /* the goal is desktop state, not plugin state — every
                     session reads the same field, main and aside alike */
                  getGoal: () => this.goal,
                });
                this.slotBridges.set(slotId, {
                  reannounce: () => bridge.reannounce(),
                  emit: (channel: string, data: unknown) => pi.events.emit(channel, data),
                });
                this.syncTeamBus();
                return bridge;
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
  }

  /** Interrupts and fleet pings always reach the runtime the window is on. */
  private syncTeamBus(): void {
    this.teamBus = {
      emit: (channel: string, data: unknown) => this.slotBridges.get(this.activeSlotId)?.emit(channel, data),
    };
  }

  private async bindSession(): Promise<void> {
    this.unsubscribe?.();
    const session = this.requireSession();
    /* The previous session's list is not this one's. Both are repopulated by the
     * desktop bridge, which reports commands and plan state during binding. */
    this.commands = [];
    this.pluginCommands = new Set();
    this.pluginCommandsReady = false;
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
      const partial = event.partialResult as { content?: unknown; details?: unknown } | undefined;
      this.tools.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: "running",
        resultText: partial ? summarizeToolResult(partial) : current?.resultText,
        details: partial ? event.toolName.startsWith("mcp__") ? toolDisplayDetails(partial.details, partial.content) : partial.details : current?.details,
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
        details: event.toolName.startsWith("mcp__") ? toolDisplayDetails(result?.details, result?.content) : result?.details,
        startedAt: current?.startedAt ?? Date.now(),
        endedAt: Date.now(),
      });
    }
    if (event.type === "agent_settled") {
      for (const tool of this.tools.values()) {
        if (tool.status === "running") tool.status = "done";
      }
      /* The activity table exists to show calls whose transcript row has not
       * landed yet; once the turn settles every call is in the session log, so
       * keeping the entries would only let them leak into the next turn's
       * live-tool sweep as ghosts of commands already shown. */
      this.tools.clear();
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
    /* a detached run streams in a runtime the view is not on — its session
       file only reports "running" from here, which is what the sidebar reads */
    for (const item of this.sessions) {
      if (this.detachedRunning.has(item.path)) item.status = "running";
    }
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
        thinkingLevels: availableThinkingLevels(model as never),
        thinkingLevelMap: (model as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap,
        source: fromFile ? "models.json" : "builtin",
      } satisfies ModelInfo;
    });
    const rows = this.collapseToChannels(catalogue);
    this.allModels = rows;
    /* Disabling is a desktop-level whitelist kept in pi's own `enabledModels`
       field, where an empty list means "all of them" — the same reading the
       CLI gives it. Every picker in the window draws from `models`, so a
       disabled model leaves all of them at once, while the settings list still
       reads `allModels` and can show the row greyed out. Read once, not per
       row: the settings getter hands back a fresh clone every call. */
    const enabledModels = this.settingsManager.getGlobalSettings().enabledModels;
    this.models = rows.filter((model) => this.patternAllows(enabledModels, model));
  }

  /**
   * Fold the runtime's providers into endpoints, then into one row per model.
   *
   * pi holds exactly one key per provider, so a channel with three keys is
   * stored as three providers carrying the same model list. Presenting that as
   * three models would read as a catalogue three times over, so the list keeps
   * one row per (endpoint, model). The row addresses whichever member actually
   * serves it — the session's own model when there is one, so the row can still
   * be marked current, and otherwise the first provider id, which is what the
   * CLI reaches too.
   */
  private collapseToChannels(catalogue: ModelInfo[]): ModelInfo[] {
    const session = this.runtime?.session;
    this.channelByProvider.clear();
    this.channels = [];
    if (!session) return catalogue;

    const groups = new Map<string, ChannelInfo>();
    for (const provider of session.modelRuntime.getProviders() as unknown as ProviderLike[]) {
      /* one endpoint, several keys: the same identity the writer uses, imported
       * rather than restated, so the file and this list cannot disagree */
      const id = channelIdOf(provider, provider.id);
      this.channelByProvider.set(provider.id, id);
      const existing = groups.get(id);
      if (existing) existing.members.push(provider.id);
      else
        groups.set(id, {
          id,
          name: provider.name ?? provider.id,
          api: provider.api ?? "unknown",
          baseUrl: provider.baseUrl,
          members: [provider.id],
          modelCount: 0,
          custom: this.editableProviders.has(provider.id),
        });
    }
    this.channels = [...groups.values()];

    const current = session.model as { provider?: string; id?: string } | undefined;
    /** the member a row should address: the live one first, then the lowest id */
    const rank = (entry: ModelInfo) =>
      entry.provider === current?.provider && entry.id === current?.id ? 0 : 1;
    const byRow = new Map<string, ModelInfo>();
    for (const model of catalogue) {
      const channelId = this.channelByProvider.get(model.provider) ?? model.provider;
      const row: ModelInfo = { ...model, channelId };
      const key = `${channelId}|${row.id}`;
      const seen = byRow.get(key);
      if (!seen) byRow.set(key, row);
      else if (rank(row) < rank(seen)) byRow.set(key, row);
      else if (rank(row) === rank(seen) && row.provider < seen.provider) byRow.set(key, row);
    }

    const counts = new Map<string, number>();
    for (const row of byRow.values()) {
      const id = row.channelId ?? "";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const group of this.channels) {
      group.members.sort();
      group.modelCount = counts.get(group.id) ?? 0;
    }
    return [...byRow.values()];
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
      const { all: messages, settled } = this.transcript();
      const moved = settled !== this.sentSettled;
      this.sentSettled = settled;
      const tail = messages.slice(settled.length);
      /* Reference equality is the whole test. `settled` is the array handed to
         the renderer last time, so if it has not been rebuilt, everything before
         the streaming message is already on screen and this tick only needs the
         message that moved — or nothing at all, which is the common case for the
         tool and settings events that make up most of a session. */
      this.listener?.({
        state: this.buildState(),
        tools: this.toolActivity(),
        ...(moved ? { messages } : tail.length ? { tail: { at: settled.length, messages: tail } } : {}),
      });
    }, 16);
  }

  private buildState(): HostState {
    const session = this.runtime?.session;
    return {
      cwd: this.cwd,
      workspace: this.workspace,
      homeDir: this.homeDir,
      connected: this.connected,
      error: this.error ?? session?.state.errorMessage,
      sessions: this.sessions,
      models: this.models,
      allModels: this.allModels,
      providers: this.providerRows(),
      channels: this.channels,
      commands: this.commands,
      settings: this.runtimeSettings(),
      todos: this.todos.items,
      plan: this.plan,
      fleet: this.fleet,
      surfaces: this.ui.surfaces(),
      goal: this.goal,
      aside: this.aside,
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

  /**
   * Plan quota for every subscription provider pi is signed in to (Claude
   * Pro/Max, ChatGPT). The token comes from pi's own auth, which refreshes an
   * expired OAuth token, so nothing here touches auth.json. Providers signed
   * in with an API key have no plan and are skipped.
   */
  async planQuota(force = false): Promise<PlanQuota[]> {
    const models = this.runtime?.session.modelRuntime;
    if (!models) return [];
    const quotas: PlanQuota[] = [];
    for (const provider of QUOTA_PROVIDERS) {
      if (!models.isUsingSubscription(provider)) continue;
      const auth = await models.getAuth(provider).catch(() => undefined);
      const token = auth?.auth.apiKey;
      if (!token) continue;
      quotas.push(await providerQuota(provider, token, { force }));
    }
    return quotas;
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
  if (typeof result.content === "string") return result.content.slice(0, 128 * 1024);
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
    .slice(0, 128 * 1024);
}

/** Rough tokens-from-characters. English and code land near 4; a JSON schema is denser. */
function estimateTokens(chars: number): number {
  return chars > 0 ? Math.round(chars / 4) : 0;
}
