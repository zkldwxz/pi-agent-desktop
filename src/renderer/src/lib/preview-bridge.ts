import type {
  CatalogItem,
  ChannelEdit,
  ChatMessage,
  HostState,
  ModelInfo,
  PlanAction,
  PluginInfo,
  ToolActivity,
  UsageBucket,
  UsageCacheStats,
  UsageDay,
  UsageDeviation,
  UsageModelRow,
  UsagePerModel,
  UsageProviderRow,
  UsageStats,
  UsageTotals,
} from "@shared/types";
import { cacheHitRate } from "@shared/cache-usage";
import { endpointId } from "@shared/channel";
import type { McpServerView } from "@shared/mcp";
import type { BrowserState } from "@shared/browser";
import type { AppOpener, FileContent, FileEntry } from "@shared/workspace";

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

/**
 * Rules for the browser preview, keyed by path like the host's own map.
 *
 * The generic proxy below answers unknown methods with `undefined`, which makes
 * the rules editor open a blank file and drop every save; a real fixture is the
 * only way to iterate that screen in a plain browser tab. Deleting edits this
 * map instead of the disk, and the list is derived from it, so list and editor
 * cannot disagree.
 */
const PREVIEW_RULES = new Map<string, { scope: "global" | "project"; body: string }>([
  [
    "~/.pi/agent/prompts/review-checklist.md",
    {
      scope: "global",
      body: "# Review checklist\n\nEvery change gets the same pass, in this order:\n\n1. Does it change behaviour? Then it needs a regression check.\n2. Does it touch the IPC bridge? Then both ends move together.\n3. Does it add UI text? Then the i18n dictionary gets the string.\n",
    },
  ],
  [
    "~/.pi/agent/prompts/commit-style.md",
    {
      scope: "global",
      body: "# Commit style\n\nSubject line in the imperative, no trailing period, one line.\n",
    },
  ],
  [
    "F:/Projects/pi-agent-desktop/.pi/prompts/desktop-notes.md",
    {
      scope: "project",
      body: "# Desktop notes\n\nThis checkout is the Electron shell, not the agent itself.\n",
    },
  ],
]);

/**
 * The plugin list the preview shows: the rules above, plus one theme.
 *
 * The theme is here on purpose — a theme is a file-backed resource like a rule,
 * and the Customize screen has to keep it out of the Rules tab while still
 * listing it somewhere.
 */
function previewPlugins(): PluginInfo[] {
  return [
    ...[...PREVIEW_RULES.entries()].map(([path, rule]) => ({
      id: `preview:prompt:${path}`,
      kind: "prompt" as const,
      name: path.split("/").pop()!.replace(/\.md$/, ""),
      path,
      scope: rule.scope,
      enabled: true,
      toggleable: false,
      removable: true,
      sizeBytes: rule.body.length,
    })),
    {
      id: "preview:theme:~/.pi/agent/themes/pi-dark.json",
      kind: "theme" as const,
      name: "pi-dark",
      description: "A terminal palette, loaded by pi like an extension",
      path: "~/.pi/agent/themes/pi-dark.json",
      scope: "global" as const,
      enabled: true,
      toggleable: false,
      removable: true,
      sizeBytes: 812,
    },
  ];
}

/**
 * MCP servers for the browser preview.
 *
 * One of each transport, one disabled entry and one that never connects, so the
 * list shows every state the screen can draw. `getMcpConnected` answers with the
 * enabled ones, which is what makes the green pill appear; deleting and saving
 * edit this object instead of a file.
 */
const PREVIEW_MCP = {
  servers: [
    {
      name: "filesystem",
      scope: "global",
      file: "~/.pi/agent/mcp.json",
      config: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
      enabled: true,
      exposure: "codemode",
    },
    {
      name: "docs",
      scope: "global",
      file: "~/.pi/agent/mcp.json",
      config: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } },
      enabled: true,
      exposure: "codemode",
    },
    {
      name: "sentry",
      scope: "project",
      file: "F:/Projects/pi-agent-desktop/.pi/mcp.json",
      config: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      enabled: true,
      exposure: "direct",
    },
    {
      name: "scratch",
      scope: "global",
      file: "~/.pi/agent/mcp.json",
      config: { type: "stdio", command: "uvx", args: ["scratch-mcp"] },
      enabled: false,
      exposure: "codemode",
    },
  ] as McpServerView[],
  errors: [] as string[],
  autoEnableCodemode: true,
};

const model = (
  id: string,
  name: string,
  provider: string,
  reasoning = true,
  options: { vision?: boolean; contextWindow?: number } = {},
): ModelInfo => {
  const vision = options.vision ?? true;
  const thinkingLevels = reasoning ? ["off", "low", "medium", "high", "xhigh", "max"] : ["off"];
  return {
    id,
    name,
    provider,
    providerName: provider,
    contextWindow: options.contextWindow ?? 1_000_000,
    maxTokens: 64_000,
    reasoning,
    supportsImages: vision,
    input: vision ? ["text", "image"] : ["text"],
    /* the whole ramp, because that is what a reasoning model offers here */
    thinkingLevels,
    cost: { input: 0.5, output: 1.5, cacheRead: 0.1, cacheWrite: 0.2 },
    source: "models.json",
  };
};

const MODELS: ModelInfo[] = [
  model("deepseek-v4-flash", "DeepSeek V4 Flash 1M", "deepseek"),
  model("deepseek-v4-pro", "DeepSeek V4 Pro 1M", "deepseek"),
  model("deepseek-r1", "DeepSeek R1", "deepseek", true, { vision: false, contextWindow: 128_000 }),
  model("glm-5.3", "GLM 5.3 1M", "opcc", true, { vision: false }),
  model("glm-5.3-flash", "GLM 5.3 Flash 1M", "opcc"),
  model("kimi-k3", "Kimi K3 1M", "opcc"),
  model("claude-sonnet-4.5", "Claude Sonnet 4.5", "anthropic", true, { contextWindow: 200_000 }),
  model("claude-haiku-4.5", "Claude Haiku 4.5", "anthropic", true, { contextWindow: 200_000 }),
  model("gpt-5.2-codex", "GPT-5.2 Codex", "openai", true, { contextWindow: 272_000 }),
  model("gpt-5.2-mini", "GPT-5.2 Mini", "openai", true, { contextWindow: 400_000 }),
  /* one non-reasoning model, so the preview also shows what a model that takes
     no depths at all looks like — no depth chip at all */
  model("gemini-3.8-flash", "Gemini 3.8 Flash 1M", "google", false),
  model("gemini-3.8-pro", "Gemini 3.8 Pro", "google", true, { contextWindow: 2_000_000 }),
  model("qwen3-coder", "Qwen3 Coder 480B", "qwen", true, { contextWindow: 131_072 }),
  model("qwen3-plus", "Qwen3 Plus", "qwen", true, { contextWindow: 1_000_000 }),
  model("minimax-m3", "MiniMax M3", "minimax", true, { contextWindow: 1_000_000 }),
  model("kimi-k2.5", "Kimi K2.5", "moonshot", true, { contextWindow: 256_000 }),
  { ...model("pi-builtin-chat", "Pi built-in chat", "pi-builtin"), source: "builtin" },
];

