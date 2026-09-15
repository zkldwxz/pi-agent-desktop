import type { UiNotification, UiRequest } from "./ui";

export type SessionStatus = "idle" | "running" | "failed" | "done";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  supportsImages: boolean;
  input: string[];
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
  connected: boolean;
  error?: string;
  snapshot: SessionSnapshot | null;
  sessions: SessionListItem[];
  models: ModelInfo[];
  providers: ProviderInfo[];
  commands: SlashCommand[];
  settings: RuntimeSettings;
  /** the agent's task list, maintained through the todo_write tool */
  todos: TodoItemView[];
  /** every tool the session exposes, including extension-registered ones */
  tools: string[];
  queue: QueueState;
}

/* ── plugins ─────────────────────────────────────────────── */

export type PluginKind = "extension" | "package" | "skill" | "prompt" | "theme";
export type PluginScope = "global" | "project" | "configured";

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
  messages: ChatMessage[];
  tools: ToolActivity[];
}

/* ── desktop config + installable catalogue ─────────────── */

export interface DesktopConfig {
  capabilities: { browser: boolean; todos: boolean };
  onboardingDone: boolean;
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
    };
