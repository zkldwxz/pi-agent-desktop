import type { ChatMessage, HostState, ModelInfo, ToolActivity } from "@shared/types";
import type { BrowserState } from "@shared/browser";
import type { FileContent, FileEntry } from "@shared/workspace";

/**
 * Browser preview bridge.
 *
 * The real renderer talks to Electron through `window.pi`, which a plain
 * browser tab does not have — the dev URL would white-screen. When the bridge
 * is missing and the app is running on http instead of `file:`, this installs
 * a stand-in backed by a fixture, so the whole UI can be iterated in a normal
 * browser at localhost:5173 without the Electron shell.
 *
 * Nothing here ships into the packaged app: the guard only fires without
 * `window.pi`, which only happens outside Electron.
 */

const model = (id: string, name: string, provider: string, reasoning = true): ModelInfo => ({
  id,
  name,
  provider,
  providerName: provider,
  contextWindow: 1_000_000,
  maxTokens: 64_000,
  reasoning,
  supportsImages: true,
  input: ["text", "image"],
  thinkingLevels: reasoning ? ["off", "low", "medium", "high", "max"] : ["off"],
  cost: { input: 0.5, output: 1.5, cacheRead: 0.1, cacheWrite: 0.2 },
  source: "models.json",
});

const MODELS: ModelInfo[] = [
  model("deepseek-v4-flash", "DeepSeek V4 Flash 1M", "deepseek"),
  model("deepseek-v4-pro", "DeepSeek V4 Pro 1M", "deepseek"),
  model("glm-5.3", "GLM 5.3 1M", "opcc"),
  model("kimi-k3", "Kimi K3 1M", "opcc"),
  model("claude-sonnet-4.5", "Claude Sonnet 4.5", "anthropic"),
  model("gpt-5.2-codex", "GPT-5.2 Codex", "openai"),
  model("gemini-3.8-flash", "Gemini 3.8 Flash 1M", "google"),
];

const now = Date.now();

const MESSAGES: ChatMessage[] = [
  {
    key: "u1",
    role: "user",
    timestamp: now - 11 * 60_000,
    text: "把 settings 里的模型列表整理一下，顺便看看 @ 引用能不能搜整个工作区。",
    blocks: [],
  },
  {
    key: "a1t",
    role: "assistant",
    timestamp: now - 10.5 * 60_000,
    text: "",
    blocks: [
      {
        type: "thinking",
        text: "先看 settings 的数据来源，再决定列表怎么分组。模型行重复的 Default level 前缀应该收进分组标题。",
      },
      { type: "toolCall", id: "t1", name: "grep", arguments: { pattern: "Default level", path: "src" } },
      { type: "toolCall", id: "t2", name: "read", arguments: { file_path: "src/renderer/src/views/SettingsView.tsx", limit: 120 } },
    ],
  },
  {
    key: "r1",
    role: "toolResult",
    timestamp: now - 10 * 60_000,
    text: "src/renderer/src/views/SettingsView.tsx:364: title={`Default level · ${key}`}",
    blocks: [],
    toolName: "grep",
    toolCallId: "t1",
  },
  {
    key: "r2",
    role: "toolResult",
    timestamp: now - 9.6 * 60_000,
    text: "…18 model rows, each repeating the same hint…",
    blocks: [],
    toolName: "read",
    toolCallId: "t2",
  },
  {
    key: "a1",
    role: "assistant",
    timestamp: now - 9 * 60_000,
    text: "模型列表的问题找到了：18 行各自重复一次 `Default level ·` 前缀和同样的提示，扫读成本很高。我把它们收进一个分组标签，键名用等宽字体。\n\n@ 引用目前只从会话读过的文件里取十个——我加一个受限的工作区遍历，按层数（8 层）和数量（4000 个）封顶，跳过 `node_modules`、`.git` 这些目录。BFS 顺序保证浅层文件排在前面。",
    blocks: [
      { type: "thinking", text: "两个改动都不大，但要确认 @ 菜单的高度上限——之前它会无限增高。" },
      {
        type: "toolCall",
        id: "t3",
        name: "edit",
        arguments: { file_path: "src/renderer/src/views/SettingsView.tsx" },
      },
    ],
  },
  {
    key: "r3",
    role: "toolResult",
    timestamp: now - 8.4 * 60_000,
    text: "Applied 1 hunk",
    blocks: [],
    toolName: "edit",
    toolCallId: "t3",
    toolDetails: {
      patch: [
        "@@ -361,7 +361,9 @@",
        "             </Row>",
        "-            {modelKeys.map((key) => (",
        "-              <Row key={key} title={`Default level · ${key}`} hint=\"per-model override\">",
        "+            <div className=\"border-b border-line px-4 py-1.5 text-[10.5px] text-ink-3 uppercase\">",
        "+              Per-model overrides",
        "+            </div>",
        "+            {modelKeys.map((key) => (",
        "+              <Row key={key} title={key} mono>",
      ].join("\n"),
    },
  },
  {
    key: "u2",
    role: "user",
    timestamp: now - 4 * 60_000,
    text: "setting 页面还有哪些地方不对劲？",
    blocks: [],
  },
  {
    key: "u3",
    role: "user",
    timestamp: now - 40_000,
    text: "顺手把 dock 的高度上限也检查一下。",
    blocks: [],
  },
  {
    key: "a3",
    role: "assistant",
    timestamp: now - 20_000,
    text: "",
    blocks: [
      {
        type: "thinking",
        text:
          "先看 dock 的 tab 条实现，确认它是不是把面板高度写死了。\n\n接着检查 Popover 的 max-height——模型菜单那次修过同样的毛病，dock 可能也有。\n\n最后跑一次 typecheck 确认没有类型回归。",
      },
      { type: "toolCall", id: "t9", name: "read", arguments: { file_path: "src/renderer/src/components/panel/ToolDock.tsx" } },
    ],
  },
  {
    key: "a2",
    role: "assistant",
    timestamp: now - 2 * 60_000,
    text: "还有三处：\n\n1. **行高**：设置行现在是 `py-3.5`，比 VS Code 松，但比之前的 `py-2.5` 好读，保持。\n2. **搜索框**：能过滤分类，但不会高亮命中项——属于下一步。\n3. **Usage 面板**：宽度限制在 1100px，图表在 2K 屏上偏窄。\n\n需要我继续调整哪一处？",
    blocks: [{ type: "thinking", text: "先把能一眼看出来的记下来，别展开成大改。" }],
    usage: { input: 12_400, output: 486, total: 12_886, cacheRead: 11_020, model: "DeepSeek V4 Flash", provider: "deepseek" },
  },
];