const now = Date.now();

const MESSAGES: ChatMessage[] = [
  {
    key: "u1",
    role: "user",
    timestamp: now - 11 * 60_000,
    text: [
      "把 settings 里的模型列表整理一下，顺便看看 @ 引用能不能搜整个工作区。",
      "",
      "另外这是一段很长的粘贴内容，用来验证消息气泡的高度限制：",
      ...Array.from({ length: 14 }, (_, i) => `${i + 1}. 这一行是粘贴进来的日志或需求描述，第 ${i + 1} 条。`),
    ].join("\n"),
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
        "+            <div className=\"border-b border-line px-4 py-1.5 text-ui-xs text-ink-3 uppercase\">",
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
  /* The plan/build seam, exactly as plan mode writes it: a `custom` message the
     extension sends when the build starts. The transcript cuts the next task
     here, so the fixture has to carry the same shape the log does or the
     boundary row would only ever be exercised against a real session. */
  {
    key: "b1",
    role: "custom",
    customType: "plan-mode-build",
    timestamp: now - 36_000,
    text: "**Building the plan — dock 高度上限** (3 steps)",
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
      {
        type: "text",
        text: "## 流式中的 Markdown\n\n现在**边流边渲染**，列表和代码同样生效：\n\n- 第一项\n- 第二项\n\n```bash\nnpm run typecheck\n```",
      },
    ],
  },
  {
    key: "a2",
    role: "assistant",
    timestamp: now - 2 * 60_000,
    text: [
      "## 对比结论",
      "",
      "**Aureways 比我们好的**：",
      "",
      "1. 转录虚拟化",
      "2. 标准快捷键 `⌘,` 与 `⌘B`",
      "3. 真 PTY 终端",
      "",
      "| 能力 | 我们 | Aureways |",
      "| --- | --- | --- |",
      "| 工作区分组 | ✓ | ✗ |",
      "| PTY | ✗ | ✓ |",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "> 引用一段话做例子。",
    ].join("\n"),
    blocks: [{ type: "thinking", text: "先把能一眼看出来的记下来，别展开成大改。" }],
    usage: { input: 12_400, output: 486, total: 12_886, cacheRead: 11_020, model: "DeepSeek V4 Flash", provider: "deepseek" },
  },
  /* A searched answer with no code in it. This is the shape that used to lose
     its formatting: cited sources push the final beat down the path that listed
     the prose as word tokens, so headings and lists arrived as literal text. */
  {
    key: "u4",
    role: "user",
    timestamp: now - 90_000,
    text: "tokio 的 spawn_blocking 什么时候该用？给个结论。",
    blocks: [],
  },
  {
    key: "a4t",
    role: "assistant",
    timestamp: now - 84_000,
    text: "",
    blocks: [
      { type: "toolCall", id: "w1", name: "web_search", arguments: { query: "tokio spawn_blocking when to use site:docs.rs" } },
    ],
  },
  {
    key: "rw1",
    role: "toolResult",
    timestamp: now - 78_000,
    toolName: "web_search",
    toolCallId: "w1",
    text: [
      "[1] tokio::task — Rust",
      "https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html",
      "Runs the provided closure on a thread where blocking is acceptable.",
      "",
      "[2] Blocking, and how to avoid it",
      "https://tokio.rs/tokio/tutorial/blocking",
      "Use spawn_blocking for CPU-heavy work or blocking IO.",
    ].join("\n"),
    blocks: [],
  },
  {
    key: "a4",
    role: "assistant",
    timestamp: now - 60_000,
    text: [
      "## 结论",
      "",
      "**只在需要阻塞时**才用 `spawn_blocking`：",
      "",
      "- 同步文件 IO、阻塞式数据库驱动",
      "- CPU 密集且预计跑超过几毫秒",
      "",
      "> 普通异步 IO 直接用 `tokio::spawn`，不要占用阻塞线程池。",
    ].join("\n"),
    blocks: [],
    usage: { input: 4_120, output: 210, total: 4_330, cacheRead: 3_800, model: "GLM 5.3", provider: "opcc" },
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
  homeDir: "F:/Users/demo",
  connected: true,
  snapshot: {
    sessionId: "preview",
    sessionFile: "preview.jsonl",
    sessionName: "Settings polish and @ search",
    cwd: "F:/Projects/pi-agent-desktop",
    model: MODELS[0],
    thinkingLevel: "max",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
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
  /* the endpoints the providers fold into. The providers pi ships are not
     `custom` — the desktop cannot re-key them — and the last one carries two
     members on purpose: a channel with several keys is the shape the panel only
     ever shows when the storage underneath really has it, and the preview is
     where that shape gets looked at before it ships. */
  channels: [
    ...new Map(
      MODELS.map((entry) => [
        entry.provider,
        {
          id: entry.provider,
          name: entry.provider,
          api: "openai-completions",
          members: [entry.provider],
          modelCount: MODELS.filter((model) => model.provider === entry.provider).length,
          custom: false,
        },
      ]),
    ).values(),
    {
      id: "anthropic-messages|https://relay.example/v1",
      name: "Relay",
      api: "anthropic-messages",
      baseUrl: "https://relay.example/v1",
      members: ["relay", "relay-2"],
      modelCount: 0,
      custom: true,
    },
  ],
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
  /* the agent's own list — the task monitor writes it out, so the preview needs
     one to show that section at all */
  todos: [
    { id: "td1", label: "把每模型覆盖拆成独立分组", amount: "", status: "done", details: [] },
    { id: "td2", label: "给 thinking 深度选择器加上键盘支持", amount: "", status: "done", details: [] },
    { id: "td3", label: "检查 dock 的高度上限", amount: "2/3", status: "running", details: [] },
    { id: "td4", label: "把 @ 引用扩到整个工作区", amount: "", status: "pending", details: [] },
  ],
  tools: ["read", "edit", "write", "bash", "grep", "todo_write"],
  queue: { steering: [], followUp: [], steeringMode: "all", followUpMode: "all" },
  plan: {
    phase: "review",
    title: "把 plan mode 做成真正的 pi 扩展",
    path: "F:/Projects/pi-agent-desktop/.pi/plans/plan-mode-extension.md",
    parentModel: { provider: MODELS[0].provider, id: MODELS[0].id },
    steps: [
      { id: "step-1", label: "扩展落到 resources/extensions/plan-mode", status: "done" },
      { id: "step-2", label: "规划期间移出写入工具，bash 仍可读", status: "done" },
      { id: "step-3", label: "把计划发布到窗口，并停靠进 dock", status: "running" },
      { id: "step-4", label: "用上次选择的模型构建", status: "pending" },
    ],
    updatedAt: now,
  },
  fleet: [
    {
      name: "explore_deps",
      status: "running",
      task: "梳理 src/renderer 下所有对 .svg 的直接引用，输出路径清单",
      model: `${MODELS[0].provider}/${MODELS[0].id}`,
      thinkingLevel: "max",
      spawnedAt: now - 42_000,
      tokens: { input: 12_400, output: 3_120, total: 15_520 },
    },
    {
      name: "audit_i18n",
      status: "completed",
      task: "找出 i18n 词典中缺失中文翻译的键",
      model: `${MODELS[0].provider}/${MODELS[0].id}`,
      thinkingLevel: "max",
      spawnedAt: now - 130_000,
      endedAt: now - 61_000,
      tokens: { input: 22_800, output: 5_040, total: 27_840 },
      cost: 0.061,
      /* A sub-agent's `summary` is its final answer, so it is markdown — the
         panel used to lay it down as pre-wrapped source. This fixture carries
         every block a report actually arrives with: a heading, a list, inline
         code, a table and a fence. */
      summary: [
        "共扫出 **17 个缺失键**，全部集中在 settings 的 hooks 区。",
        "",
        "## 前三个",
        "",
        "1. `Hooks` — 面板标题",
        "2. `Hook path` — 行标签",
        "3. `Add hook` — 按钮文案",
        "",
        "| 区块 | 缺失 | 文件 |",
        "| --- | ---: | --- |",
        "| hooks | 11 | `HooksSection.tsx` |",
        "| models | 6 | `ModelManager.tsx` |",
        "",
        "清单已写入 `.pi/tmp/i18n-missing.md`，补词典：",
        "",
        "```json",
        '{ "Hooks": "钩子", "Hook path": "钩子路径" }',
        "```",
      ].join("\n"),
    },
  ],
  surfaces: [
    { key: "plan-mode", kind: "status", text: "plan · review" },
    { key: "pi-desktop", kind: "status", text: "12 tools" },
  ],
};

/** The plan file the preview's plan mode pretends to have written — the same
 *  shape `plan-file.ts` writes, so the panel's document view renders real text. */
const PLAN_MD = `# 把 plan mode 做成真正的 pi 扩展

_Written by plan mode · 2026-09-21T04:12:00.000Z · deepseek-v4-flash_

## Steps

1. 扩展落到 resources/extensions/plan-mode
2. 规划期间移出写入工具，bash 仍可读
3. 把计划发布到窗口，并停靠进 dock
4. 用上次选择的模型构建

## Notes

计划本身是仓库里的 markdown 文件（\`.pi/plans/<slug>.md\`），所以"确认的就是留下的"。

- \`/plan\` 仍是入口，\`build\` / \`refine\` / \`cancel\` 挂在它下面
- 规划期间写入类工具离开工具集，确认后原样恢复
- 窗口把文件读回来渲染，而不是在 state 里镜像一份

## 验证

- 四种阶段都跑一遍：\`/plan\`、\`/plan status\`、\`/plan build\`、\`/plan cancel\`
- 取消后 Build 不再出现，文件仍留在磁盘上
- 复制为 Markdown 与复制文件路径都取自磁盘上的那一份
`;

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

/**
 * The usage ledger the preview reports.
 *
 * Buckets are generated once for ninety days and every aggregate is derived
 * from them, the way the scanner derives them from session files. Hand-typed
 * totals would contradict themselves the moment a day or an hour is clicked —
 * and clicking a slice is the interaction these charts exist for. The range
 * filter happens after generation, so a 7-day window really is the tail of the
 * 30-day one instead of different numbers wearing the same clothes.
 *
 * Seeded rather than random: a preview that redraws differently on every reload
 * cannot be compared against a previous screenshot.
 */
const PREVIEW_MODELS: Array<{ provider: string; providerName: string; model: string; share: number }> = [
  { provider: "deepseek", providerName: "DeepSeek", model: "deepseek-v4-flash", share: 0.95 },
  { provider: "opcc", providerName: "智谱", model: "glm-5.3", share: 0.6 },
  { provider: "opcc", providerName: "智谱", model: "glm-5.3-flash", share: 0.45 },
  { provider: "anthropic", providerName: "Anthropic", model: "claude-sonnet-4.5", share: 0.34 },
  { provider: "openai", providerName: "OpenAI", model: "gpt-6-sol", share: 0.22 },
  { provider: "google", providerName: "Google", model: "gemini-3.8-flash", share: 0.15 },
  { provider: "deepseek", providerName: "DeepSeek", model: "deepseek-r1", share: 0.08 },
];

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: 0,
  reasoning: 0,
});

