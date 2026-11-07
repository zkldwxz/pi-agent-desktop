import type { UiNotification, UiRequest } from "./ui";

export type SessionStatus = "idle" | "running" | "failed" | "done";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  /** the wire protocol this model is actually reached over */
  api?: string;
  /** the endpoint this row stands for — several keys, one row; see ChannelInfo */
  channelId?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  supportsImages: boolean;
  input: string[];
  /** the depths this model can take */
  thinkingLevels: string[];
  thinkingLevelMap?: Record<string, string | null>;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  source: "builtin" | "models.json" | "extension";
}

/** The agent-team plugin's sub-agents, as the desktop mirrors them. */
export interface FleetAgent {
  name: string;
  status: "running" | "completed" | "interrupted" | "errored";
  /** one line of the spawn message — what this agent is doing */
  task: string;
  model?: string;
  thinkingLevel?: string;
  spawnedAt: number;
  endedAt?: number;
  tokens?: { input: number; output: number; total: number };
  cost?: number;
  /** the sub-agent's final answer, truncated for display */
  summary?: string;
}

/** Settings for the delegation fleet; shared with the agent-team plugin via
 *  desktop.json so the CLI and the window run one configuration. */
export interface AgentsConfig {
  /** how many sub-agents may run at once */
  maxConcurrent: number;
  /** when the parent agent is idle and a sub-agent finishes, wake it with
   *  the result (starts a new turn) instead of waiting for wait_agent */
  wakeOnCompletion: boolean;
}


/** Editable slice of a model — safe to send to the renderer (no API keys). */
export interface ModelEdit {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  api: string;
  baseUrl?: string;
  modelCount: number;
  hasAuth: boolean;
  editable: boolean;
}

/**
 * The wire protocol a channel speaks.
 *
 * These are pi's own `api` literals for the three protocols the desktop offers a
 * form for. A hand-written provider may name another one, so everywhere a
 * protocol is *read* the field stays a plain string.
 */
export type ChannelApi = "openai-completions" | "anthropic-messages" | "google-generative-ai";

/**
 * One endpoint, seen the way the user sees it rather than the way pi stores it.
 *
 * pi keys credentials by provider id and holds exactly one key per provider, so
 * a channel with several keys is written as several provider entries that share
 * `api` and `baseUrl`. The channel is that group: `members` are the provider ids,
 * and each member is one key.
 */
export interface ChannelInfo {
  /** `${api}|${baseUrl}` for an endpoint the desktop wrote; otherwise the
   *  built-in provider's own id, which keeps pi's shipped providers from
   *  collapsing into one channel just because they share a host */
  id: string;
  name: string;
  api: string;
  baseUrl?: string;
  /** the provider ids behind this endpoint — one per configured key */
  members: string[];
  modelCount: number;
  /** false for the providers pi ships, whose key the desktop does not own */
  custom: boolean;
}

/** What "new channel" collects: one endpoint and the keys allowed to use it. */
export interface ChannelEdit {
  name: string;
  api: ChannelApi;
  baseUrl: string;
  keys: string[];
}

export interface SessionListItem {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  status: SessionStatus;
}

export interface SessionSnapshot {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  cwd: string;
  model: ModelInfo | null;
  thinkingLevel: string;
  thinkingLevels: string[];
  isStreaming: boolean;
  isIdle: boolean;
  isCompacting: boolean;
  errorMessage?: string;
  messageCount: number;
  pendingMessageCount: number;
  stats?: SessionStatsSnapshot;
}

/**
 * A `/btw` question, beside the conversation.
 *
 * The aside is its own session — same workspace, its own file — so asking
 * there never lands in the transcript you are reading. The window keeps only
 * the question and the answer; the session itself sits in the sidebar history
 * like any other.
 */
export interface AsideState {
  question: string;
  /** the settled answer; empty while the aside is still working */
  answer: string;
  running: boolean;
  error?: string;
}

