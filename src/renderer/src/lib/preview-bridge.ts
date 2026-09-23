import type { ChatMessage, HostState, ModelInfo, PlanAction, ToolActivity } from "@shared/types";
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

/* what each model can take before Ultra is layered on — `withUltra` in the main
   process replaces or appends to this, and the preview has to derive from the
   same pristine ramp rather than from levels it already edited */
const BASE_RAMP: Record<string, string[]> = {};

const model = (id: string, name: string, provider: string, reasoning = true): ModelInfo => {
  const thinkingLevels = reasoning ? ["off", "low", "medium", "high", "xhigh", "max"] : ["off"];
  BASE_RAMP[`${provider}/${id}`] = thinkingLevels;
  return {
    id,
    name,
    provider,
    providerName: provider,
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    reasoning,
    supportsImages: true,
    input: ["text", "image"],
    /* the whole ramp, because that is what a reasoning model offers here — and the
       xhigh + max pair is what makes a model eligible for Ultra in the list */
    thinkingLevels,
    supportsUltra: reasoning,
    cost: { input: 0.5, output: 1.5, cacheRead: 0.1, cacheWrite: 0.2 },
    source: "models.json",
  };
};

const MODELS: ModelInfo[] = [
  model("deepseek-v4-flash", "DeepSeek V4 Flash 1M", "deepseek"),
  model("deepseek-v4-pro", "DeepSeek V4 Pro 1M", "deepseek"),
  model("glm-5.3", "GLM 5.3 1M", "opcc"),
  model("kimi-k3", "Kimi K3 1M", "opcc"),
  model("claude-sonnet-4.5", "Claude Sonnet 4.5", "anthropic"),
  model("gpt-5.2-codex", "GPT-5.2 Codex", "openai"),
  /* one non-reasoning model, so the preview also shows what a model that takes
     no depths at all looks like — no depth chip, and no Ultra column entry */
  model("gemini-3.8-flash", "Gemini 3.8 Flash 1M", "google", false),
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
    /* Ultra is the model's own configured depth, not pi's, so the snapshot names
       it directly — `applyUltra` rebuilds the ramp from BASE_RAMP on load */
    thinkingLevel: "ultra",
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
    ultra: { "deepseek/deepseek-v4-flash": { mode: "coexist", picked: true } },
  },
  /* the agent's own list — the task monitor writes it out, so the preview needs
     one to show that section at all */
  todos: [
    { id: "td1", label: "把每模型覆盖拆成独立分组", amount: "", status: "done", details: [] },
    { id: "td2", label: "给 thinking 深度加上 Ultra 配置", amount: "", status: "done", details: [] },
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
      summary: "共扫出 17 个缺失键，全部集中在 settings 的 hooks 区。清单已写入 .pi/tmp/i18n-missing.md，前三个是：'Hooks'、'Hook path'、'Add hook'。",
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

/** mirror of `withUltra` in src/main/serialize.ts */
function ultraLevels(base: string[], mode: string | undefined): string[] {
  if (!mode || !base.includes("xhigh") || !base.includes("max")) return base;
  return mode === "replace"
    ? base.map((level) => (level === "max" ? "ultra" : level))
    : base.flatMap((level) => (level === "max" ? ["max", "ultra"] : [level]));
}

/* the settings screen edits one record and every level list downstream depends
   on it, so the preview has to re-derive them the way the host does */
function applyUltra(): void {
  const ultra = STATE.settings.ultra ?? {};
  for (const entry of MODELS) {
    const key = `${entry.provider}/${entry.id}`;
    entry.thinkingLevels = ultraLevels(BASE_RAMP[key] ?? entry.thinkingLevels, ultra[key]?.mode);
  }
  const model = STATE.snapshot?.model;
  if (STATE.snapshot && model) {
    const key = `${model.provider}/${model.id}`;
    STATE.snapshot.thinkingLevels = ultraLevels(
      BASE_RAMP[key] ?? STATE.snapshot.thinkingLevels,
      ultra[key]?.mode,
    );
  }
}

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
  applyUltra();

  const listeners = new Set<(payload: unknown) => void>();
  /* mutable so `newSession` can clear it — the empty session is the greeting
     screen, and a frozen fixture means the preview can never reach it */
  let messages: ChatMessage[] = MESSAGES;
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
  const table: Record<string, (...args: never[]) => unknown> = {
    getState: async () => payload(),
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
      /* Ultra is a desktop depth over the model's Max, and the entry's `picked`
         bit is what the host flips so the choice survives a reload */
      const key = `${snapshot.model?.provider}/${snapshot.model?.id}`;
      const entry = STATE.settings.ultra?.[key];
      if (entry) entry.picked = level === "ultra";
      emit();
    },
    setModel: async (provider: string, modelId: string) => {
      const model = MODELS.find((m) => m.provider === provider && m.id === modelId);
      if (STATE.snapshot && model && STATE.snapshot.model?.id !== modelId) {
        STATE.snapshot.model = model;
        applyUltra();
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
      applyUltra();
      /* turning Ultra off can retire the depth on screen; the host falls back to
         what the model still offers, and the chip must not be left naming nothing */
      const snapshot = STATE.snapshot;
      if (snapshot && !snapshot.thinkingLevels.includes(snapshot.thinkingLevel)) {
        snapshot.thinkingLevel = snapshot.thinkingLevels.at(-1) ?? "off";
      }
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
    getDesktopConfig: async () => ({ onboardingDone: true, cwd: STATE.cwd, buildModel }),
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