const TOOLS: ToolActivity[] = [
  {
    toolCallId: "live1",
    toolName: "bash",
    args: { command: "npm run typecheck" },
    status: "running",
    startedAt: now - 9_000,
  },
];

const STATE: HostState = {
  cwd: "F:/Projects/pi-agent-desktop",
  connected: true,
  snapshot: {
    sessionId: "preview",
    sessionFile: "preview.jsonl",
    sessionName: "Settings polish and @ search",
    cwd: "F:/Projects/pi-agent-desktop",
    model: MODELS[0],
    thinkingLevel: "high",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    isStreaming: true,
    isIdle: false,
    isCompacting: false,
    messageCount: MESSAGES.length,
    pendingMessageCount: 0,
    stats: {
      tokens: { input: 128_400, output: 9_820, cacheRead: 121_600, cacheWrite: 4_120, total: 138_220 },
      cost: 0.42,
      contextUsage: { tokens: 128_400, contextWindow: 1_000_000, percent: 12.8 },
    },
  },
  sessions: [
    { path: "s1", id: "s1", cwd: "F:/Projects/pi-agent-desktop", created: "", modified: new Date(now - 60_000).toISOString(), messageCount: 24, firstMessage: "把 settings 里的模型列表整理一下", status: "running" },
    { path: "s2", id: "s2", cwd: "F:/Projects/pi-agent-desktop", created: "", modified: new Date(now - 40 * 60_000).toISOString(), messageCount: 12, firstMessage: "composer 的高度改一下", status: "done" },
    { path: "s3", id: "s3", cwd: "F:/Projects/pi-agent-desktop", created: "", modified: new Date(now - 26 * 3_600_000).toISOString(), messageCount: 41, firstMessage: "工具行改成 Ran 2 commands", status: "done" },
    { path: "s4", id: "s4", cwd: "F:/Projects/yizhanyan", created: "", modified: new Date(now - 2 * 3_600_000).toISOString(), messageCount: 8, firstMessage: "dev 域名的验证取消掉", status: "done" },
    { path: "s5", id: "s5", cwd: "F:/Projects/JxAPI", created: "", modified: new Date(now - 5 * 3_600_000).toISOString(), messageCount: 33, firstMessage: "docker 缓存清理一下", status: "done" },
    { path: "s6", id: "s6", cwd: "E:/Project/Python/2026.5/baidu/baidu-suite", created: "", modified: new Date(now - 4 * 86_400_000).toISOString(), messageCount: 64, firstMessage: "接口文档同步一下", status: "idle" },
  ],
  models: MODELS,
  providers: MODELS.map((entry, index) => ({
    id: entry.provider,
    name: entry.provider,
    api: "openai-completions",
    modelCount: index < 2 ? 4 : 3,
    hasAuth: true,
    editable: true,
  })),
  commands: [
    { name: "compact", description: "Compact the context window", source: "builtin" },
    { name: "review", description: "Review the current diff", source: "extension" },
  ],
  settings: {
    blockImages: false,
    imageAutoResize: true,
    defaultThinkingLevel: "high",
    modelThinkingLevels: {},
    compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 2_000 },
    showCacheMissNotices: false,
    hideThinkingBlock: false,
  },
  todos: [],
  tools: ["read", "edit", "write", "bash", "grep", "todo_write"],
  queue: { steering: [], followUp: [], steeringMode: "all", followUpMode: "all" },
};