export interface SessionStatsSnapshot {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

/**
 * What is filling the context window.
 *
 * The pieces the session contributes before the user has typed anything — the
 * system prompt, the tool schemas, the skill instructions — plus how much of the
 * window the live conversation is using. Sizes only: the dashboard this feeds
 * deliberately carries no percentages, because the only number that matters is
 * how many tokens a part costs.
 */
export interface ContextBreakdown {
  parts: ContextPart[];
  /** tokens in the window right now, when the session can report them */
  used: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ContextPart {
  key: string;
  label: string;
  /** estimated tokens — characters ÷ 4 is the estimate the panel labels as such */
  tokens: number;
  /** a short qualifier, e.g. "34 tools" or the source file */
  detail?: string;
}

/** One step of a plan the agent wrote with `create_plan`. */
export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  /** the files or commands the step touches, shown when the row is expanded */
  detail?: string;
}

/**
 * What the plan-mode extension is doing right now.
 *
 * Eight bits of mirrored state: every transition is published by the extension
 * over pi's event bus and lands here. `phase` is the whole state machine —
 * `off` is normal work, `planning` is read-only research, `review` waits for a
 * decision on a written plan, `executing` is the approved plan being worked.
 */
export interface PlanState {
  phase: "off" | "planning" | "review" | "executing";
  /** the plan file on disk, once one exists */
  path?: string;
  title?: string;
  notes?: string;
  steps: PlanStep[];
  /** the model that wrote the plan — what Build falls back to */
  parentModel?: { provider: string; id: string };
  updatedAt: number;
}

/** A status line or widget an extension pushed up, with the ANSI stripped. */
export interface ExtensionSurface {
  key: string;
  kind: "status" | "widget";
  text: string;
  lines?: string[];
}

export interface SlashCommand {
  name: string;
  description?: string;
  source: string;
}

export interface RuntimeSettings {
  blockImages: boolean;
  imageAutoResize: boolean;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  modelThinkingLevels: Record<string, string>;
  thinkingBudgets?: Record<string, number>;
  enabledModels?: string[];
  defaultTools?: string[];
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
  showCacheMissNotices: boolean;
  hideThinkingBlock: boolean;
  /** shell the agent runs commands in — the Shell panel uses the same one */
  shellPath?: string;
  shellCommandPrefix?: string;
  npmCommand?: string[];
  /** delegation fleet settings — stored in desktop.json, shared with the plugin */
  agents?: AgentsConfig;
  /** the terminal pane's shell choice — desktop.json, mirrored here for the settings UI */
  terminal?: { preferred: string; customPath?: string };
}

export interface TodoItemView {
  id: string;
  label: string;
  amount: string;
  status: "pending" | "running" | "done" | "failed";
  details: { label: string; meta: string }[];
}

/** Messages waiting while the agent runs. Steering interrupts; follow-up waits. */
export interface QueueState {
  steering: string[];
  followUp: string[];
  /** how a new message is delivered while streaming */
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
}

export interface HostState {
  cwd: string;
  /** All project roots attached to this conversation, including remote identity. */
  workspace?: import("./workspaces").WorkspaceInfo;
  /** The canonical OS home directory used by the Home/no-project workspace. */
  homeDir: string;
  connected: boolean;
  error?: string;
  snapshot: SessionSnapshot | null;
  sessions: SessionListItem[];
  /** the models a picker may offer — disabled ones are already filtered out */
  models: ModelInfo[];
  /** every model the runtime knows, disabled ones included; the settings list
   *  shows them greyed rather than hiding them */
  allModels?: ModelInfo[];
  providers: ProviderInfo[];
  /** the providers folded back into endpoints: one channel, possibly several keys */
  channels: ChannelInfo[];
  commands: SlashCommand[];
  settings: RuntimeSettings;
  /** the agent's task list, maintained through the todo_write tool */
  todos: TodoItemView[];
  /** every tool the session exposes, including extension-registered ones */
  tools: string[];
  queue: QueueState;
  /** plan mode, as the plan-mode extension reports it */
  plan: PlanState;
  /** the delegation fleet, as the agent-team extension reports it */
  fleet: FleetAgent[];
  /** status lines and widgets other extensions pushed up */
  surfaces: ExtensionSurface[];
  /** the session goal (`/goal`), carried into the system prompt while set */
  goal?: string | null;
  /** a `/btw` aside question and its answer */
  aside?: AsideState | null;
}

/* ── plugins ─────────────────────────────────────────────── */

export type PluginKind = "extension" | "package" | "skill" | "prompt" | "theme";
export type PluginScope = "global" | "project" | "configured";

/** Where the agent looks for plugins, so the UI can name and open the folders. */
export interface PluginRoots {
  agentDir: string;
  globalExtensions: string;
  projectExtensions: string;
  /** the same path with ~ in front of it, for display */
  globalExtensionsLabel: string;
  projectExtensionsLabel: string;
}

export interface PluginInfo {
  id: string;
  kind: PluginKind;
  name: string;
  description?: string;
  path: string;
  scope: PluginScope;
  enabled: boolean;
  /** false when the plugin is declared in settings and cannot be toggled by moving files */
  toggleable: boolean;
  /**
   * False when there is no file to move to the trash: entries that only exist
   * as a line in settings.json have nothing to delete, and deleting the path
   * they point at would be a surprise. Separate from `toggleable` because
   * prompts, skills and themes are real files you can delete but never toggle
   * — the old code reused `toggleable` for both and greyed out the trash icon
   * on every rule the user had just created.
   */
  removable: boolean;
  sizeBytes?: number;
  modified?: string;
  error?: string;
}

/* ── usage / cache ───────────────────────────────────────── */

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  reasoning: number;
}