/** The five prompt-and-bill fields every row of the ledger carries. */
type Soakable = Pick<UsageTotals, "input" | "output" | "cacheRead" | "cacheWrite" | "cost">;

const soak = (row: Soakable, bucket: UsageBucket): void => {
  row.input += bucket.input;
  row.output += bucket.output;
  row.cacheRead += bucket.cacheRead;
  row.cacheWrite += bucket.cacheWrite;
  row.cost += bucket.cost;
};

const soakTotals = (row: UsageTotals, bucket: UsageBucket): void => {
  soak(row, bucket);
  row.total += bucket.total;
};

const dateKey = (time: number): string => new Date(time).toISOString().slice(0, 10);

const PREVIEW_BUCKETS: UsageBucket[] = (() => {
  let seed = 20260926;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const rows: UsageBucket[] = [];
  const today = Date.now();
  for (let offset = 89; offset >= 0; offset -= 1) {
    const day = new Date(today - offset * 86_400_000);
    const date = dateKey(day.getTime());
    const quiet = day.getDay() === 0 || day.getDay() === 6;
    // whole days off, more on weekends — an all-time heatmap with no gaps is a
    // wall of one colour, which reads as a broken chart rather than as usage
    if (rnd() < (quiet ? 0.55 : 0.14)) continue;
    const hours = [9, 10, 11, 12, 14, 15, 16, 17, 20, 21, 22].filter(() => rnd() < 0.62);
    for (const hour of hours) {
      for (const entry of PREVIEW_MODELS) {
        if (rnd() > entry.share) continue;
        const input = Math.round(9_000 + rnd() * 60_000);
        const output = Math.round(600 + rnd() * 7_000);
        const cacheRead = Math.round(input * (2.2 + rnd() * 4));
        const cacheWrite = Math.round(input * (0.1 + rnd() * 0.5));
        rows.push({
          date,
          hour,
          provider: entry.provider,
          providerName: entry.providerName,
          model: entry.model,
          calls: 1 + Math.round(rnd() * 9),
          input,
          output,
          cacheRead,
          cacheWrite,
          total: input + output + cacheRead + cacheWrite,
          cost: (input + output + cacheWrite + cacheRead * 0.1) / 1_000_000 * 2.6,
        });
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
})();

function previewUsage(days: number): UsageStats {
  const cutoff = days > 0 ? dateKey(Date.now() - (days - 1) * 86_400_000) : "";
  const buckets = cutoff ? PREVIEW_BUCKETS.filter((bucket) => bucket.date >= cutoff) : PREVIEW_BUCKETS;

  const totals = emptyTotals();
  const hourTotals = new Array<number>(24).fill(0);
  const dayMap = new Map<string, UsageDay>();
  const modelMap = new Map<string, UsageModelRow>();
  const providerMap = new Map<string, UsageProviderRow & { seen: Set<string> }>();

  for (const bucket of buckets) {
    soakTotals(totals, bucket);
    hourTotals[bucket.hour] += bucket.total;

    const day = dayMap.get(bucket.date) ?? {
      date: bucket.date,
      calls: 0,
      tokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    day.calls += bucket.calls;
    day.tokens += bucket.total;
    soak(day, bucket);
    dayMap.set(bucket.date, day);

    const modelKey = `${bucket.provider}/${bucket.model}`;
    const model = modelMap.get(modelKey) ?? {
      ...emptyTotals(),
      provider: bucket.provider,
      providerName: bucket.providerName,
      model: bucket.model,
      calls: 0,
      cacheRate: 0,
      firstUsed: `${bucket.date}T09:00:00.000Z`,
      lastUsed: `${bucket.date}T09:00:00.000Z`,
      medianTokensPerCall: 0,
    };
    model.calls += bucket.calls;
    if (bucket.date > model.lastUsed.slice(0, 10)) model.lastUsed = `${bucket.date}T21:00:00.000Z`;
    soakTotals(model, bucket);
    modelMap.set(modelKey, model);

    const provider = providerMap.get(bucket.provider) ?? {
      ...emptyTotals(),
      provider: bucket.provider,
      providerName: bucket.providerName,
      calls: 0,
      models: 0,
      cacheRate: 0,
      seen: new Set<string>(),
    };
    provider.calls += bucket.calls;
    provider.seen.add(bucket.model);
    soakTotals(provider, bucket);
    providerMap.set(bucket.provider, provider);
  }

  const byTokens = <T extends { total: number }>(a: T, b: T) => b.total - a.total;
  const models = [...modelMap.values()].sort(byTokens);
  const providers = [...providerMap.values()]
    .map(({ seen, ...row }) => ({ ...row, models: seen.size }))
    .sort(byTokens);
  for (const row of models) row.cacheRate = cacheHitRate(row);
  for (const row of providers) row.cacheRate = cacheHitRate(row);

  const dayList = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = dayList.map((day) => day.date);

  const streaks = (dates: string[]): [number, number] => {
    const set = new Set(dates);
    let longest = 0;
    let run = 0;
    for (const date of dates) {
      run = set.has(date) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    let current = 0;
    for (let offset = 0; offset < 366; offset += 1) {
      if (!set.has(dateKey(Date.now() - offset * 86_400_000))) break;
      current += 1;
    }
    return [current, longest];
  };
  const [currentStreak, longestStreak] = streaks(activeDays);

  const cacheByChannel: UsagePerModel[] = models.map((row) => ({
    provider: row.provider,
    providerName: row.providerName,
    model: row.model,
    calls: row.calls,
    cacheHitRate: cacheHitRate(row),
    tokens: row.total,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
  }));

  const cache: UsageCacheStats = {
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    freshInput: totals.input,
    hitRate: cacheHitRate(totals),
    savedTokens: totals.cacheRead,
    byModel: cacheByChannel,
  };

  const deviations: UsageDeviation[] = dayList.map((day) => ({
    date: day.date,
    tokens: day.tokens,
    calls: day.calls,
    cacheRate: cacheHitRate(day),
    cost: day.cost,
  }));

  const peakHour = hourTotals.some((value) => value > 0) ? hourTotals.indexOf(Math.max(...hourTotals)) : null;

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: activeDays[0] ? `${activeDays[0]}T00:00:00.000Z` : null,
      to: activeDays.at(-1) ? `${activeDays.at(-1)}T00:00:00.000Z` : null,
      days,
    },
    totals,
    kpis: {
      sessions: Math.max(1, Math.round(buckets.length / 5)),
      messages: buckets.reduce((sum, bucket) => sum + bucket.calls, 0),
      activeDays: activeDays.length,
      currentStreak,
      longestStreak,
      peakHour,
      favoriteModel: models[0] ? `${models[0].provider}/${models[0].model}` : null,
    },
    days: dayList,
    hours: hourTotals,
    models,
    providers,
    cache,
    cacheByChannel,
    deviations,
    buckets,
    sessionCount: Math.max(1, Math.round(buckets.length / 5)),
    messageCount: buckets.reduce((sum, bucket) => sum + bucket.calls, 0),
    scannedFiles: Math.max(1, Math.round(buckets.length / 3)),
    errors: [],
  };
}

export function installPreviewBridge(): void {
  const w = window as unknown as { pi?: unknown };
  if (w.pi) return;
  /* only inside a browser tab served over http — never inside Electron */
  if (!/^https?:$/.test(window.location.protocol)) return;

  const listeners = new Set<(payload: unknown) => void>();
  /* mutable so `newSession` can clear it — the empty session is the greeting
     screen, and a frozen fixture means the preview can never reach it */
  let messages: ChatMessage[] = [...MESSAGES];
  if (new URLSearchParams(location.search).has("qa-mcp")) {
    messages = [
      { key: "qa-mcp-user", role: "user", timestamp: now, text: "检查 MCP 返回的 JSON、图片、资源和错误", blocks: [] },
      { key: "qa-mcp-assistant", role: "assistant", timestamp: now + 1, text: "", blocks: [
        { type: "toolCall", id: "qa-mcp-1", name: "mcp__filesystem__read_file", arguments: { path: "/srv/project/package.json" } },
        { type: "toolCall", id: "qa-mcp-2", name: "mcp__sentry__get_issue", arguments: { issue: "PROJ-42" } },
      ] },
      { key: "qa-mcp-result-1", role: "toolResult", timestamp: now + 2, text: '{"name":"pi-agent-desktop","private":true}', blocks: [], toolName: "mcp__filesystem__read_file", toolCallId: "qa-mcp-1", toolDetails: { server: "filesystem", tool: "read_file", content: [
        { type: "text", text: '{"name":"pi-agent-desktop","private":true}' },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=" },
        { type: "resource_link", uri: "https://example.com/result", name: "Result document" },
      ] } },
      { key: "qa-mcp-result-2", role: "toolResult", timestamp: now + 3, text: "404 Not Found: issue PROJ-42", blocks: [], isError: true, toolName: "mcp__sentry__get_issue", toolCallId: "qa-mcp-2", toolDetails: { server: "sentry", tool: "get_issue" } },
    ];
  }
  let tools: ToolActivity[] = TOOLS;
  const payload = () => ({
    state: STATE,
    messages,
    tools,
    uiRequest: null,
    notifications: [],
  });
  const emit = () => {
    for (const fn of listeners) fn(payload());
  };
  /** Transcript positions where a user prompt starts, oldest first — the index
   *  space `forkAt` and `rewindTo` address. */
  const promptStarts = (): number[] =>
    messages.map((message, position) => (message.role === "user" ? position : -1)).filter((position) => position >= 0);

  const unsub = () => () => {};
  /* mutable, so switching / creating / deleting a branch in the preview behaves
     like the real handler rather than answering the same question forever */
  const gitBranchList = ["master", "feat/session-strip", "release/1.4"];
  let gitCurrent = "master";
  /* what Build last ran with — the panel's default until the picker overrides it */
  let buildModel: { provider: string; id: string } | undefined;
  /* the preview's build: a timer that walks the plan's steps, since the agent
     that would normally report progress does not exist in a browser tab */
  let buildTimer: number | undefined;
  const stopBuild = () => {
    if (buildTimer !== undefined) window.clearInterval(buildTimer);
    buildTimer = undefined;
  };
  const advanceBuild = () => {
    const plan = STATE.plan;
    const open = plan.steps.findIndex((step) => step.status !== "done");
    if (open < 0) {
      stopBuild();
      return;
    }
    const last = open + 1 >= plan.steps.length;
    STATE.plan = {
      ...plan,
      phase: last ? "off" : "executing",
      steps: plan.steps.map((step, index) =>
        index <= open
          ? { ...step, status: "done" as const }
          : index === open + 1
            ? { ...step, status: "running" as const }
            : { ...step, status: "pending" as const },
      ),
      updatedAt: Date.now(),
    };
    emit();
  };
  const previewWorkspace = () => STATE.workspace ?? { id: "preview-workspace", name: "pi-agent-desktop", cwd: STATE.cwd, folders: [{ name: "pi-agent-desktop", path: STATE.cwd }] };
  const previewProfiles: import("@shared/workspaces").SshProfile[] = [
    /* carries `folder` so the reconnect-prefill behaviour is visible in a
       plain browser tab — selecting it must fill the remote folder field */
    { id: "preview-ssh", name: "demo-server", host: "demo.example", port: 22, username: "demo", privateKeyPath: "C:/Users/demo/.ssh/id_ed25519", fingerprint: "SHA256:previewOnlyNoRealConnection00000000000000000", folder: "/srv/app", status: "disconnected" },
  ];
  const workspaceListeners = new Set<() => void>();
  const table: Record<string, (...args: never[]) => unknown> = {
    getWorkspace: async () => previewWorkspace(),
    listWorkspaces: async () => [previewWorkspace()],
    addWorkspaceFolder: async (path?: string) => { const current = previewWorkspace(); const next = path || "F:/Projects/pi-agent-api"; if (!current.folders.some((folder) => folder.path === next)) current.folders.push({ name: next.split(/[\\/]/).at(-1) || next, path: next }); STATE.workspace = current; emit(); for (const listener of workspaceListeners) listener(); return current; },
    removeWorkspaceFolder: async (path: string) => { const current = previewWorkspace(); current.folders = current.folders.filter((folder, index) => index === 0 || folder.path !== path); STATE.workspace = current; emit(); for (const listener of workspaceListeners) listener(); return current; },
    renameWorkspace: async (name: string) => { const current = previewWorkspace(); current.name = name; STATE.workspace = current; emit(); for (const listener of workspaceListeners) listener(); return current; },
    listSsh: async () => previewProfiles,
    probeSsh: async () => ({ fingerprint: "SHA256:previewOnlyNoRealConnection00000000000000000", algorithm: "ssh-ed25519" }),
    connectSsh: async () => { throw new Error("浏览器预览仅展示界面；真实 SSH 连接请在 Electron 应用中验证。"); },
    disconnectSsh: async () => {},
    removeSsh: async () => {},
    pickSshKey: async () => "C:/Users/demo/.ssh/id_ed25519",
    onWorkspaceChange: (fn: () => void) => { workspaceListeners.add(fn); return () => workspaceListeners.delete(fn); },
    getState: async () => payload(),
    /* Where a prompt starts in the preview's transcript, counted the same way
       the host counts them — by position on the branch being shown, not by
       anything stored on the message. */
    forkAt: async (index: number) => {
      const cut = promptStarts()[index];
      if (cut === undefined) return { cancelled: true };
      messages = messages.slice(0, cut + 1);
      tools = [];
      emit();
      return { cancelled: false };
    },
    /* Rewinds for real rather than answering the same question forever: the
       edited prompt has to leave the transcript, or the preview shows the exact
       bug this replaced — an edit that stacked a second copy on top. */
    rewindTo: async (index: number) => {
      const cut = promptStarts()[index];
      if (cut === undefined) return { text: "", cancelled: true };
      const text = messages[cut]?.text ?? "";
      messages = messages.slice(0, cut);
      tools = [];
      emit();
      return { text, cancelled: false };
    },
    setCwd: async (cwd: string) => {
      STATE.cwd = cwd === "~" ? STATE.homeDir : cwd;
      STATE.workspace = undefined;
      if (STATE.snapshot) STATE.snapshot.cwd = STATE.cwd;
      emit();
    },
    pickCwd: async () => STATE.cwd,
    newSession: async () => {
      messages = [];
      tools = [];
      /* a fresh session has no run in flight, and `streaming` is half of what
         decides whether the greeting or the transcript is on screen */
      if (STATE.snapshot) {
        STATE.snapshot.isStreaming = false;
        STATE.snapshot.isIdle = true;
        STATE.snapshot.messageCount = 0;
      }
      emit();
    },
    /* the two composer chips are optimistic: they hold the picked value until the
       host agrees, so the preview has to answer or every click walks back after
       a beat and the control can never be seen in its new state */
    setThinking: async (level: string) => {
      const snapshot = STATE.snapshot;
      if (!snapshot || snapshot.thinkingLevel === level) return;
      snapshot.thinkingLevel = level;
      emit();
    },
    setModel: async (provider: string, modelId: string) => {
      const model = MODELS.find((m) => m.provider === provider && m.id === modelId);
      if (STATE.snapshot && model && STATE.snapshot.model?.id !== modelId) {
        STATE.snapshot.model = model;
        STATE.snapshot.thinkingLevels = model.thinkingLevels;
        const { thinkingLevels } = STATE.snapshot;
        if (!thinkingLevels.includes(STATE.snapshot.thinkingLevel)) {
          STATE.snapshot.thinkingLevel =
            thinkingLevels.includes("high") ? "high" : thinkingLevels.at(-1) ?? "off";
        }
        emit();
      }
    },
    updateSettings: async (patch: Record<string, unknown>) => {
      Object.assign(STATE.settings, patch);
      emit();
    },
    /* Channels behave like the real writer in here: an endpoint lands as one
       member per key, and the panel re-reads them without a reload — which is
       the only way the multi-key rows can be looked at before they ship. */
    createChannel: async (edit: ChannelEdit) => {
      const slug = edit.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "channel";
      const ids = edit.keys.map((key, index) => (index === 0 ? slug : `${slug}-${index + 1}`));
      const channelId = endpointId(edit.api, edit.baseUrl);
      STATE.channels = [
        ...STATE.channels.filter((entry) => entry.id !== channelId),
        {
          id: channelId,
          name: edit.name,
          api: edit.api,
          baseUrl: edit.baseUrl,
          members: ids,
          modelCount: 0,
          custom: true,
        },
      ];
      emit();
      return ids;
    },
    removeChannel: async (channelId: string) => {
      STATE.channels = STATE.channels.filter((entry) => entry.id !== channelId);
      emit();
    },
    addChannelKey: async (channelId: string, key: string) => {
      const channel = STATE.channels.find((entry) => entry.id === channelId);
      if (!channel?.members.length || !key.trim()) return undefined;
      const id = `${channel.members[0]}-${channel.members.length + 1}`;
      channel.members = [...channel.members, id];
      emit();
      return id;
    },
    removeChannelKey: async (providerId: string) => {
      for (const channel of STATE.channels) channel.members = channel.members.filter((id) => id !== providerId);
      STATE.channels = STATE.channels.filter((channel) => channel.members.length > 0);
      emit();
    },
    onUpdate: ((fn: (payload: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }) as never,
    listAllSessions: async () => STATE.sessions,
    listDir: async (dirPath: string) =>
      ({ path: dirPath, entries: TREE[dirPath?.replace(STATE.cwd, "").replace(/^[\\/]/, "") ?? ""] ?? [] }),
    searchFiles: async () => PREVIEW_FILES.map((path) => ({ path, modified: 0 })),
    readPlan: async () => ({ path: STATE.plan.path || "", name: "plan.md", lang: "md", text: PLAN_MD, size: PLAN_MD.length, truncated: false, binary: false }),
    readFile: async (filePath: string) => {
      /* a file the plan panel reads back is the plan — the document view is
         only worth previewing with the real thing in it */
      const text = filePath === STATE.plan.path ? PLAN_MD : "// preview fixture\n";
      return {
        path: filePath,
        name: filePath.split("/").pop() ?? filePath,
        lang: filePath.endsWith(".md") ? "md" : "ts",
        text,
        size: text.length,
        truncated: false,
        binary: false,
      };
    },
    getDesktopConfig: async () => ({
      /* the preview can be driven back onto the welcome flow with
         localStorage "pi-preview-onboarded" = "0" — how the onboarding
         screens are actually looked at without a fresh machine */
      onboardingDone: localStorage.getItem("pi-preview-onboarded") !== "0",
      cwd: STATE.cwd,
      buildModel,
      userName: localStorage.getItem("pi-preview-user-name") ?? "dnxkrad8",
    }),
    setUserName: async (name: string) => {
      localStorage.setItem("pi-preview-user-name", name);
      return window.pi.getDesktopConfig();
    },
    /* the bundled catalogue, with the same shape the main process reports, so
       the recommended-plugin rows and the welcome checklist are previewable */
    getCatalog: async () => {
      const installed = localStorage.getItem("pi-preview-catalog")?.split(",").filter(Boolean) ?? [
        "capability:browser",
        "capability:todos",
        "extension:plan-mode",
        "extension:agent-team",
      ];
      const rows: Array<[string, string, string, CatalogItem["kind"]]> = [
        ["skill:browser-design", "Browser design", "Pick a component in the browser and anchor a change to it.", "skill"],
        ["skill:browser-ops", "Browser ops", "Drive the embedded browser: snapshot, click, fill, search text, screenshot.", "skill"],
        ["skill:plan-with-tasks", "Task planning", "Keep the sidebar task list current through multi-step work.", "skill"],
        ["extension:plan-mode", "Plan mode", "A read-only planning phase with a reviewable plan, then a build that tracks its own steps.", "extension"],
        ["extension:agent-team", "Agent team", "Codex-style sub-agents backed by real in-process sessions with their own context windows.", "extension"],
        ["capability:browser", "Browser", "An embedded Chromium panel with 7 tools.", "capability"],
        ["capability:todos", "Task list", "Lets the agent maintain a task list, shown live in the side panel.", "capability"],
      ];
      return rows.map(([id, name, description, kind]) => ({ id, name, description, kind, installed: installed.includes(id) }));
    },
    applyCatalog: async (ids: string[]) => {
      localStorage.setItem("pi-preview-catalog", ids.join(","));
      return { config: await window.pi.getDesktopConfig(), installed: [] };
    },
    finishOnboarding: async () => {
      localStorage.setItem("pi-preview-onboarded", "1");
      return window.pi.getDesktopConfig();
    },
    /* Plan mode belongs to the extension, so the mock walks the same four phases
       the plugin does — enough to see every state the panel renders, and to see
       the composer's pill change with them. */
    planAction: async (payload: PlanAction) => {
      if (payload.model) buildModel = payload.model;
      const plan = STATE.plan;
      const now = Date.now();
      if (payload.action === "toggle") {
        stopBuild();
        STATE.plan = { phase: plan.phase === "off" ? "planning" : "off", steps: [], updatedAt: now };
      } else if (payload.action === "cancel") {
        stopBuild();
        STATE.plan = { phase: "off", steps: [], updatedAt: now };
      } else if (payload.action === "build") {
        /* Building is the agent working the list, and the mock is the only agent
           here: the steps advance on their own, and the mode leaves when the
           last one lands — which is what the plugin does at the end of a build */
        stopBuild();
        STATE.plan = { ...plan, phase: "executing", updatedAt: now };
        emit();
        buildTimer = window.setInterval(advanceBuild, 1500);
      }
      emit();
    },
    /* the queue, so the card above the composer can be looked at with real
       content in it rather than only in a live run */
    steer: async (text: string) => {
      STATE.queue = { ...STATE.queue, steering: [...STATE.queue.steering, text] };
      emit();
    },
    followUp: async (text: string) => {
      STATE.queue = { ...STATE.queue, followUp: [...STATE.queue.followUp, text] };
      emit();
    },
    clearQueue: async () => {
      const texts = [...STATE.queue.steering, ...STATE.queue.followUp];
      STATE.queue = { ...STATE.queue, steering: [], followUp: [] };
      emit();
      return { ...STATE.queue, texts };
    },
    removeQueued: async (kind: "steering" | "followUp", index: number) => {
      STATE.queue = { ...STATE.queue, [kind]: STATE.queue[kind].filter((_, at) => at !== index) };
      emit();
    },
    setQueueMode: async (kind: "steering" | "followUp", mode: "all" | "one-at-a-time") => {
      STATE.queue = { ...STATE.queue, [kind === "steering" ? "steeringMode" : "followUpMode"]: mode };
      emit();
    },
    gitStatus: async () => ({
      repo: true,
      branch: gitCurrent,
      detached: false,
      changed: 3,
      added: 148,
      removed: 22,
      ahead: 2,
      behind: 0,
      hasUpstream: true,
    }),
    gitBranches: async () => ({
      repo: true,
      current: gitCurrent,
      detached: false,
      branches: gitBranchList.map((name) => ({ name, current: name === gitCurrent })),
    }),
    gitCheckout: async (name: string) => {
      gitCurrent = name;
      return { ok: true, output: `Switched to branch '${name}'` };
    },
    gitCreateBranch: async (name: string) => {
      if (!gitBranchList.includes(name)) gitBranchList.push(name);
      gitCurrent = name;
      return { ok: true, output: `Switched to a new branch '${name}'` };
    },
    gitDeleteBranch: async (name: string) => {
      const index = gitBranchList.indexOf(name);
      if (index < 0 || name === gitCurrent) return { ok: false, error: name === gitCurrent ? "Cannot delete the branch you are on" : `No such branch: ${name}` };
      gitBranchList.splice(index, 1);
      return { ok: true, output: `Deleted branch ${name}` };
    },
    gitCommit: async () => ({ ok: true, output: "3 files changed, 148 insertions(+), 22 deletions(-)" }),
    gitPush: async () => ({ ok: true, output: "To github.com:pi/agent-desktop.git\n   8f1c2ab..b7d2ba2  master -> master" }),
    gitChanges: async () => ({
      repo: true,
      staged: [
        { path: "src/main/git.ts", index: "modified" },
        { path: "src/renderer/src/lib/i18n.ts", index: "modified" },
      ],
      unstaged: [
        { path: "src/renderer/src/components/panel/ScmPanel.tsx", untracked: true },
        { path: "src/shared/workspace.ts", worktree: "modified" },
      ],
      truncated: false,
    }),
    gitDiff: async (path: string) => ({
      path,
      staged: false,
      diff: [
        "diff --git a/src/main/git.ts b/src/main/git.ts",
        "index 4f2a11c..9e3d7b0 100644",
        "--- a/src/main/git.ts",
        "+++ b/src/main/git.ts",
        "@@ -57,6 +57,12 @@ export async function gitStatus(cwd: string): Promise<GitState> {",
        "   let out: string;",
        "   try {",
        "-    out = await git(cwd, [\"status\", \"--porcelain\"]);",
        "+    out = await git(cwd, [\"status\", \"--porcelain=v2\", \"--branch\"]);",
        "+    for (const line of out.split(\"\\n\")) {",
        "+      if (line.startsWith(\"# branch.head\")) continue;",
        "+    }",
        "   } catch (error) {",
        "     if (notRepo(error)) return noRepoState();",
      ].join("\n"),
      truncated: false,
    }),
    gitStage: async () => ({ ok: true }),
    gitUnstage: async () => ({ ok: true }),
    gitDiscard: async () => ({ ok: true }),
    setGoal: async (condition: string | null) => {
      STATE.goal = condition;
    },
    asideAsk: async (text: string) => {
      STATE.aside = { question: text, answer: "", running: true };
      window.setTimeout(() => {
        if (STATE.aside?.running) {
          STATE.aside = { question: text, answer: "这是旁路会话里的回答——它有自己的会话文件，不会进入你正在读的对话。", running: false };
        }
      }, 600);
    },
    asideDismiss: async () => {
      STATE.aside = null;
    },
    getPlugins: async () => previewPlugins(),
    getMcpConfig: async () => PREVIEW_MCP,
    getMcpConnected: async () => PREVIEW_MCP.servers.filter((server) => server.enabled).map((server) => server.name.replace(/[^A-Za-z0-9_]/g, "_")),
    mcpFilePath: async (scope: string) => (scope === "global" ? "~/.pi/agent/mcp.json" : "F:/Projects/pi-agent-desktop/.pi/mcp.json"),
    writeMcpServer: async (scope: string, name: string, config: unknown) => {
      const rest = PREVIEW_MCP.servers.filter((server) => server.name !== name);
      PREVIEW_MCP.servers = [
        ...rest,
        {
          name,
          scope: scope as "global" | "project",
          file: scope === "global" ? "~/.pi/agent/mcp.json" : "F:/Projects/pi-agent-desktop/.pi/mcp.json",
          config: config as never,
          enabled: (config as { enabled?: boolean }).enabled !== false,
          exposure: (config as { exposure?: "codemode" }).exposure ?? "codemode",
        },
      ];
      return PREVIEW_MCP;
    },
    patchMcpServer: async (scope: string, name: string, patch: { enabled?: boolean; exposure?: string }) => {
      for (const server of PREVIEW_MCP.servers) {
        if (server.name !== name) continue;
        if (patch.enabled !== undefined) server.enabled = patch.enabled;
        if (patch.exposure !== undefined) server.exposure = patch.exposure as never;
      }
      return PREVIEW_MCP;
    },
    removeMcpServer: async (_scope: string, name: string) => {
      PREVIEW_MCP.servers = PREVIEW_MCP.servers.filter((server) => server.name !== name);
      return PREVIEW_MCP;
    },
    readPluginText: async (path: string) => PREVIEW_RULES.get(path)?.body ?? "",
    writePluginText: async (path: string, text: string) => {
      const entry = PREVIEW_RULES.get(path);
      if (entry) entry.body = text;
    },
    deletePlugin: async (path: string) => {
      PREVIEW_RULES.delete(path);
      return previewPlugins();
    },
    createRule: async (scope: "global" | "project", name: string) => {
      const fileName = `${name.trim().toLowerCase().replace(/[\\/:*?"<>|]/g, "-")}.md`;
      const path =
        scope === "global" ? `~/.pi/agent/prompts/${fileName}` : `F:/Projects/pi-agent-desktop/.pi/prompts/${fileName}`;
      PREVIEW_RULES.set(path, { scope, body: `# ${name.trim()}\n\n` });
      return previewPlugins();
    },
    getUsage: async (days: number) => previewUsage(days),
    getContextBreakdown: async () => ({ parts: [], used: null, contextWindow: 0, percent: null }),
    getZoomFactor: () => 1,
    setZoomFactor: () => undefined,
    getBrowserState: () => BROWSER,
    onBrowserPick: () => unsub(),
    onTerminalChunk: () => unsub(),
    onNotice: () => unsub(),
    bashState: async () => ({ running: false }),
    /* The agent shell's own command. There is no real bash in a browser tab, so
     * this stands in for one — and it answers after a beat, because the running
     * row now names the command it is on and that state has to be visible to be
     * checked at all. */
    runBash: async (command: string) => {
      await new Promise((done) => setTimeout(done, 4000));
      return {
        runId: "preview",
        command,
        output: `(preview) no real shell — this stands in for what ${command} would print`,
        exitCode: 0,
        cancelled: false,
        truncated: false,
        durationMs: 4000,
      };
    },
    /* the terminal panel's shell menu, with the palette of a real Windows box
       so the settings list and the picker render their full shape */
    listShells: async () => ({
      shells: [
        { id: "wsl:Ubuntu", kind: "wsl", name: "WSL · Ubuntu", path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Ubuntu"], available: true, detail: "Ubuntu" },
        { id: "gitbash", kind: "gitbash", name: "Git Bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: [], available: true },
        { id: "powershell", kind: "powershell", name: "PowerShell 7", path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", args: [], available: true },
        { id: "cmd", kind: "cmd", name: "Command Prompt", path: "C:\\Windows\\System32\\cmd.exe", args: [], available: true },
      ],
      resolvedId: "powershell",
    }),
    listPtySessions: async () => [],
    spawnPty: async () => ({ error: "The design preview has no real terminals." }),
    /* The openers list, spelled the way the real host answers it on macOS: the
     * file-manager row with no command (its mark comes from the OS), the default
     * application, and the editors a Mac usually has. The fallback path has no
     * `icon`, which is the state the toolbar's own glyph has to cover — and the
     * row the preview exists to check, since the unlisted methods below resolve
     * to `undefined` and leave the button with nothing to render. */
    listOpeners: async (): Promise<AppOpener[]> => [
      { id: "reveal", name: "File manager", kind: "reveal" },
      { id: "default", name: "Default application", kind: "default" },
      { id: "/usr/local/bin/code", name: "Visual Studio Code", kind: "app", command: "/usr/local/bin/code" },
      { id: "/usr/local/bin/cursor", name: "Cursor", kind: "app", command: "/usr/local/bin/cursor" },
    ],
    openWith: async () => ({ ok: true }),
    revealFile: async () => undefined,
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