const BROWSER: BrowserState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  devtoolsOpen: false,
  designMode: false,
};

/** Files the preview's @ menu can offer without touching the disk. */
const TREE: Record<string, FileEntry[]> = {
  "": [
    { path: "src", name: "src", kind: "dir" },
    { path: "package.json", name: "package.json", kind: "file", size: 1_820 },
    { path: "README.md", name: "README.md", kind: "file", size: 4_200 },
  ],
  src: [
    { path: "src/renderer", name: "renderer", kind: "dir" },
    { path: "src/main", name: "main", kind: "dir" },
    { path: "src/shared", name: "shared", kind: "dir" },
  ],
  "src/renderer": [
    { path: "src/renderer/src", name: "src", kind: "dir" },
  ],
  "src/renderer/src": [
    { path: "src/renderer/src/App.tsx", name: "App.tsx", kind: "file", size: 28_400 },
    { path: "src/renderer/src/index.css", name: "index.css", kind: "file", size: 12_100 },
    { path: "src/renderer/src/components", name: "components", kind: "dir" },
    { path: "src/renderer/src/views", name: "views", kind: "dir" },
  ],
  "src/renderer/src/components": [
    { path: "src/renderer/src/components/MessageThread.tsx", name: "MessageThread.tsx", kind: "file", size: 14_200 },
    { path: "src/renderer/src/components/TitleBar.tsx", name: "TitleBar.tsx", kind: "file", size: 5_100 },
  ],
  "src/renderer/src/views": [
    { path: "src/renderer/src/views/SettingsView.tsx", name: "SettingsView.tsx", kind: "file", size: 22_600 },
  ],
  "src/main": [
    { path: "src/main/index.ts", name: "index.ts", kind: "file", size: 19_800 },
    { path: "src/main/pi-host.ts", name: "pi-host.ts", kind: "file", size: 24_300 },
  ],
  "src/shared": [{ path: "src/shared/types.ts", name: "types.ts", kind: "file", size: 8_900 }],
};

const PREVIEW_FILES = [
  "src/renderer/src/App.tsx",
  "src/renderer/src/components/MessageThread.tsx",
  "src/renderer/src/views/SettingsView.tsx",
  "src/main/pi-host.ts",
  "package.json",
];