export interface UsageModelRow extends UsageTotals {
  provider: string;
  providerName: string;
  model: string;
  calls: number;
  cacheRate: number;
  firstUsed: string;
  lastUsed: string;
  medianTokensPerCall: number;
}

export interface UsageProviderRow extends UsageTotals {
  provider: string;
  providerName: string;
  calls: number;
  models: number;
  cacheRate: number;
}

export interface UsageDeviation {
  date: string;
  tokens: number;
  calls: number;
  cacheRate: number;
  cost: number;
}

/** One (day, hour, provider, model) aggregate. Small enough to ship to the
 *  renderer, and rich enough to drill into any slice of the timeline. */
export interface UsageBucket {
  date: string;
  hour: number;
  provider: string;
  providerName: string;
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

export interface UsagePerModel {
  provider: string;
  providerName: string;
  model: string;
  calls: number;
  cacheHitRate: number;
  tokens: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageCacheStats {
  cacheRead: number;
  cacheWrite: number;
  freshInput: number;
  hitRate: number;
  savedTokens: number;
  byModel: UsagePerModel[];
}

export interface UsageDay {
  date: string;
  calls: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface UsageStats {
  generatedAt: string;
  range: { from: string | null; to: string | null; days: number };
  totals: UsageTotals;
  kpis: {
    sessions: number;
    messages: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    peakHour: number | null;
    favoriteModel: string | null;
  };
  days: UsageDay[];
  hours: number[];
  models: UsageModelRow[];
  providers: UsageProviderRow[];
  cache: UsageCacheStats;
  /** per-model, per-provider cache split (the "按渠道分开统计" view) */
  cacheByChannel: UsagePerModel[];
  deviations: UsageDeviation[];
  buckets: UsageBucket[];
  sessionCount: number;
  messageCount: number;
  scannedFiles: number;
  errors: string[];
}

/* ── ipc envelope ────────────────────────────────────────── */

export type ChatBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "image"; mimeType: string };

export interface ChatMessage {
  key: string;
  role: "user" | "assistant" | "toolResult" | "bashExecution" | "custom" | "compaction" | "branch";
  timestamp: number;
  text: string;
  blocks: ChatBlock[];
  /**
   * The extension that wrote a `custom` message, verbatim. The transcript reads
   * it to place a turn boundary: plan mode's build is a second task, and the
   * only record of where the first one ended is the message the extension sent
   * to start it. Dropped for every other role.
   */
  customType?: string;
  toolName?: string;
  toolCallId?: string;
  /** tool-specific metadata (edit diffs, read ranges, search hits) */
  toolDetails?: unknown;
  isError?: boolean;
  streaming?: boolean;
  usage?: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheWrite?: number;
    /** what this answer cost, as the provider priced it */
    cost?: number;
    model?: string;
    provider?: string;
  };
}

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error";
  resultText?: string;
  /** tool-specific metadata, forwarded so the UI can render diffs and ranges */
  details?: unknown;
  startedAt: number;
  endedAt?: number;
}

export interface PromptPayload {
  text: string;
  streamingBehavior?: "steer" | "followUp";
  /** attached images — a design-mode pick sends the cropped component here */
  images?: { type: "image"; data: string; mimeType: string }[];
}

export interface HostUpdate {
  /** a pending extension dialog, if any */
  uiRequest?: UiRequest | null;
  notifications?: UiNotification[];
  state: HostState;
  /**
   * The transcript, in one of two shapes.
   *
   * `messages` replaces the whole list, and is sent whenever the settled part
   * moved: a new turn, a session switch, a compaction, an edit. While an answer
   * streams only its last message moves, so `tail` carries that one message and
   * `at` says where it belongs. The transcript is the largest thing on this
   * channel and it grows with the session — re-sending all of it every 16ms is
   * the most expensive thing the shell does, and the cost scales with how long
   * the conversation has been open, which is exactly the wrong direction.
   */
  messages?: ChatMessage[];
  tail?: { at: number; messages: ChatMessage[] };
  tools: ToolActivity[];
}

/** What `getState` answers with. A renderer that has nothing to show yet is
 *  never given a delta to apply to it, so the first payload always carries the
 *  whole transcript. */
export type HostSnapshot = HostUpdate & { messages: ChatMessage[] };

/* ── desktop config + installable catalogue ─────────────── */

export interface DesktopConfig {
  capabilities: { browser: boolean; todos: boolean };
  onboardingDone: boolean;
  /** the model Build last ran with; written when the user picks one */
  buildModel?: { provider: string; id: string };
  /** delegation fleet settings — the agent-team plugin reads the same block */
  agents: AgentsConfig;
  /** the terminal pane's shell choice, as shells.ts defines it */
  terminal: { preferred: string; customPath?: string };
  /** bundled extensions the user deleted on purpose — the startup sync must
   *  not reinstall them behind their back */
  removedBundledExtensions?: string[];
  /** the name the account row and avatar show; falls back to the OS user */
  userName?: string;
}

/**
 * The plan-mode buttons, as one message.
 *
 * Plan mode is a plugin, so the window does not implement it — it presses the
 * plugin's subcommands. `model` is the one piece of state that has to be
 * carried alongside: the build runs on the model the user chose in the picker.
 */
export interface PlanAction {
  action: "toggle" | "build" | "cancel" | "refine";
  note?: string;
  model?: { provider: string; id: string };
}

export type CatalogItem =
  | { id: string; kind: "skill"; name: string; description: string; installed: boolean }
  | {
      id: string;
      kind: "capability";
      name: string;
      description: string;
      installed: boolean;
      /** a capability cannot be applied without rebuilding the agent session */
      needsReload: boolean;
    }
  /** an extension file copied out of the app and into the agent's plugin folder,
   *  where the CLI picks up the very same copy */
  | { id: string; kind: "extension"; name: string; description: string; installed: boolean };