export function installPreviewBridge(): void {
  const w = window as unknown as { pi?: unknown };
  if (w.pi) return;
  /* only inside a browser tab served over http — never inside Electron */
  if (!/^https?:$/.test(window.location.protocol)) return;

  const listeners = new Set<(payload: unknown) => void>();
  const payload = () => ({
    state: STATE,
    messages: MESSAGES,
    tools: TOOLS,
    uiRequest: null,
    notifications: [],
  });

  const unsub = () => () => {};
  const table: Record<string, (...args: never[]) => unknown> = {
    getState: async () => payload(),
    onUpdate: ((fn: (payload: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }) as never,
    listAllSessions: async () => STATE.sessions,
    listDir: async (dirPath: string) =>
      ({ path: dirPath, entries: TREE[dirPath?.replace(STATE.cwd, "").replace(/^[\\/]/, "") ?? ""] ?? [] }),
    searchFiles: async () => PREVIEW_FILES.map((path) => ({ path, modified: 0 })),
    readFile: async (filePath: string) => ({
      path: filePath,
      name: filePath.split("/").pop() ?? filePath,
      lang: "ts",
      text: "// preview fixture\n",
      size: 18,
      truncated: false,
      binary: false,
    }),
    getDesktopConfig: async () => ({ onboardingDone: true, cwd: STATE.cwd }),
    getPlugins: async () => [],
    getUsage: async () => ({
      generatedAt: new Date().toISOString(),
      range: { from: null, to: null, days: 30 },
      totals: { total: 12_840_000, input: 3_120_000, output: 486_000, cacheRead: 9_180_000, cacheWrite: 54_000, cost: 18.42, calls: 1_284 },
      kpis: { sessions: 42, messages: 1_284, activeDays: 18, currentStreak: 5, longestStreak: 11, peakHour: 15, favoriteModel: "DeepSeek V4 Flash" },
      days: Array.from({ length: 30 }, (_, i) => ({
        day: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
        total: 120_000 + Math.round(Math.sin(i / 3) * 60_000) + i * 4_000,
        input: 40_000 + i * 900,
        output: 6_000 + i * 120,
        cacheRead: 70_000 + i * 2_400,
        cacheWrite: 2_000,
        cost: 0.4 + i * 0.03,
        calls: 20 + i,
      })),
      hours: Array.from({ length: 24 }, (_, h) => (h > 8 && h < 23 ? 40 + ((h * 37) % 60) : 4)),
      models: [
        { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek V4 Flash", total: 6_400_000, input: 1_500_000, output: 220_000, cacheRead: 4_600_000, cacheWrite: 26_000, cost: 8.1, calls: 720 },
        { provider: "opcc", model: "glm-5.3", label: "GLM 5.3", total: 3_900_000, input: 980_000, output: 160_000, cacheRead: 2_700_000, cacheWrite: 18_000, cost: 5.4, calls: 402 },
        { provider: "anthropic", model: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", total: 2_540_000, input: 640_000, output: 106_000, cacheRead: 1_880_000, cacheWrite: 10_000, cost: 4.9, calls: 162 },
      ],
      providers: [
        { provider: "deepseek", label: "deepseek", total: 6_400_000, cost: 8.1, calls: 720, cacheRead: 4_600_000, cacheHitRate: 0.72 },
        { provider: "opcc", label: "opcc", total: 3_900_000, cost: 5.4, calls: 402, cacheRead: 2_700_000, cacheHitRate: 0.68 },
        { provider: "anthropic", label: "anthropic", total: 2_540_000, cost: 4.9, calls: 162, cacheRead: 1_880_000, cacheHitRate: 0.71 },
      ],
      cache: { read: 9_180_000, write: 54_000, input: 3_120_000, hitRate: 0.72, saved: 12.6 },
      cacheByChannel: [
        { provider: "deepseek", model: "deepseek-v4-flash", calls: 720, tokens: 6_400_000, input: 1_500_000, output: 220_000, cacheRead: 4_600_000, cacheWrite: 26_000, cacheHitRate: 0.72, cost: 8.1 },
        { provider: "opcc", model: "glm-5.3", calls: 402, tokens: 3_900_000, input: 980_000, output: 160_000, cacheRead: 2_700_000, cacheWrite: 18_000, cacheHitRate: 0.68, cost: 5.4 },
        { provider: "anthropic", model: "claude-sonnet-4.5", calls: 162, tokens: 2_540_000, input: 640_000, output: 106_000, cacheRead: 1_880_000, cacheWrite: 10_000, cacheHitRate: 0.71, cost: 4.9 },
      ],
      deviations: [],
      buckets: [
        { key: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", total: 6_400_000, input: 1_500_000, output: 220_000, cacheRead: 4_600_000, cacheWrite: 26_000, cost: 8.1, calls: 720 },
        { key: "opcc/glm-5.3", label: "GLM 5.3", total: 3_900_000, input: 980_000, output: 160_000, cacheRead: 2_700_000, cacheWrite: 18_000, cost: 5.4, calls: 402 },
      ],
      sessionCount: 42,
      messageCount: 1_284,
      scannedFiles: 96,
      errors: [],
    }),
    getContextBreakdown: async () => ({ parts: [], used: null, contextWindow: 0, percent: null }),
    getZoomFactor: () => 1,
    setZoomFactor: () => undefined,
    getBrowserState: () => BROWSER,
    onBrowserPick: () => unsub(),
    onTerminalChunk: () => unsub(),
    onNotice: () => unsub(),
    bashState: async () => ({ running: false }),
  };

  const bridge = new Proxy(table, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      // subscription methods must return an unsubscribe function, not a promise
      if (typeof prop === "string" && prop.startsWith("on")) return () => () => {};
      // everything else is an async command with no effect in the preview
      return async () => undefined;
    },
  });

  w.pi = bridge;
}
