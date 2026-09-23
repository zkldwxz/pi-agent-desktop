# ZCode / DSH / Grok Build 三家自研 Agent 针对自家模型的工程优化

> 取证据时间：2026-09-21
> 仓库快照（本地浅克隆 + GitHub 永久链接基准）：
>
> | 项目 | 仓库 | HEAD SHA | 许可 | 规模 |
> | --- | --- | --- | --- | --- |
> | ZCode | https://github.com/zai-org/ZCode | `872ad960de7ec172591f7e1952f7849229f94521` | Apache-2.0 | 6,973 文件 / TS |
> | DSH (DeepSeek Harness) | https://github.com/deepseek-ai/deepseek-harness | `ddefc45fbc7f8e46dd73185e68295696d1297887` | MIT | 12,072 文件 / TS+Py |
> | Grok Build | https://github.com/xai-org/grok-build | `4247f661689354b831191f11eeeac8424993fe3d` | Apache-2.0 | 4,089 文件 / Rust |
>
> 本地克隆位置：`F:/_oss-research/{ZCode,dsh,grok-build}`
> 对照组（我们自己的实现）：`F:/_oss-research/pi-src`、`pi-ai-src`、`pi-agent-core-src`
> —— 由 `@earendil-works/pi-coding-agent@0.85.1` 的 `dist/**/*.js.map` 里的 `sourcesContent` 还原（脚本：`F:/_oss-research/dump-pi-src.cjs`），行号与上游 TS 源一致。

---

## 0. 一句话结论

三家没有一家是靠"改模型"取胜的，全部在 **harness 层**围绕同一件事做工程：**让请求前缀尽可能字节稳定、让工具集与提示词随模型/后端可插拔、把大输出赶出上下文**。

四家的取舍明显不同：

- **ZCode** —— 把"提示词分段 + 缓存标记 + 提醒投递通道"做成显式的类型系统（`stable`/`dynamic`、6 种投递通道、3 种生命周期），并把工具顺序对齐 Claude Code 的字母序。
- **DSH** —— 把"前缀缓存复用"写成了不变量与测试：工具字典序、段名校验，以及一个很聪明的 `systemPromptUpdate: in-history`（系统提示变了也不改写头部，而是追加到已缓存历史之后）。
- **Grok Build** —— 一套 MiniJinja 模板 + `tools.by_kind.*` 语义占位符，让同一份提示词适配仓库里并存的 5+ 套工具集（codex / opencode / grok_build / hashline / concise）；提示词本体在仓库里是 XOR 混淆的，并且把"请求 N 是请求 N+1 的字节前缀"写成了断言测试。
- **我们（Pi）** —— 已有显式缓存断点与缓存浪费核算，提示词也刻意把易变内容后移；缺的是**架构级约束**（顺序不变量、追加式更新、前缀断言测试）与**持久 shell**。

社区侧有一条交叉验证：同一个 DeepSeek 后端下各客户端的缓存命中率实测能差近 10 个百分点（ZCode 98.60%，Claude Code 89.31%），说明这一节讲的都是**可测量的成本项**。另有一个意外发现——**DSH 的基础 bundle 里内置了基于 Pi `pi-ai` 的适配器**（`@earendil-works/pi-ai ^0.85.1`，与我们同版本），自我定位是自家适配器的"设计验证对照件"。详见 §7。

**拿官方文档反过来量自己（§8）发现一处硬冲突**：我们的 plan-mode 靠"摘掉写工具"实现只读，而 Anthropic 官方明确说不要在会话中途增删工具（会失效整个缓存），Claude Code 与三家开源实现全部用"工具集不变 + EnterPlanMode/ExitPlanMode 工具"来解。这条已在 §8.1 给出三步改法。

---

## 1. 取证方法（可复现）

```bash
# 三个开源仓库
cd F:/_oss-research
git clone --depth 1 https://github.com/zai-org/ZCode.git ZCode
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git dsh
git clone --depth 1 https://github.com/xai-org/grok-build.git grok-build

# 我们的 Pi：从 sourcemap 还原原始 TS
node F:/_oss-research/dump-pi-src.cjs \
  "F:/Projects/pi-agent-desktop/node_modules/@earendil-works/pi-coding-agent/dist" \
  "F:/_oss-research/pi-src"

# Grok 的混淆提示词模板（seed 在仓库里）
node F:/_oss-research/decrypt-grok-prompts.cjs
```

下文所有 `path:line` 都指上述本地路径；`Github` 链接为对应 SHA 的永久链接。**没有代码证据的推断一律标注「推测」。**

详细取证笔记（含大量逐段原文与永久链接）放在 `docs/research/notes/`：`zcode.md`、`dsh.md`、`grok-build.md`。

社区侧证据用 Exa MCP（`web_search_exa`）检索，结果整理在第 7 节；社区结论与源码结论冲突时以源码为准。

---

## 2. Tools 的不同

### 2.1 内置工具清单对照

| 能力 | Pi（我们） | ZCode | DSH | Grok Build |
| --- | --- | --- | --- | --- |
| 内置工具数 | **8** | 50+ handler | 25+ 插件包 | 40+ 实现，另含 5 套变体 |
| 文件读 | `read` | `read-text` / `read-image` / `read-pdf` / `read-video` | `tool-fs:read` / `read-image` | `read_file`（多套实现） |
| 文件写/改 | `write` / `edit` | `write` / `edit` | `tool-fs:write/edit`、`tool-str-replace-editor` | `search_replace`（grok_build）/ `apply_patch`（codex 变体） |
| 搜索 | `grep` / `find` / `ls` | `grep` / `glob` | `tool-fs-search:grep/glob` | `search_tool` / `grep_files` / `list_dir` |
| 命令执行 | `bash`（一次性） | `bash`（一次性 + 后台任务） | `tool-bash` **与** `tool-bash-persistent`（并存可选） | `run_terminal_cmd`（后端决定是否持久化） |
| 子代理 | 无（我们用扩展补） | `agent` / `send-message` / `respond-to-coordinator` | `tool-subagent` / `tool-subagent-control` / `tool-agent-team` | `task_output` / `send_subagent_message` |
| 计划模式 | 无（我们用扩展补） | `plan-mode` | `plan-mode` 插件 | `enter_plan_mode` / `exit_plan_mode` |
| 待办 | 无 | `todo` | `tool-todo` | `todo` |
| 联网 | 无 | `webfetch` / `websearch` | `tool-web` | `web_search` / `web_fetch` |
| 独特工具 | — | `node-repl`、`workflow`（脚本化工作流）、`cron`、`off-peak`、`submit-result`、`list-models` | `tool-ralph`、`tool-jobs`、`tool-lsp`、`tool-session-query`、`tool-present`、`tool-cordis`、`tool-goal` | `monitor`、`task`、`lsp`、`memory`、`workflow`、`update_goal`、`image_gen`/`video_gen`、`kill_task` |

证据（工具清单）：ZCode `apps/zcode-cli/packages/core/src/tool/handlers/`（114 个文件）；DSH `find packages -maxdepth 2 -type d -name "tool-*"`；Grok `crates/codegen/xai-grok-tools/src/implementations/`。

**四家的工具调用协议都是原生 function calling，没有一家用特殊 token 或 XML 包裹工具调用。** DSH 默认走 Anthropic 形状的 Messages 协议（`packages/llm/llm-deepseek/src/protocols/messages/`），同时另有 Chat Completions 协议实现。这点值得注意：DeepSeek 系模型在训练数据里见惯了 XML 式工具调用，但 dsh 选择走原生协议——**说明"跟训练分布对齐"这件事，在工具调用格式上不如在提示词内容上重要**。

### 2.2 Pi 只有 8 个内置工具，且工具是"按存在性"拼进提示词的

```1:20:F:/_oss-research/pi-src/core/tools/index.ts
export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";
export const allToolNames: Set<ToolName> = new Set([
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
]);
```

工具只有在提供了 `promptSnippet` 时才出现在系统提示的 Available tools 里，guidelines 也按"哪些工具真的在"动态生成：

```94:118:F:/_oss-research/pi-src/core/system-prompt.ts
	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";
	...
	const hasBash = tools.includes("bash");
	const hasPowerShell = tools.includes("powershell");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");

	// File exploration guidelines
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
```

这就是"最小工具集 + 条件提示"的极简路线：8 个工具、4 个预设（`createCodingTools` / `createReadOnlyTools`），其余能力全部由扩展注册。

### 2.3 ZCode：工具顺序被显式对齐到 Claude Code 的字母序

ZCode 有一份 **Claude Code 规范工具名**（`Agent`/`AskUserQuestion`/`Bash`/`Edit`/`Read`/`Write`…）的白名单，命中者**按字母序排前面**，本地/插件工具原序排后面：

```1:52:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/provider-visible-order.ts
const SORTED_PROVIDER_TOOL_NAMES = new Set([
  "Agent",
  "AskUserQuestion",
  "Bash",
  "CronCreate",
  ...
  "WebSearch",
  "Workflow",
  "Write",
]);

export function orderProviderVisibleToolContracts<T extends { name: string }>(
  tools: readonly T[],
): T[] {
  const referenceTools: T[] = [];
  const localTools: T[] = [];
  for (const tool of tools) {
    if (SORTED_PROVIDER_TOOL_NAMES.has(tool.name)) {
      referenceTools.push(tool);
    } else {
      localTools.push(tool);
    }
  }

  return [
    ...referenceTools.sort((left, right) => left.name.localeCompare(right.name)),
    ...localTools,
  ];
}
```

调用点在 provider 可见工具的唯一出口：
`Github` https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/apps/zcode-cli/packages/core/src/runtime/methods/config.ts#L265

```258:266:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/runtime/methods/config.ts
  return orderProviderVisibleToolContracts(visibleTools);
```

为什么这是"缓存优化"：工具块是请求前缀的一部分，**顺序一变，从第一个变化的 token 起缓存全废**。把它固定成与参考实现相同的字母序，等于让同一份会话的前缀形状可预测。

**还有一条更彻底的：工具说明根本不进 system prompt。** `setToolRegistry` 被改成空操作，工具定义只走请求的 `tools` 字段：

```48:52:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/context/builder.ts
  /**
   * 保留兼容入口。工具说明由 model request 的 tools 字段承载，不再镜像进 system prompt。
   */
  setToolRegistry(_registry: ToolRegistry): this {
    return this;
  }
```

这和我们相反——Pi 会把每个工具的 `promptSnippet` 拼进系统提示的 "Available tools" 一节（见 §2.2）。ZCode 的选择让 system 前缀更短也更稳（工具描述在 `tools` 字段里本来就独立计量），代价是模型失去"在自然语言里被复述一遍工具用法"的强化。**两种都成立，取决于工具的 schema 是否自解释。**

#### 顺带：ZCode 的工具调度按安全属性分组并行

它的并发不是"全都并行"或"串行"，而是按工具自己声明的安全属性决定：

```85:99:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/scheduler.ts
  private canRunInParallel(tool: ToolDependency): boolean {
    const hasToolName = typeof tool.toolName === "string" && tool.toolName.length > 0;
    const hasSafetyMetadata =
      tool.readOnly !== undefined ||
      tool.destructive !== undefined ||
      tool.concurrentSafe !== undefined ||
      tool.sideEffectScope !== undefined;
    ...
    const readOnly = tool.readOnly ?? (hasToolName ? this.readOnlyTools.has(tool.toolName!) : false);
    if (tool.destructive) return false;
    if (tool.concurrentSafe === true) return true;
    if (tool.concurrentSafe === false) return false;
    if (readOnly) return true;
    return tool.sideEffectScope === "none";
  }
```

默认并发上限 10，只读集合里连 `TodoWrite` / `AskUserQuestion` / `Skill` 都算可并行（`scheduler.ts:233-243`）。**四个安全属性是工具定义的一部分**（见笔记 §1.2），所以"能不能并行"不需要在调度器里维护一张特例表。

### 2.4 ZCode：工具描述/schema 可以按模型投影

```1:33:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/model-contract.ts
export function resolveToolEntryModelContract(
  entry: ToolEntry,
  context: ToolExecutionModelContext,
): ToolEntry {
  const projection = entry.resolveModelContract?.(context);
  if (!projection) return entry;
  return {
    ...entry,
    ...(projection.inputSchema ? { inputSchema: projection.inputSchema } : {}),
    metadata: {
      ...entry.metadata,
      ...(projection.description !== undefined ? { description: projection.description } : {}),
    },
  };
}
```

即同一个工具，面向不同模型可以给出不同的 **description 与 inputSchema**。这是"一套工具、多模型适配"的正规做法，比在提示词里写"如果你是 X 模型就用 Y"要干净。

### 2.5 DSH：工具顺序是**不变量**，不是约定

DSH 把工具顺序做成了带测试的公共契约：默认字典序、与注册顺序无关；可用 `toolOrder` 显式指定，但**必须包含 `<unlisted-tools>` 占位符**，否则加载即失败。

```191:228:F:/_oss-research/dsh/packages/core/system-prompt/src/index.ts
/** Reserved {@link Config.toolOrder} marker for unlisted tools. */
export const TOOL_ORDER_REST = '<unlisted-tools>'
...
function orderTools(tools: ToolSchema[], toolOrder: string[] | undefined, knownNames: ReadonlySet<string>): ToolSchema[] {
  const reserved = tools.find(tool => tool.name === TOOL_ORDER_REST)
  ...
  if (toolOrder === undefined) return tools.sort(compareToolNames)
```

测试直接把这条钉死（`Github` .../packages/core/system-prompt/tests/tool-order.spec.ts）：

```32:52:F:/_oss-research/dsh/packages/core/system-prompt/tests/tool-order.spec.ts
  it('assembles tools in lexicographic name order when no toolOrder is configured', async () => {
    const ctx = await mount()
    ctx.systemPrompt.tools(() => ({ schemas: [tool('charlie'), tool('alpha')] }))
    ctx.systemPrompt.tools(() => ({ schemas: [tool('bravo')] }))
    expect(names(await ctx.systemPrompt.assemble())).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('assembles the same order regardless of provider registration order', async () => {
    ...
    expect(names(await forward.systemPrompt.assemble())).toEqual(['alpha', 'zulu'])
    expect(names(await backward.systemPrompt.assemble())).toEqual(['alpha', 'zulu'])
  })
```

另有 `invariant.ts` 在 `system-prompt/assemble` 瀑布口校验：段名非空、段名唯一、工具名非空、变量名符合 `^[a-z][a-z0-9_]*$`。

```19:40:F:/_oss-research/dsh/packages/core/system-prompt/src/invariant.ts
function validateAssembly(assembly: PromptAssembly, fail: InvariantFailure): void {
  const sectionNames = new Set<string>()
  for (const section of assembly.sections) {
    if (section.name.length === 0) fail('assembled section names must be non-empty')
    if (sectionNames.has(section.name)) fail(`assembled section name ${JSON.stringify(section.name)} is duplicated`)
    sectionNames.add(section.name)
```

### 2.6 Grok Build：同一仓库里并存 5+ 套工具集，靠"语义类别"归一化

`implementations/` 下不是一套工具，而是多套：

```
crates/codegen/xai-grok-tools/src/implementations/
├── codex/                 # apply_patch, grep_files, list_dir, read_file
├── opencode/
├── grok_build/            # bash, search_replace, read_file, grep, list_dir, task, todo, web_search, monitor, workflow, ...
├── grok_build_concise/    # 精简变体
├── grok_build_hashline/   # 行号编辑变体
├── cursor_rules_on_read/  # 读文件时顺带注入 .cursor/rules
├── lsp/ memory/ skills/ web_search/ task_output/ use_tool/ ...
```

为了不让提示词跟着工具集漂移，它定义一个跨 harness 的**工具语义词表** `ToolKind`（`Read`/`Edit`/`Search`/`Execute`/`Task`/`Plan`/`WebSearch`/`MemorySearch`/…），并给每个 kind 一个统一的展示名：

```46:72:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/tool_taxonomy.rs
    pub fn presentation_name(self) -> &'static str {
        match self {
            ToolKind::Read => "Read",
            ToolKind::Edit => "Edit",
            ...
            ToolKind::Execute => "Run Command",
            ToolKind::Plan => "Plan",
            ToolKind::Task => "Subagent",
            ToolKind::EnterPlan => "Enter Plan Mode",
            ToolKind::ExitPlan => "Exit Plan Mode",
```

外加一个规范化 `_meta` 信封 `x.ai/tool`（版本号 `TOOL_META_VERSION: u32 = 1`），让 UI/遥测/权限在工具名变化时仍能对齐。

### 2.7 DSH：工具集由 preset 决定，连"只有一个工具"的形态都有

DSH 出货 4 个 preset（`packages/preset/agent-presets/presets/*/preset.yml`），它们的差异不只是模型参数，而是**整套工具目录 + 提示词拼装方式**：

| preset | 中文名 | 工具集特征 |
| --- | --- | --- |
| `standard` | 标准模式 | 完整工具集 |
| `ptc` | PTC 模式 | 默认不给 `workflow`，其余工具通过 `run_code`（一段 TS/Python 程序编排多步调用）呈现 |
| `minimal` | 极简模式 | **只有一个持久 shell 工具**，固定提示词、无运行时上下文、无压缩 |
| `cordis` | 创造模式 | 标准能力 + 运行时检查 + 插件管理 + preset 创作 |

`minimal` 的注释把"为什么这么设计"写清楚了：

```1:10:F:/_oss-research/dsh/packages/preset/agent-presets/presets/minimal/agent.cordis.yml
# The `minimal` agent preset: a fixed-prompt, single-tool coding-agent composition.
#
# The persona is the complete system prompt, so global identity, Web orientation,
# tool guidance, and later assembly listeners cannot add prompt text. Runtime
# context snapshots are suppressed for this preset, and the model receives only
# the persistent shell (`bash` on POSIX, `pwsh` on win32). Context compaction is
# absent.

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: You are a helpful software engineer assistant.
    complete: true
    includeRuntimeContext: false
```

`complete: true` 的语义是"系统提示就是这一段"——assembly 仍跑完整流程以解析工具与变量，然后把系统提示**收敛回这一节**，出现第二个 `complete` 段直接报错。

**这条对我们的启发**：工具集的"可组合"不只是"多支持一个工具"，也包括"能给出一条完全不同的极简形态"。我们的 `createCodingTools` / `createReadOnlyTools` 是同一根轴上的两个点，缺这种"整预设"的表达力。

### 2.8 Grok Build：注册一次、五套命名空间；外加一套"工具调用修复"四件套

全部内置工具在**唯一构造器**里一次性注册，注册键是 `Namespace:id`，五套工具集（GrokBuild / Codex / OpenCode / Concise / Hashline）共用同一个注册表。工具定义只有三个必需方法，`description_template()` 直接返回 MiniJinja 模板字符串，schema 由 Rust 类型经 schemars 生成后再按 `param_map` 重映射属性名。

**它没有"按模型版本裁剪工具集"这种机制**——差异来自 `behavior_preset` / `contract_version`（工具行为版本，配置驱动）与 `api_backend`（例如只有 Anthropic Messages 后端不暴露 file-form 的 `use_tool`）。按模型变的是采样参数与身份标签：

```
crates/codegen/xai-grok-models/default_models.json 里每个模型带
api_backend / supports_backend_search / system_prompt_label / compactions_remaining
```

真正值得抄的是**参数修复四件套**（这类 bug 在自家模型上尤其常见）：

| 机制 | 解决什么 | 位置 |
| --- | --- | --- |
| 宽松反序列化 | 模型把数字写成字符串（`"123"` → `123`） | `implementations/grok_build/bash/mod.rs:226-236` |
| 结构化校验错误 | 回给模型的不只是"参数错"，而是 `field_path` / `expected` / `bad_value` / `category` | `types/params_validation.rs:49-90` |
| 历史完整性修复 | dangling tool call、重复 tool result | `xai-chat-state/src/actor/state.rs:195-215` |
| 指数退避重试 | 传输层抖动 | `xai-grok-tools/src/retry.rs:47-100` |

并行工具调用用 `FuturesUnordered` 并发执行，结果**按原始下标还原槽位**（`session/acp_session_impl/tool_calls.rs:980-986`）——顺序不会因为完成时间不同而漂移，这对缓存和可读性都是必要的。

- 笔记与永久链接：`docs/research/notes/grok-build.md` 第 1 章

---

## 3. 缓存机制优化

把四家的做法按"缓存类型"归类，差异立刻清楚：

| | Anthropic 式显式断点 | OpenAI 式 cache key | DeepSeek 式前缀缓存 |
| --- | --- | --- | --- |
| Pi | ✅ 最后一个 tool + 最后一条 user 消息；可选 `1h` TTL | ✅ `prompt_cache_key`（截断到 64 字符） | 复用（依赖前缀稳定） |
| ZCode | ✅ 三个 system 块各带标记 + 最后一条真实 user 消息 | — | 复用 |
| DSH | （adapter 层） | — | ✅ **架构级**：in-history 系统提示、压缩复用热前缀 |
| Grok Build | ✅ 4 个断点的扫描式布局 | ✅ 字段预留 | 复用 |

### 3.1 ZCode：系统提示被切成三块，每块各带缓存标记

```230:275:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/context/builder.ts
    const cliPrefixContent = buildSectionContent(
      sections.filter(
        (section) => section.injectionTarget === "system" && section.source === "cli_prefix",
      ),
    );
    if (cliPrefixContent) {
      messages.push({
        role: "system",
        content: cliPrefixContent,
        cacheControl: EPHEMERAL_CACHE_CONTROL,
      });
    }

    const stableBodyContent = buildSectionContent(
      sections.filter(
        (section) =>
          section.injectionTarget === "system" &&
          section.cacheHint === "stable" &&
          section.source !== "cli_prefix",
      ),
    );
    if (stableBodyContent) {
      messages.push({
        role: "system",
        content: stableBodyContent,
        cacheControl: EPHEMERAL_CACHE_CONTROL,
      });
    }

    const dynamicSystemContent = buildSectionContent(
      sections.filter(
        (section) => section.injectionTarget === "system" && section.cacheHint === "dynamic",
      ),
    );
```

关键在于每个 section 自己声明 `cacheHint: "stable" | "dynamic"`，**易变内容不会挤进稳定块**。缓存标记则统一落在"最后一条真实 user 消息"上：

```302:313:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/runtime/helpers/provider-request-messages.ts
  const cacheControlIndex =
    ...
  if (cacheControlIndex === undefined) return undefined;

  const message = messages[cacheControlIndex]!;
  messages[cacheControlIndex] = {
    ...message,
    cacheControl: { type: "ephemeral" },
  };
```

### 3.2 ZCode：提醒按"投递通道"分类，避免污染前缀

这是本次调研里设计感最强的一段。每种提醒都被登记了 `channel`（去哪）、`lifecycle`（活多久）、`providerVisibility`（模型看不看得见）：

```1:41:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/system-reminder/source.ts
type SystemReminderDeliveryChannel =
  | "request_prefix"
  | "current_turn"
  | "tool_result"
  | "history_continuity"
  | "mid_turn_event"
  | "real_user";

type SystemReminderLifecycle =
  | "request_prefix"
  | "per_current_turn"
  | "runtime_local"
  | "tool_result"
  | "resume_history"
  | "mid_turn_event"
  | "real_user";

type SystemReminderProviderVisibility = "provider_visible" | "provider_hidden";

export const SYSTEM_REMINDER_PREFIX_SOURCES = ["context_prefix", "skills_listing"] as const;
```

并显式记下"为保前缀复用，冷恢复要按原文重建"：

```118:124:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/system-reminder/source.ts
  // Plugin 对话引用：当轮生成后按
  // model-only synthetic notice 固化，后续只追加、不改写；冷恢复按原文重建以保持缓存前缀。
  plugin_reference: descriptor("current_turn", "per_current_turn", true, "sr.plugin_reference"),
```

注意 `provider_hidden` 这一档：**有些提醒不让 provider 看见**（例如我们的 plan-mode 用 `display:false` 的隐藏消息是同一思路）。

还有一条"搬运"策略：**附件型的 system reminder 会被搬到下一条边界消息之后**，避免在会话中段插入新块、打断已有前缀（`provider-request-messages.ts:106-139` 的 `reorderAttachmentLikeEntries`，它会统计 `bubbledAttachmentEntryCount` 作为诊断）。另外每轮临时提醒**默认不插入新的 system message**，而是合成 user message；只有声明支持"mid-conversation system"的模型才允许插入 system 轮。**注意**：笔记里标注了"为了缓存"这一动机是**推测**（代码注释未写明），事实层面只有"附件被搬后 + 计数入诊断"。

### 3.3 DSH：把「前缀稳定」当成架构推论，再用 `in-history` 收尾

DSH 的出发点和另外三家都不一样：它先立了一条硬约束——**每一次 LLM 请求都必须能从 session log 逐字节重建**——然后指出前缀缓存命中是这条约束的推论，而不是单独去优化的目标：

> Prefix-cache stability is corollary #1, not the headline: an append-only log projected by a per-node pure function yields requests that are append-extensions of their predecessors whenever the header is unchanged — stability is emergent, not managed.
> —— `.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:21`

强制手段不是自律而是测试：`dsh-agent-loop/invariant` 会**用一个全新的 Session 从日志独立重建每一次请求**，再在 `llm/stream` 处比对消息与 header，不允许用 live cache 自证。这条不变量一旦成立，"工具顺序漂移""历史被原地改写"这类事故在结构上就不可能发生。

`compareNames` 也刻意用码点序而非 locale 序，保证跨机器字节一致：

```ts
/** Order tool schemas lexicographically by name. */
function compareToolNames(a: ToolSchema, b: ToolSchema): number {
  return compareNames(a.name, b.name)
}
```

在此基础上，`systemPromptUpdate: in-history` 才是一个"补丁式的例外处理"——DeepSeek 兼容端点把 `messages` 里**最后一条 `system` 消息**当作有效系统提示。于是 DSH 的适配器声明自己支持 `in-history`，agent loop 就把变化后的提示**追加到已缓存历史之后**，而不是重写第 0 条 system 消息：

```363:371:F:/_oss-research/dsh/packages/core/agent-loop/src/agent.ts
      const commits = this.systemPrompt.project(renderedPrompt, {
        inHistory: preparedCall?.systemPromptUpdate === 'in-history',
        startsSeries: startsRequestSeries
          || this.requestSurfaceGeneration !== this.session.surface.contentGeneration
          || this.toolsChanged(assembly.tools),
      })
```

文档把账算得很直白（`packages/core/system-prompt/README.zh.md:151`）：

> 没有 `systemPromptUpdate` 时…头节点重写会**从首个变化的 token 起失去前缀复用**；当已准备调用声明 `systemPromptUpdate: 'in-history'` 时，agent loop 会在同一请求序列延续期间把变化后的非空提示词追加到已缓存历史之后，因此**直到该历史末尾的前缀仍可复用**。

代价与边界也说清楚了（`packages/llm/llm-deepseek/README.zh.md:182`）：工具 schema 变化仍会从第一个改变的 token 起阻断复用；只有声明了该模式的目录条目才有这个待遇。

**完整链路是四步，而且只给了一个模型：**

| 步骤 | 位置 |
| --- | --- |
| ① 模型目录声明能力位 | `packages/llm/llm-deepseek/src/common/models.ts:5-20` |
| ② loop 翻译成"追加新 `system/message`，而不是原地改写 node 0" | `packages/core/agent-loop/src/agent.ts:359-373`、`runtime-context.ts:77-98` |
| ③ 适配器把 mid-history 系统快照插到对应 user/tool 轮之后 | `packages/llm/llm-deepseek/src/protocols/messages/serialize.ts:58,84-96` |
| ④ 未声明的模型主动放弃该优化 | `packages/llm/llm-deepseek/src/common/model-info.ts:78` |

目录里只有 `deepseek-flash`（DeepSeek-V41-Flash）声明了它；**更贵的 `deepseek-v4-pro` 反而没有**：

```5:20:F:/_oss-research/dsh/packages/llm/llm-deepseek/src/common/models.ts
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek-V41-Flash',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'],
    systemPromptUpdate: 'in-history',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; ...',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
]
```

为什么旗舰模型反而没有——**源码没有给理由，属于推测**：可能是该端点尚未支持 mid-history 的 system 消息。这条值得留意：**同一个 harness 里，缓存优化是"按模型端点能力逐条声明"的，不是全局开关**。

### 3.4 DSH：压缩（compaction）复用"热前缀"

摘要调用不是发一个干净的新请求，而是**逐字回放**会话最后一次已路由请求的系统提示、工具与消息，让摘要请求成为会话真正的前缀：

> The replayed system prompt, tools, and shadowed-region messages match the conversation's last routed request **byte-for-byte**, so the provider's warm prefix cache is reused up to the trailing instruction; only that instruction, and the summary output, is uncached.
> —— `packages/compaction/compaction-basic/README.md:233`

拿不到会话路由时用 `GenerateOptions.purpose = 'compaction'` 标记用途（不会被当成正常轮次计入）。

### 3.5 Pi：显式缓存断点 + 缓存浪费核算

Pi 的 Anthropic 适配器同时打**工具尾断点**和**消息尾断点**：

```1451:1459:F:/_oss-research/pi-ai-src/pi-ai/src/api/anthropic-messages.ts
		return {
			name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
			...(strict === true ? { strict: true } : {}),
			input_schema: inputSchema,
			...(deferLoading ? { defer_loading: true } : {}),
			...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
		};
```

```1372:1394:F:/_oss-research/pi-ai-src/pi-ai/src/api/anthropic-messages.ts
	// Add cache_control to the last user message to cache conversation history
	if (cacheControl && params.length > 0) {
		const lastMessage = params[params.length - 1];
		if (lastMessage.role === "user") {
			if (Array.isArray(lastMessage.content)) {
				const lastBlock = lastMessage.content[lastMessage.content.length - 1];
				if (
					lastBlock &&
					(lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")
				) {
					(lastBlock as any).cache_control = cacheControl;
				}
```

保留时长是分级可配的，`PI_CACHE_RETENTION=long` 时用 1 小时 TTL：

```53:77:F:/_oss-research/pi-ai-src/pi-ai/src/api/anthropic-messages.ts
	if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
		return "long";
	}
	return "short";
}

function getCacheControl(
	model: Model<"anthropic-messages">,
	cacheRetention?: CacheRetention,
	env?: ProviderEnv,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
	const retention = resolveCacheRetention(cacheRetention, env);
	if (retention === "none") {
		return { retention };
	}
	const ttl = retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention ? "1h" : undefined;
```

另外 Pi 在 Anthropic 上还有一个"伪装 Claude Code"的开关——把工具名改写成 Claude Code 的规范大小写（`Read`/`Bash`/`TodoWrite`…），列表来源标注为 `cchistory`（Claude Code 历史提示词存档）：

```80:105:F:/_oss-research/pi-ai-src/pi-ai/src/api/anthropic-messages.ts
// Stealth mode: Mimic Claude Code's tool naming exactly
const claudeCodeVersion = "2.1.251";

// Claude Code 2.x tool names (canonical casing)
// Source: https://cchistory.mariozechner.at/data/prompts-2.1.11.md
// To update: https://github.com/badlogic/cchistory
const claudeCodeTools = [
	"Read", "Write", "Edit", "Bash", "Grep", "Glob", ...
];
```

**注意**：在我们的代码里，这条路径只在 OAuth token 场景生效（`isOAuthToken ? toClaudeCodeName(tool.name) : tool.name`）。**推测**其目的是让请求在服务端/网关看起来与 Claude Code 同形，从而复用同一套缓存与限流假设。

Pi 真正独有的一项是**缓存浪费核算**：把"本应命中却按全价重算的 token 和钱"算出来。

```1:40:F:/_oss-research/pi-src/core/cache-stats.ts
/**
 * Prompt-cache TTL: idle gaps longer than this are worth mentioning as the
 * likely cause of a miss. Anthropic's default cache TTL is 5 minutes.
 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-turn misses at or below this are cache breakpoint granularity noise. */
const NOISE_FLOOR_TOKENS = 1024;
```

```71:83:F:/_oss-research/pi-src/core/cache-stats.ts
	const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
	if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;
	...
	return {
		missedTokens,
		missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
		idleMs: Math.max(0, message.timestamp - prev.timestamp),
		modelChanged: `${message.provider}/${message.model}` !== prev.modelKey,
	};
```

扫描时把 `compaction` / `branch_summary` 之后的轮次排除（上下文合法变了，不算浪费）：

```128:140:F:/_oss-research/pi-src/core/cache-stats.ts
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			// The context legitimately changed; the next turn's prompt is new content,
			// not re-billed content. Model switches are NOT exempt: they re-bill the
			// full prompt and should be counted.
			prev = undefined;
			continue;
		}
```

以及一个容易忽略的成本优化：**一次性摘要不要买缓存写入**。

```584:594:F:/_oss-research/pi-src/core/compaction/compaction.ts
	// Avoid cache writes for one-off summaries. Reuse caller-supplied routing when available;
	// callers without a session ID, including branch summaries, receive a fresh routing ID.
	const requestOptions: SimpleStreamOptions = {
		...options,
		cacheRetention: "none",
		sessionId: options.sessionId ?? uuidv7(),
	};
```

### 3.6 Grok Build：4 个缓存断点，还要给"网关自动缓存"留一格

Grok 的断点布局是全篇最讲究的一段，注释把设计约束写全了（`Github` .../xai-grok-sampling-types/src/conversation/messages.rs#L1-L73）：

```1:17:F:/_oss-research/grok-build/crates/codegen/xai-grok-sampling-types/src/conversation/messages.rs
/// Marks the last block that can carry one, scanning back past `Thinking`, which the API rejects a breakpoint on.
fn mark_message_cache_breakpoint(msg: &mut crate::messages::Message) -> bool {
    ...
            for block in blocks.iter_mut().rev() {
                let cache_control = match block {
                    ContentBlock::Text { cache_control, .. }
                    | ContentBlock::ToolResult { cache_control, .. }
                    | ContentBlock::Image { cache_control, .. }
                    | ContentBlock::ToolUse { cache_control, .. } => cache_control,
                    ContentBlock::Thinking { .. } | ContentBlock::RedactedThinking { .. } => {
                        continue;
                    }
                };
                *cache_control = Some(CacheControl::ephemeral());
```

```38:43:F:/_oss-research/grok-build/crates/codegen/xai-grok-sampling-types/src/conversation/messages.rs
/// An entry is written only at a breakpoint, so marking the system prompt alone leaves the transcript uncached.
/// The third covers a turn that appends more than the API's 20 block lookback.
/// The fourth slot stays free: a gateway that turns on automatic caching takes it, and five is rejected outright.
fn apply_cache_breakpoints(
```

四个断点分别是：system 尾块、消息尾部、**上一轮结束处**（跨过整段连续 user 消息）、以及留白给网关。第四点尤其值得学：**预留一格给"别人也会打断点"的情况**，否则上限 5 个断点会被第三方网关挤爆。

#### 它还把"前缀稳定"写成了断言测试

Grok 直接在 chat-state 的测试里做了一个通用断言：**请求 N 的序列化输入必须是请求 N+1 输入的字节前缀**，不一致就报出第一个分歧下标。

```text
/// Assert that request N's serialized input is a byte-stable prefix of
/// request N+1's.
fn assert_prefix_stable_pair(base, extended, label) {
    ...
    assert_eq!(
        ext_input.get(..base_input.len()).unwrap_or(&[]),
        base_input.as_slice(),
        "{label}: prefix broken. Base has {} items, extended has {}. First divergence at index {}",
```

并用参数化测试覆盖了各种会破坏前缀的功能：记忆注入、推理兄弟项、**工具 schema 变化**、模型切换、合成 user 消息。其中工具那条的注释是：

> `prefix_stable_after_tool_schema_change` — "Changing the tool set between requests must not affect the input prefix"

这条尤其值得注意：**换工具集也不能影响前缀**。这和我们 plan-mode 的做法正好相反（见 §6.1）。

- 来源：`F:/_oss-research/grok-build/crates/codegen/xai-chat-state/src/actor/tests.rs:4704-5010`
- Github：https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/tests.rs#L4704-L4755

#### 为保缓存而做的六处具体妥协（最能说明"意图"）

| # | 妥协 | 原话 |
| --- | --- | --- |
| a | 跨零点**不改** `<user_info>` 里的日期，改发一次性 system-reminder | "The cached `<user_info>` prefix keeps its startup date to preserve the prompt cache." |
| b | 记忆块**禁止重打分** | "A re-scored block would mutate the system-prompt prefix and bust the KV cache for the whole downstream conversation." |
| c | 图片剔除用**迟滞**：触顶前不动，一动就砍到一半 | "Clearing only the trigger would re-cross and re-bust the KV cache every turn." |
| d | 子代理的工具投影必须与父会话**字节一致** | "That keeps the child's request prefix byte-identical to the parent for radix cache reuse." |
| e | 子代理 fork **强制继承父模型**（radix 前缀按模型划分） | — |
| f | 计划器/镜像子代理**不允许插入前缀** | — |

- 来源：`crates/codegen/xai-grok-shell/src/session/acp_session_impl/reminders.rs:505-507`、`.../helpers/memory_context.rs:15`、`crates/codegen/xai-chat-state/src/image_budget.rs:20-31`、`crates/codegen/xai-grok-shell/src/session/acp_session.rs:823-826`
- 线格式层还留着**历史 bug 记录**：曾因助手项顺序写成 `[Sys, U1, ..., UN, R*, A*]` 而打死服务端前缀缓存，现在是 `[Sys, U1, R, BTC*, A1, U2, ...]` 的发射序（`crates/codegen/xai-grok-sampling-types/src/conversation.rs:4388-4390`）。

**这六条是本文里"最可执行的缓存经验"**：每一条都把"省一次缓存失效"排在了"代码更简单"前面。

#### 还有三处细节

**（1）辅助调用主动"搭便车"。** `prompt_cache_key` 只在 Responses 后端上线；recap / 摘要这类 side call **刻意复用父会话的 id**，以落到父回合已经暖好的前缀上（`xai-grok-sampling-types/src/types.rs:1045-1050`、`session/acp_session_impl/side_call.rs:102-131`）。这和 Pi 的做法正好相反——Pi 的摘要是 `cacheRetention: "none"` + 全新 sessionId（**不买缓存写入**）。两家逻辑都对：Pi 认为一次性摘要不值得付写入费，Grok 认为复用语义上更接近的开销更省。真正的判据是"这个辅助请求会不会重复出现"。

**（2）压缩本身是一个前缀断点。** 两段式压缩用 `fingerprint_prefix` 校验缓存的 NOTE₁ 是否仍然有效（`session/compaction.rs:348-360`）——**把"缓存是否还有效"做成了可校验的指纹**，而不是假设它还有效。

**（3）缓存命中率有显式遥测字段**：`cached_prompt_tokens` / `cache_creation_prompt_tokens` / `cache_read_rate` / `cache_write_rate`。

另外一个反直觉的设计：**时间戳根本不进 system prompt**（`build_timestamp_utc` 不属于渲染占位符），唯一进入前缀的时间量是**会话启动日期**——这就是为什么它宁愿在跨零点时发一条 reminder，也不去改那一个日期字符串（见上表 (a)）。

### 3.7 工具结果裁剪：一家"砍中间"，一家"清旧的"

工具结果是上下文里体积最大、也最容易反复膨胀的部分。两家都在不动历史结构的前提下处理它，但手法不同。

#### DSH：中间裁剪，纯代码、可重放

历史里已经存在的大结果不能再改写（会砸缓存），但可以**在写入日志之前**就把中间段换掉；已经进历史的结果则用"单节点 surface replace"收缩，并把省下的 token 记账。默认阈值是 8192 字符触发、保留头 4096 + 标记 + 尾 1024：

```ts
/** Fixed marker substituted for every removed middle span. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** Low-friction defaults for coding-agent tool output. */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
})
```

它在包的开头就声明自己是 **model-free**（不为了省 token 再花一次模型调用）且 **replay-safe**（重放安全）：

```
Replay-safe, model-free tool-result pruning service.
```

- 来源：`F:/_oss-research/dsh/packages/compaction/compaction-tool-result-pruner/src/config.ts:6-14` 与同包 `src/index.ts:1-5`
- Github：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-tool-result-pruner/src/config.ts#L6-L14

对照我们的现状：Pi 只有"整体截断 + 落盘"，**没有"保头保尾、砍中间"**这一档。对 `npm test` 这类"开头是配置、结尾是结论、中间几千行是重复堆栈"的输出，中间裁剪比整体保尾更省也更保真。

#### ZCode：微压缩——在"不压缩"和"整段摘要"之间还有一档

ZCode 的自动压缩按 `上下文窗口 − 输出预留 − buffer` 算阈值（`compact/policy.ts:8-19`），但真正值得抄的是**在达到阈值之前**先做的事：只清掉**旧工具结果的内容**，保留最近 5 条，其余替换为一个固定占位符。

```12:27:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/compact/microcompact.ts
export const MICROCOMPACT_CLEARED_TOOL_RESULT_PREFIX = "[Old tool result content cleared]";
export const MICROCOMPACT_CLEARED_TOOL_RESULT_MESSAGE = "[Old tool result content cleared]";
export const DEFAULT_MICROCOMPACT_KEEP_RECENT_TOOL_RESULTS = 5;
const DEFAULT_MICROCOMPACT_IDLE_THRESHOLD_MINUTES = 60;
export const DEFAULT_MICROCOMPACT_MIN_TOKEN_SAVINGS = 256;
export const DEFAULT_MICROCOMPACT_THRESHOLD_RATIO = 0.9;
export const DEFAULT_MICROCOMPACT_THRESHOLD_BUFFER_TOKENS = 2_000;
export const DEFAULT_MICROCOMPACT_COMPACTABLE_TOOLS = [
  "Read",
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Edit",
  "Write",
  "ApplyPatch",
] as const;
```

几个设计点都很实在：

- **只清"内容"不清"结构"**——`tool_use` / `tool_result` 的配对骨架保留，只把正文换成占位符，所以历史形状不变、前缀破坏面最小；
- **保留最近 5 条**，模型仍在看当前的工具结果；
- **只在空闲超过 60 分钟时才考虑**（`IDLE_THRESHOLD_MINUTES`）——空闲意味着缓存本来就要过期，此时清理不额外损失什么；
- **省不够就不动**：`MIN_TOKEN_SAVINGS = 256`；
- **有一张可清理工具白名单**，不是所有工具结果都能清。

**这一档对我们的价值最高**：它不引入新协议、不需要模型参与、也不改变消息结构，却能在一个长会话里持续回收上下文。我们现在只有"压缩"这一个粗暴档位。

- 来源：`F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/compact/microcompact.ts:12-27`、`compact/policy.ts:8-19`
- Github：https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/apps/zcode-cli/packages/core/src/compact/microcompact.ts#L12-L27

### 3.8 缓存优化的"最小公式"

综合三家，能落到代码的稳定前缀约束只有四条：

1. **顺序固定**（工具字典序 / 参考实现字母序）——DSH 用不变量测试保证，ZCode 用白名单排序。
2. **易变内容后移或分流**（cwd、日期、提醒、todo）——ZCode 用 `cacheHint` + 通道；Pi 把 cwd 追加到最后一行。
3. **头部重写换成尾部追加**——DSH 的 `in-history` 是唯一把它做成协议能力的。
4. **量化它**——Pi 的 `missedTokens / missedCost`、DSH/Grok 把 `cached_tokens` 映射进用量桶；我们桌面端的 CacheRing 与 `src/main/usage.ts` 是同一条思路。

---

## 4. 注入提示词优化（coding 方向）

### 4.1 Grok：MiniJinja 模板 + 语义占位符，一份提示词喂所有工具集

模板渲染器在 finalize 时构建一次，把"工具 kind → 对外工具名"的映射塞进去，模板里写 `${{ tools.by_kind.read }}` 而不是硬编码 `Read`：

```1:12:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/types/template_renderer.rs
//! Pre-built template renderer for tool/param name resolution and
//! host-shell branching.
//!
//! `TemplateRenderer` is built once at finalize time with the tool kind →
//! client-facing name mappings and stored in Resources. Tools and reminders
//! call `render()` at runtime to resolve `${{ tools.by_kind.read }}`,
//! `${{ params.edit.old_string }}`, etc. Host-shell flags
//! (`is_windows`, `shell_uses_semicolon`, `has_unix_utilities`) are
//! computed once at construction so templates can branch on the runtime
//! environment without per-tool plumbing.
```

宿主 shell 差异也在模板里分支，而不是在代码里写 if：

```48:57:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/types/template_renderer.rs
struct TemplateContext {
    tools: ToolsContext,
    params: HashMap<String, HashMap<String, String>>,
    /// `cfg!(not(unix))`.
    is_windows: bool,
    /// `powershell.exe` 5.1 and `cmd.exe` chain with `;`; everything else
    /// with `&&`. Used by templates that document command chaining.
    shell_uses_semicolon: bool,
    /// Whether `grep`, `head`, `tail`, `sed`, `awk`, `find` are usable from the active shell.
```

### 4.2 Grok：提示词本体在仓库里是 XOR 混淆的（我已解出）

```1:6:F:/_oss-research/grok-build/crates/codegen/xai-grok-agent/src/prompt/template.rs
//! Templates are XOR-obfuscated by `scripts/encrypt_templates.py` so they don't appear as obvious plaintext in `strings` output.
//! This is obfuscation, not security; the seeds live in-repo.
//! They are decrypted on demand and the returned `Zeroizing<String>` wipes the plaintext from memory on drop.
```

seed 就在同目录：`PROMPT_SEEDS: [u8; 3] = [0x5A, 0x7B, 0x3D]`，解密算法 `b ^ (seed + i)`。三份模板解密后：

| 模板 | 明文字符数 | 用途 |
| --- | --- | --- |
| `BASE_PROMPT` | 10,155 | 主 agent |
| `CODEX_PROMPT` | 21,206 | apply_patch 变体（codex 工具集） |
| `SUBAGENT_PROMPT` | 4,902 | 子代理 |

解出的主提示词章节结构（`F:/_oss-research/grok-prompts/base_prompt.md`）：

```
<dangerous_actions>  <work_policy>  <memory>  <background_tasks>
<communication>  <formatting>  <user_guide>  <browser_verification>
```

**它把行为规则按"工具在不在"做条件渲染**，例子：

```7:15:F:/_oss-research/grok-prompts/base_prompt.md
- For clear, reversible local work, do it in the current turn instead of asking permission conversationally or ending with an offer to do it later.
${%- if tools.by_kind.task %}
- When the user explicitly asks you to use subagents or delegate work, those launches are part of the requested outcome: make the `${{ tools.by_kind.task }}` calls near the start of the work. Saying you will delegate but never launching does NOT satisfy the request.
${%- endif %}
```

即：**没装 `task` 工具就不会出现"用子代理"的指令**——从源头消灭"提示词要求调用不存在的工具"这一类幻觉。这一点比我们目前"扩展注入 systemPrompt 附加段"的做法更彻底。

### 4.3 Grok：环境上下文用占位符，且刻意不塞 git 状态

`PromptContext` 把 `os_name` / `shell_path` / `working_directory` / `current_date` / `is_non_interactive` / `system_prompt_label` 全部列为可注入占位符，其中 `is_non_interactive` 让同一份模板在交互与非交互（headless/CI）下给出不同身份：

```2:6:F:/_oss-research/grok-prompts/base_prompt.md
You are ${{ system_prompt_label }} released by xAI. You are ${%- if is_non_interactive %} an autonomous agent that completes software engineering tasks. There is no human operator in this session.${%- else %} an interactive CLI tool that helps users with software engineering tasks.${%- endif %} Your main goal is to complete the user's request, denoted within the <user_query> tag.
```

它还专门处理"用户的请求放在 `<user_query>` 标签里"，与"复制来的界面元数据是上下文而不是指令"的提示相邻——这是对 prompt injection 的正面防御。

**拼装顺序是固定的四段**：base 模板 → `prompt_body`（原样追加）→ AGENTS.md 段 → skills 段。

**它没有"Grok 模型 vs 第三方模型"的提示词分支。** 真正的分支维度是四个：audience（主 agent / 子代理）、promptMode、`TemplateOverride`（Codex / Custom）、以及**工具是否存在**。每模型只改一个身份标签：`You are ${{ system_prompt_label }} released by xAI`（grok-4.6 渲染成 "Grok 4.6"）。

**`<user_info>` 只放四样**：OS、Shell、Workspace Path、Today's date。注意它**默认不注入 workspace 快照、不注入 git status**——笔记把这解释为"刻意对齐训练分布"。这一点很有意思：我们和 Claude Code 都习惯往提示词里塞 git 状态，而 Grok 选择不塞。

**规则文件发现的广度超出预期**：`AGENTS.md` / `Claude.md` / `.claude/rules` / `.cursor/rules` 全部发现，注入形态是 `<system-reminder>`，声明的作用域是"repo root → cwd，深层优先"，并对内容做 **HTML 转义**防注入。注入时分两段——**工作区规则在前，用户规则在后**，且内容里的 `</rules>` 会被中和。

**每轮动态注入分三层**，其中最有意思的是 TodoNudge：**连续 3 轮没有 `todo_write` 就提醒一次**；另有一个默认关闭的 TodoGate。这类"行为矫正"提醒我们不缺（plan-mode 就在做），缺的是**计数与阈值**这种可量化形态。

- 笔记与永久链接：`docs/research/notes/grok-build.md` 第 3 章（`prompt/context.rs:253-282`、`templates/prompt.md:1`、`session/user_message.rs:23-56`、`prompt/agents_md.rs:1-8,381-411`、`system_reminder.rs:10-50`）

### 4.4 DSH：提示词是"段 + 上下文 + 变量"三件套，每段有唯一归属和顺序

`SystemPrompt` 服务提供 `section()` / `contexts` / `variables` 三种注册，按 `order` 排序，段名在同一作用域内唯一（重复注册直接抛错，错误信息提示改用 `agent.ctx`）：

```392:397:F:/_oss-research/dsh/packages/core/system-prompt/src/index.ts
    this.sections = new NamedEntries(name => new Error(scope === undefined
      ? `prompt section "${name}" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`
      : `prompt section "${name}" is already registered in this scope`))
```

内置的开头两段是 harness 身份与部署者 persona：

```431:444:F:/_oss-research/dsh/packages/core/system-prompt/src/index.ts
    if (config.includeHarnessIdentity ?? true) {
      this.section({
        name: 'harness:identity',
        order: this.getSectionOrder('HARNESS_IDENTITY'),
        text: 'You are an AI agent powered by DeepSeek Harness.',
      })
    }
```

上下文注入在独立包里做成可插拔插件，一眼能看出"哪些东西会被注入"：
`packages/context/{agent-instructions, file-reference, session-reference, time-context, tmux-context}`——注意它们**都是单独插件**，没有一个是写死在主循环里的。`time-context` 单独成包，说明"日期"这种每次都会变的内容被刻意隔离管理。

更关键的是这些动态上下文**只在内容真的变了时才写一条新消息**，而不是每轮重写一遍：

```134:152:F:/_oss-research/dsh/packages/core/agent-loop/src/runtime-context.ts
  /**
   * Create an uncommitted snapshot only when the retained value differs.
   * @param current - fully rendered dynamic context.
   * @param sections - named contributions that formed the current snapshot.
   * @returns a candidate user message, or `undefined` when no update is needed.
   */
  project(current: string, sections: readonly ContextSnapshotSection[]): UserMessage | undefined {
    if (this.retained === undefined && current.length === 0) return
    const snapshot = current.length === 0 ? CLEARED : current
    if (this.retained?.text === snapshot) return
```

快照文案固定为"本快照取代更早的快照"（`This snapshot supersedes earlier runtime-context snapshots.`），语义上是**追加**而非改写。`time-context` 默认每步注入时间，同样走追加 user message，并提供 `refreshIntervalMs` 控制历史增长速度。

这是"环境上下文注入"最省缓存的一种形态：**先问"变了没有"，再决定"要不要写"**。我们的做法（把 cwd 放在 system prompt 最后一行）方向一致，但没有"变了才写"的判据。

### 4.5 ZCode：三段注入 + 技能列表走 meta_user 而不是 system

ZCode 的 section 有 `injectionTarget`（`system` / `meta_user`）与 `cacheHint`（`stable` / `dynamic`）两个正交维度。技能清单不进 system 块，而是作为**用户侧元附件**：

```264:281:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/context/builder.ts
  private assembleMetaUserAttachments(sections: ContextSection[]): ContextMetaUserAttachment[] {
    const attachments: ContextMetaUserAttachment[] = [];

    const skillsContent = buildSkillsMetaUserBody(
      sections.filter(
        (section) => section.injectionTarget === "meta_user" && section.source === "skills",
      ),
    );
```

对应 `SYSTEM_REMINDER_PREFIX_SOURCES = ["context_prefix", "skills_listing"]`：这两样是**前缀的一部分**，而"今天日期变了""模型异常""诊断信息"走 `per_request` 通道，不落在稳定前缀里。

**它注入的环境上下文很克制**：cwd、git 状态、平台、shell、OS、当前模型——都是"决定了就得一直一样"的慢变量。

**规则文件的发现范围也比另外两家窄**：默认只有 `AGENTS.md`，外加一个全局的 `~/.zcode/AGENTS.md`。对比 Grok 会去扫 `Claude.md` / `.claude/rules` / `.cursor/rules`，ZCode 没有做兼容性扩张。**推测**这是新产品里"只认自己一套约定"的取舍，好处是注入量可预测、前缀更稳。

**还有一个回答了我原本疑问的点**：ZCode **是否按模型注入不同提示词**——答案是"按能力与正则表驱动，不是 `if (model === "glm-5")`"。也就是说，模型差异被表达成"这批模型具备哪些能力"，而不是"这个模型叫什么名字"。这和 Grok 的 `tools.by_kind.*`、DSH 的 `systemPromptUpdate` 能力位是同一个思路的三次独立出现——**四家里有三家都把"模型差异"建模成了能力位而不是模型名分支**。

### 4.6 我们（Pi + 本地扩展）：已经对了方向，但靠的是约定而不是机制

Pi 把 cwd 放在最后一行，前面全是可缓存内容：

```161:168:F:/_oss-research/pi-src/core/system-prompt.ts
	// Append skills when a tool capable of reading their files is available.
	if (skillFileReadTool && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills, skillFileReadTool);
	}

	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
```

规则文件发现支持 `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md` 的优先级链，加载成 `<project_context>` 块：

```70:95:F:/_oss-research/pi-src/core/resource-loader.ts
function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
```

基础提示词只在**工具集变化**时重建，每轮可被扩展覆盖、运行结束再重置：

```2478:2495:F:/_oss-research/pi-src/core/agent-session.ts
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
```

```1288:1305:F:/_oss-research/pi-src/core/agent-session.ts
			// Apply extension-modified system prompt, or reset to base
			if (result?.systemPrompt !== undefined) {
				this._systemPromptOverride = result.systemPrompt;
				this.agent.state.systemPrompt = result.systemPrompt;
			} else {
				// Ensure we're using the base prompt (in case previous turn had modifications)
				this._systemPromptOverride = undefined;
				this.agent.state.systemPrompt = this._baseSystemPrompt;
			}
```

我们自己的 plan-mode 扩展已经写明了"为什么用隐藏消息而不是拼接"：

```1:8:F:/Projects/pi-agent-desktop/resources/extensions/plan-mode/prompt.ts
/**
 * What the model is told, and when.
 *
 * The reminders are injected as hidden messages (`display: false`) rather than
 * concatenated onto the user's prompt: the transcript keeps the sentence the
 * user actually typed, the instructions ride along for the model, and the
 * system prompt itself stays byte-stable so the cached prefix survives.
 */
```

Ultra 的委托授权也只走 `before_agent_start`，且**先确认工具真的在**才注入：

```60:69:F:/Projects/pi-agent-desktop/src/main/ultra-extension.ts
  pi.on("before_agent_start", async (event) => {
    if (!options.isUltra()) return undefined;
    /* promise the model nothing it cannot do: the strong grant is only
     * injected when the delegation tools are actually on the table */
    const teamReady = pi.getAllTools().some((tool) => tool.name === "spawn_agent");
    if (!teamReady) return undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${proactiveGrant(options.maxAgents())}` };
  });
```

**差距**在于：这些是"我们写代码时记得这么做"，而不是"系统不允许你那么做"。ZCode 用 `cacheHint` 类型、DSH 用不变量测试把同一件事变成了**编译期/测试期约束**。

---

## 5. bash / 终端优化

### 5.1 执行模型：一次性进程 vs 持久 PTY

| | 模型 | 证据 |
| --- | --- | --- |
| Pi | **每次调用新起进程**（无持久 shell） | `pi-src/core/tools/bash.ts` 里 `spawn(shellConfig.shell, [...args, command])`，命令通过 argv 或 stdin 传入 |
| ZCode | **完全没有 PTY**；每次调用新起 shell + 会话级 cwd 记忆 + 用用户 profile 初始化 | `core/src/tool/handlers/bash-cwd-policy.ts`、`bash-prompt.ts` |
| DSH | **两种都提供，按需选** | `packages/shell/tool-bash` 与 `tool-bash-persistent` |
| Grok | 由 Terminal 后端决定；本地后端**模拟**持久化 | `implementations/grok_build/bash/mod.rs` 文件头注释 |

#### ZCode：不搞持久 shell，但把"能持久的那个东西"（cwd）单独持久化了

仓库依赖里**没有 `node-pty`**，所以不存在持久终端这条路。它做的是一件更轻的事：**每次新起 shell，但记住 cwd**。而且它把这件事**写进了工具描述**，模型知道自己的环境契约是什么：

```1:23:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/bash-prompt.ts
export function createBashProviderDescription(input: {
  defaultTimeoutMs: number;
  embeddedSearchEnabled?: boolean;
  maxTimeoutMs: number;
}): string {
  const avoidCommands = input.embeddedSearchEnabled
    ? "`cat`, `head`, `tail`, `sed`, `awk`, or `echo`"
    : "`find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo`";

  return [
    "Executes a bash command and returns its output.",
    "",
    "- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
```

注意最后一句的三个信息量：**目录持久、变量不持久、shell 由用户 profile 初始化**。这三句话让模型不会去猜"我上次 `export` 的东西还在不在"。

cwd 写回策略也带着边界保护——**只有成功、且解析出的物理路径仍在 workspace 内**才写回，越界就重置并明确告知：

```33:48:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/bash-cwd-policy.ts
export function decideBashCwdPolicy(input: BashCwdPolicyInput): BashCwdPolicyDecision {
  if (input.status !== "completed") return {};
  if (input.exitCode !== 0) return {};
  if (!input.resolvedCwd) return {};
  if ((input.runtimeScope ?? "main") !== "main") return {};

  const boundary = normalizeCwdBoundaryInput(input);

  if (isResolvedCwdInsideWorkspace(boundary)) {
    return { nextWorkingDirectory: boundary.resolvedCwd };
  }

  return {
    nextWorkingDirectory: boundary.workspaceRoot,
    stderrSuffix: `Shell cwd was reset to ${boundary.workspaceRoot}`,
  };
}
```

**这是"最便宜的一档持久化"**：不引入 PTY、不承担状态腐烂，只保留 90% 场景真正需要的那个状态（cwd），并且给它加了越界重置。如果我们要做持久化，建议先抄这一档，而不是直接上 PTY。

DSH 把取舍写得很清楚（`packages/shell/tool-bash-persistent/README.md`）：

> Give an agent a `bash` tool whose **cwd, exported variables, functions, and background jobs persist across calls**. Each agent receives an isolated shell, and its commands run sequentially. … `exit`, timeout, or cancellation **resets the shell**, while interactive commands that wait for stdin may run until timeout.

Grok 的方案是"后端契约"而不是实现细节——同一份工具描述在持久/非持久后端下都成立，本地后端用状态捕获重放来伪装持久：
```1:8:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
//! Executes bash commands with optional timeout. Whether shell state (cwd,
//! env vars, aliases) persists between calls depends on the `Terminal`
//! backend: the local backend emulates persistence by capturing and
//! replaying state across commands (see [`crate::computer::local::shell_state`]);
//! other backends may run each command in a fresh session.
//! Supports both foreground (blocking) and background (returns task_id) execution.
```

值得抄的是"**按能力划分工具**"而不是"用一个开关":DSH 直接给两个不同的工具名（`bash` 一次性 / `bash` 持久），模型按环境契约选择，而不是靠参数猜。

#### Grok 的"伪持久"实现细节，以及一条值得我们立刻抄走的做法

它的持久化不是留着一个 shell，而是**每次新进程 + 状态 dump/replay**：用一段脚本把 env / cwd / 函数 / 别名 / shell options 经 fd3、fd4 往返回放。初始化走**交互式 login shell**（`-ilc`）并加载用户 rc，带 15 s 超时，MOTD 用 marker 切掉。cwd 变化检测取 dump 首行，**非绝对路径则拒绝更新**（防 prompt injection 把 cwd 骗走）。

而**每次调用都强制覆盖三个环境变量**：

```
TERM=dumb        NO_COLOR=1        FORCE_COLOR=0
```

外加一个 `GROK_AGENT` 标记（防止请求里的 env 清除把它抹掉）。

**这比我在 §6 写的"在 harness 里 stripAnsi"更根本**：从源头让子进程不要输出颜色。我们目前两件事都没做——既没有 `NO_COLOR`，工具路径也没有 ANSI 清洗。**建议优先做环境变量这一条**，一行代码、零解析开销，且顺带让输出在日志/临时文件里也是干净的。

- 笔记：`docs/research/notes/grok-build.md` 4.2 节（`computer/local/shell_state.rs:1-8,45-56,270-312,466-481`）

### 5.2 输出预算与"什么被丢掉"

四家全都把"第一个 N 字节还是最后 N 字节"当成显式决策：

| | 阈值 | 保留策略 | 溢出后去处 |
| --- | --- | --- | --- |
| Pi | 2000 行 **或** 50 KB（先到先算） | bash **保尾**、read **保头**、永不返回半行（尾截断有唯一例外） | 临时文件 `pi-bash-<id>.log`，消息里给出路径与已显示行号区间 |
| ZCode | 工具默认 **100,000 字节**（`truncate` + **保头**）；bash 覆盖为 **30,000** 字节 | 三档策略 `inline \| truncate \| artifact` 由工具自己声明 | `artifact` 档落盘并回报路径 |
| DSH | 持久 bash `maxOutputChars` = 16,000 | `content.slice(0, maxOutputChars)`，**保头**并附截断说明（工具可见层） | `spill` / `spill-local` / `spill-policy` 三包 |
| Grok | 工具默认 **40,000 字节**；bash **20,000 字符** | **保头 + 保尾**（按字符数各留一半，中间插 `... (output truncated) ...`） | 全量写到会话输出文件，结果里给出路径 |

#### ZCode：预算不是常数，而是工具自己声明的"三档策略"

它的契约层直接给了一个枚举：

```ts
export type ToolResultBudgetStrategy = "inline" | "truncate" | "artifact";
```

- `inline`：原样进模型；
- `truncate`：按 `preview.direction` 截断（默认 `head`）；
- `artifact`：全量落盘，模型只看到预览与路径。

**没有声明预算的工具拿到的默认值是 100,000 字节 + `truncate` + 保头**（`executor/result-serialization.ts:33-43`），bash 那个 30,000 是它自己的覆盖值。而且序列化结果必须同时报出五个数：原始字节、**实际进模型的字节**、是否截断、用了哪档策略、artifact 落在哪（`tool/types.ts:436-450`）。

最后那个"实际进模型的字节"有个很细的坑被专门处理了：受保护的 CUA 结构化帧里，图片块在序列化文本里只渲染成短占位符，但**真实 base64 栅格是原样发送的**——所以计量必须算"序列化文本 + 真实媒体载荷"，否则用量统计会少计图片。

**对我们的启发**：我们现在只有一个全局常数（2000 行 / 50 KB）。合理的形态是把它变成**每个工具可声明**的一档配置，并且让计数与展示都基于"实际进模型的字节"，而不是"我们以为截到了多少"。

注意这里有两个**方向性分歧**，都必须明确选一个并写进工具描述，否则模型不知道自己看到的是哪一段：

1. Pi 认为命令结果的重点在末尾（错误、最终结果），所以 bash **保尾**；DSH 的**工具可见层**与 ZCode **保头**。
2. Grok 选择**两头都要**：按字符数（不是字节）各留一半，中间用标记替换——这正好是 DSH 那套"中间裁剪"思路在 bash 上的版本。

#### DSH 其实是"分层保不同方向"，而且注释点名了 pi

DSH 有两层，各保一头：

- **子进程层**（`subprocess-local/src/output.ts`）：内存里**严格保尾**——保留"字节精确的最后 maxBytes"，无论流怎么分块；头部由 spill 文件兜住。
- **工具可见层**（`tool-bash-persistent/src/index.ts`）：在子进程给的结果上再按 `maxOutputChars` **保头**。

子进程层那段注释把理由写得很直接，**并且引用了 pi 和 OpenCode 作为依据**：

```5:15:F:/_oss-research/dsh/packages/subprocess/subprocess-local/src/output.ts
/**
 * Collects one stream with a bounded in-memory tail. With a spill cap, on
 * first overflow a spill file is created and every chunk (including those
 * already collected) is appended there while the full stream remains within
 * the cap; without one, only the in-memory tail is ever retained (the
 * diagnostic-tail shape — a language server's stderr).
 *
 * Tail-keep rationale (pi/OpenCode): errors and final results cluster at the
 * end of command output; the spill file covers the head.
 */
```

以及"字节精确"这个要求的实现细节（drop 整块或裁掉块头，保证窗口严格等于上限）：

```79:95:F:/_oss-research/dsh/packages/subprocess/subprocess-local/src/output.ts
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0] as Buffer
      const excess = this.bytes - this.maxBytes
      if (head.length <= excess) {
        // Drop the whole head chunk (length ≥ 1 is guaranteed while over cap).
        this.chunks.shift()
        this.bytes -= head.length
      } else {
        // Trim the head so the retained window is byte-exact at the cap — a
        // diagnostic tail (an LSP server's stderr) must hold the LAST
        // maxBytes regardless of how the stream was chunked.
        this.chunks[0] = head.subarray(excess)
        this.bytes -= excess
      }
```

**这条对我们有两层意义**：一是我们选的保尾方向被同行用同样的理由背书了；二是"保尾"应该做成**字节精确**（`subarray` 裁块头），而 Pi 的 `OutputAccumulator` 是在**行边界**上裁剪（`tailStartsAtLineBoundary` + 丢掉不完整首行）——后者对"日志"更友好，前者对"诊断"更严格，看目标用途。

Grok 的保头保尾实现（注意是 char 计数，避免多字节字符被切坏）：

```388:413:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
    /// Front-and-back truncation by char count (not bytes); `to_result` re-joins the halves.
    fn maybe_truncate(&mut self) {
        let s = String::from_utf8_lossy(&self.output_buffer);
        let char_count = s.chars().count();
        if char_count <= self.output_byte_limit {
            return;
        }
        let half = self.output_byte_limit / 2;
        ...
        self.truncated = true;
    }
```

它还给"落盘"本身设了四道闸，防止一个疯狂输出的进程把磁盘或事件循环拖死：

```59:75:F:/_oss-research/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
/// Output-file size at which the actor kills the command, stopping an unbounded
/// writer from filling the disk. Env override: `GROK_MAX_OUTPUT_FILE_BYTES`.
const MAX_OUTPUT_FILE_BYTES: u64 = 5 * 1024 * 1024 * 1024;
...
/// Post-exit drain cap: an inherited pipe (`cmd &`, no redirect) would
/// otherwise block the actor loop forever.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a kill waits for the reap before taking the output there is: a
/// process that never dies must not hold its task open forever.
const REAP_GRACE: Duration = Duration::from_secs(5);
/// Post-exit output-file retention cap so snapshots don't materialize huge strings.
const MAX_RETAINED_OUTPUT_FILE_BYTES: u64 = 64 * 1024 * 1024;
```

这四条（5 GB 杀进程 / 2 s 排空 / 5 s 收割宽限 / 64 MB 保留上限）是**我们完全没有的**：Pi 只跟踪 detached 子进程 pid 并在 abort 时 kill 进程树，没有输出体积上限，也没有"继承管道导致永久阻塞"的防护。**推测**：`cmd &` 这类不重定向的写法在 Pi 里可能让工具调用一直挂着，值得实测一次。

Grok 的预算不是只有一个数，而是**按内容类型分档**——这一点同样值得借鉴：

| 内容 | 预算 |
| --- | --- |
| 一般工具结果 | 40,000 字节 |
| bash 输出 | 20,000 字符 |
| MCP 工具描述 | 截断到 2,048 字符 |
| MCP 工具结果 | 独立上限（与一般工具不同） |
| 子代理完成提醒的内联预览 | 4,000 字节，超出只给磁盘指针 |
| 读回落盘快照 | 1 MiB |
| 流式单帧 delta | 16 KiB，且切在 UTF-8 边界 |

另外单行超长时用**软换行**（完整保留该行）而不是截断——只有当整体超限才做头尾截断。这条细节很实用：`base64` 输出、`minified` JS、长 JSON 单行在我们的实现里会被当成"一行"整体裁掉，而它是按行计数的。

Pi 的双阈值实现（含"永不返回半行"的边界处理）：

```8:16:F:/_oss-research/pi-src/core/tools/truncate.ts
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB)
 *
 * Never returns partial lines (except bash tail truncation edge case).
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
```

截断后给模型的话术里**带完整行号区间**，模型能自己判断要不要读全量：

```259:272:F:/_oss-research/pi-src/core/tools/bash.ts
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
```

Grok 的 20k 预算与 ZCode 的 30k 内联阈值都小于 Pi 的 50 KB——**更小的预算意味着更频繁的落盘，也意味着更少的上下文污染**，这是可以调的战略参数，不是常数。

### 5.3 脏输出的清理：Pi 做了 ANSI/二进制/CRLF 归一

```69:78:F:/_oss-research/pi-src/core/bash-executor.ts
	const onData = (data: Buffer) => {
		totalBytes += data.length;

		// Sanitize: strip ANSI, replace binary garbage, normalize newlines
		const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");

		// Start writing to temp file if exceeds threshold
		if (totalBytes > DEFAULT_MAX_BYTES) {
			ensureTempFile();
		}
```

**但这条清理只覆盖 `bash-executor.ts`（交互/RPC 路径，`AgentSession.executeBash()`）。** 工具路径走的是 `OutputAccumulator`，它只做流式 UTF-8 解码与尾部裁剪，没有任何 ANSI / 二进制清洗：

```48:58:F:/_oss-research/pi-src/core/tools/output-accumulator.ts
	append(data: Buffer): void {
		if (this.finished) {
			throw new Error("Cannot append to a finished output accumulator");
		}

		this.totalRawBytes += data.length;
		this.appendDecodedText(this.decoder.decode(data, { stream: true }));

		if (this.tempFileStream || this.shouldUseTempFile()) {
			this.ensureTempFile();
			this.tempFileStream?.write(data);
```

而 `core/tools/bash.ts` 的 `handleData` 正是直接 `output.append(data)`（`pi-src/core/tools/bash.ts:225-228`）。也就是说**模型看到的 bash 输出仍带颜色转义序列**——例如 `git status`、`npm`、`cargo` 的彩色输出会白吃 token。这是一个具体的、可验证的待办（见 §6 第 1 条）。

### 5.4 命令安全与权限：ZCode 用"只读判定"而不是"危险词黑名单"

ZCode 有一个专门的只读语义判定族（`tool/handlers/` 下 20+ 个文件），按 argv 逐个命令/子命令/参数分析是否只读：

```
bash-readonly-policy-argv.ts          bash-readonly-policy-argv-git.ts
bash-readonly-policy-argv-flags.ts    bash-readonly-policy-argv-io.ts
bash-readonly-policy-commands.ts      bash-readonly-policy-git-subcommands-core.ts
bash-readonly-policy-git-subcommands-history.ts
bash-readonly-policy-multiword-gh.ts  bash-readonly-policy-simple-commands.ts
```

判定结果直接喂给权限系统（`bash-command-permission-policy.ts` + `executor/permission-rules.ts` + `approval-gate.ts`），而不是笼统地问"要不要允许 bash"。

**对照组**：我们的 plan-mode 扩展明确放弃了这股做法，理由写在注释里——

```1:12:F:/Projects/pi-agent-desktop/resources/extensions/plan-mode/gating.ts
/**
 * Write gating.
 *
 * Plan mode removes the structured write tools from the active set — a floor
 * the model cannot talk its way past. The `tool_call` hook is the second lock:
 * ...
 * Shell commands are deliberately not classified. Guessing whether a bash line
 * mutates the tree is a losing game, and a wrong verdict either blocks real
 * research or waves a write through; ...
 */
```

两边结论相反，但都可以说是对的：ZCode 用 20 个文件承担了这个成本（且只用于**权限提示**，不是硬拦截），我们的选择是**不猜**。

DSH 则完全不玩"命令匹配"，它把安全拆成**两个正交旋钮**——文件效果沙箱 + 审批策略——再由 preset 组合：
```yaml
          read-only:
            sandbox: read-only
            approval: ask
          workspace-write:
            sandbox: workspace-write
            approval: ask
          danger-full-access:
            sandbox: danger-full-access
            approval: never
```

沙箱本身翻译成三种内核机制（Linux bwrap、Linux Landlock、macOS Seatbelt），并且要求它们与进程内 fs 围栏**不能漂移**。被拒后的升级路径是"同一轮内用更宽的 `sandbox_permissions` + 一句话 justification 重试一次"，把审批做成了协议而不是弹窗。

- 来源：`F:/_oss-research/dsh/packages/bundle/base/cordis.patch.yml:236-246`、`packages/shell/bash-sandbox/src/index.ts:89-123`、`packages/sandbox/sandbox-local/src/profiles.ts:12-63`
- Github：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-local/src/profiles.ts#L12-L63

这条对我们是可选的远期项：**默认拒绝 + 按需升级**比"每次问用户"更省交互，也比"猜命令是否危险"更可靠。

Grok 走的是第三条路：**沙箱用 nono（Landlock / Seatbelt）+ 进程级网络策略**——进程本身可联网，子进程用 seccomp 断网；profile 分 `workspace` / `devbox` / `read-only` / `strict` / `off`，只有后两个限网。另外两处治理细节值得一记：

- **供应链防护**：项目里的 `.grok/sandbox.toml` **只能新增 profile 名，不能重定义全局同名 profile**；hook 写入防护缺失时 **fail-closed**。
- **危险命令防护不做黑名单，只卡三种确定有害的写法**：裸 `&` 后台操作符（引导模型改用 `is_background: true`，错误文案里直接给出真实参数名）、以及会匹配到自己的 `pkill -f` / `pgrep -f`（自杀命令）。

第二点是"**窄而确定**"的典范：不猜"这条命令危不危险"，只拒绝"写出来一定会伤到自己的那种写法"，并且**错误信息里直接给替代方案**。这条思路我们完全可以照抄进 bash 工具的前置校验。

- 笔记：`docs/research/notes/grok-build.md` 4.6 节（`xai-grok-sandbox/src/lib.rs:1-12,51-64`、`profiles.rs:70-86,124-130`、`implementations/grok_build/bash/mod.rs:527-530,802-805,1379-1395`）

ZCode 的取舍最简单：**沙箱默认开着，要关得显式点名**。

```428:431:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/bash.ts
    sandbox: {
      enabled: !input.dangerouslyDisableSandbox,
      dangerouslyDisableSandbox: input.dangerouslyDisableSandbox,
    },
```

参数名叫 `dangerouslyDisableSandbox` 而不是 `sandbox`——**默认安全，破坏默认要付命名成本**，这条命名约定本身就是文档。而且结果里会回报 `sandboxed: true/false`，模型知道自己这条命令是在什么环境下跑的。

对比之下 Pi 目前既没有沙箱开关，也没有在工具结果里回报执行环境。**这一条不需要实现沙箱就能先做**：把"有没有沙箱"作为结果元数据回报给模型。

### 5.5 超时与后台

- Pi：`timeout` 参数**可选、无默认**，超时直接 kill 进程树（`killProcessTree`）。
- ZCode：默认 **120s**、上限 **600s**，可用 `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS` 覆盖；后台有两种触发方式——显式 `run_in_background`，以及超时后 `auto_on_timeout` 自动转后台；判定资格时排除 `sleep`。
- DSH 持久 bash：默认 **300s** 且**超时会销毁 shell**（状态全丢，需要重建）。
- Grok：前台有 **15 s 阻塞预算**，到点**自动转后台而不是杀掉**；前台/后台都支持，后台返回 `task_id` 并有通知回调。

Grok 的超时语义里有两个设计选择值得我们重新审视自己的默认值：

1. **前台超时不是终止，而是"转后台"。** 一个跑了 20 秒的构建不该被判定失败，它只是不该继续阻塞模型。终止路径是另一条：`SIGTERM` → 1 秒宽限 → `SIGKILL`。
2. **后台任务有生命周期上限**：单个后台任务最长 **10 小时**，完成快照 **TTL 300 秒、最多保留 100 条**——避免"任务元数据"自己变成第二份上下文。

ZCode 走的是同一条路线，而且把两种触发方式分得很清楚：

```170:180:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/bash.ts
  const runCommand = async () =>
    parsed.run_in_background && backgroundLifecyclePort
      ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
          request,
          { mode: "explicit" },
          runOptions,
        )
      : eligibleForAutoBackground && backgroundLifecyclePort
        ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
            request,
            { mode: "auto_on_timeout" },
            runOptions,
          )
```

它的后台能力是**能力探测型端口**（`supportsBashBackgroundLifecycle`），宿主不支持时**直接报配置错误而不是静默退化成前台**——这类"要么给我这个能力，要么明确失败"的处理方式值得学，静默退化是最难排查的一类问题。

对照 Pi：`timeout` 参数可选无默认，一旦超时**直接 kill 进程树**。我们的语义是"要么等、要么杀"，没有"先放后台，回头再问"这一档。而 DSH 的持久 bash 更激进——**超时会销毁 shell**，状态全丢。三种语义里，Grok 与 ZCode 那种对我们最友好。

- 笔记：`docs/research/notes/grok-build.md` 4.4 节（`computer/local/terminal.rs:41-48,75-77`）

DSH 的三个默认值与"重置话术"都在同一处，模型能明确知道 shell 被重置了：

```17:18:F:/_oss-research/dsh/packages/shell/tool-bash-persistent/src/index.ts
const SHELL_RESET_MESSAGE = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.'
```

```447:451:F:/_oss-research/dsh/packages/shell/tool-bash-persistent/src/index.ts
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
```

ZCode 的自动转后台判定极简但有效：

```3:8:F:/_oss-research/ZCode/apps/zcode-cli/packages/core/src/tool/handlers/bash-background-policy.ts
export function isBashAutoBackgroundEligible(input: BashInput): boolean {
  if (input.run_in_background === true) return false;
  const command = input.command.trim();
  if (command.length === 0) return false;
  const firstToken = command.split(/\s+/u)[0];
  return firstToken !== "sleep";
}
```

### 5.6 两个"顺手优化"

- **ZCode 会把 `find`/`grep` 映射到内嵌实现**：在 POSIX / git-bash 会话里注入 shell 函数别名，让模型写的 `grep`/`find` 走宿主自带的搜索引擎而不是外部二进制（`core/src/embedded-search/shell.ts`）。
- **Grok 把 `find`→`bfs`、`grep`→`ugrep` 影子化**（`implementations/grok_build/bash/mod.rs` 文件头引用 `embedded_search_tools`），同一思路。
- **Pi 反向操作**：给 shell 注入 `PI_*` 环境变量（session id、provider、model、思考等级），并**在注入前先删掉同名旧值**，避免子进程带着过期会话信息：

```183:203:F:/_oss-research/pi-src/core/tools/bash.ts
	const env = { ...getShellEnv() };
	delete env.PI_SESSION_ID;
	delete env.PI_SESSION_FILE;
	delete env.PI_PROVIDER;
	delete env.PI_MODEL;
	delete env.PI_REASONING_LEVEL;
	if (exposeSessionEnvironment && ctx) {
		const model = ctx.model;
		env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
```

---

## 6. 我们可以直接落地的清单

**最高优先级——一处与官方指导（以及所有同行）相反的实现，见 §8.1**：plan-mode 目前靠"把写工具从活动集合里摘掉"来强制只读，但这会失效**整个缓存**（tools + system + messages）。建议改为"工具集不变 + `tool_call` 钩子作为唯一硬锁 + 提醒表达状态"，《§8.1》给了三步改法与它带来的取舍。

其余按"改动量 / 收益"排序，前三条都是小改动：

1. **给 bash 子进程强制 `NO_COLOR=1`、`TERM=dumb`、`FORCE_COLOR=0`**（Grok 每次调用都这么做）。一行代码、零解析开销，且顺带让落盘的临时文件也是干净的。见 §5.1。
2. **再补一层 harness 侧的 ANSI/二进制清洗**（Pi 已有 `stripAnsi` + `sanitizeBinaryOutput`，只是工具路径没用）。环境变量是"请求不要输出颜色"，清洗是"不管它输出了什么都清掉"——两层都要，因为有些工具不看 `NO_COLOR`。落点：`pi-src/core/tools/bash.ts` 的 `handleData` 或 `OutputAccumulator.append`。
3. **把内联输出预算从 50 KB 调到 20–30 KB，并按内容类型分档**：Grok 是"一般结果 40 KB / bash 20 K 字符 / MCP 描述 2 KB / 子代理预览 4 KB"，不是一个常数。同时把溢出策略写进工具描述。
4. **补一档"砍中间"的裁剪**：现在只有整体保尾（bash）与整体保头（read），缺 DSH 与 Grok 都实现了的**保头保尾**：
   - DSH：`threshold 8192 / head 4096 / tail 1024`，纯代码、可重放，不需要模型参与；
   - Grok：按**字符数**各留一半，中间插 `... (output truncated) ...`，全量落盘。
   对 `npm test`、`pytest`、`cargo build` 这类"头是配置、尾是结论、中间是重复堆栈"的输出最有效。
5. **让动态上下文"变了才写"**：DSH 的 `RuntimeContextProjection.project()` 在渲染结果与上一次相同时直接返回 `undefined`。我们的 plan-mode 状态、todo 状态目前是每轮重建并作为隐藏消息注入，可以加同样的相等性短路。
6. **补一档"微压缩"**：ZCode 在达到压缩阈值前先清掉**旧工具结果的正文**（保留最近 5 条，替换为固定占位符，只在空闲超 60 分钟且能省下 256 token 以上时才做）。它不改变消息结构、不需要模型参与，是在"什么都不做"和"整段摘要"之间的中间档——我们现在只有后者。（见 §3.7）
7. **给 `spawn_agent` 之外的工具也做"存在才注入"**：Grok 的 `${%- if tools.by_kind.task %}` 是这套思路的极致版；我们目前只有 Ultra 授权做了 `pi.getAllTools().some(...)` 检查，可以把这条变成扩展工具箱里的公共函数。
8. **补一套工具参数修复**（Grok 四件套里最实用的两件）：**宽松反序列化**（`"123"` → `123`）+ **结构化校验错误**（回给模型 `field_path` / `expected` / `bad_value`）。这两条直接减少"模型参数写错 → 整轮白跑"的浪费。
9. **考虑把 bash 超时从"kill"改成"先转后台"**：Grok 是前台 15 s 阻塞预算，到点转后台而不是终止；ZCode 也有 `auto_on_timeout`；我们是到点杀进程树。渐进式语义更符合"长任务不等于失败"。
10. **把"执行环境状态"回报给模型**：ZCode 的结果里带 `sandboxed: true/false`。我们即使不实现沙箱，也可以先回报"这条命令在什么环境里跑的"。
11. **引入"缓存浪费"指标到桌面端**：`cache-stats.ts` 已经能算 `missedTokens` / `missedCost` / `idleMs` / `modelChanged`，把它接到 CacheRing 的悬停详情里，用户就能知道"是闲置超时还是改模型导致的未命中"。
12. **把 plan-mode 的只读门禁从"移除写工具"扩展为"可选只读命令判定"**：ZCode 的 argv 级判定太重，但可以先做一张"绝对只读"白名单（`git status`/`ls`/`rg`…），命中即免审批，未命中仍走原路径——不猜"是否写"，只确认"确定只读"。
13. **给持久 shell 留一条路**：DSH 用"两个工具名"解决选择问题，而不是加参数；ZCode 则用最便宜的一档——只持久 cwd，并带越界重置。若我们要做，建议先抄 ZCode 那档，再考虑 PTY。
14. **把"顺序固定"和"前缀稳定"变成测试**：照 DSH `tool-order.spec.ts` 写一条"工具注册顺序变化不改变 provider 可见顺序"的断言；照 Grok 的 `assert_prefix_stable_pair` 写一条"请求 N 的序列化输入是请求 N+1 的字节前缀"。这两条测试的价值不在当下，在于半年后有人加插件时不会悄悄毁掉缓存。
15. **给六个扩展工具加 `executionMode: "sequential"`**（一行）：`create_plan` / `todo_write` / `spawn_agent` / `wait_agent` / `list_agents` / `interrupt_agent` 都在改共享状态，但目前都跑在默认的并发模式下。见 §9.3。
16. **给搜索二进制加一条降级路径**：我们现在是"系统 `rg` 优先 → 运行时下载"，缺的是**下载失败时的兜底**（报错是 `ripgrep (rg) is not available and could not be downloaded`）。DSH 直接把 ripgrep 打进 npm 包（`@vscode/ripgrep`），永不失败——离线或受限网络下这是可靠性差异，不是性能差异。见 §9.2。
17. **把"读终端输出"显式化**（可选）：DSH 把终端拆成 `terminal_open` / `send` / `read` / `list` / `signal` / `close`，模型不读就不进上下文。我们已有独立终端面板，可以把"读"也做成一个工具，长跑进程的输出就不必挤进 bash 结果。见 §9.1。

### 6.1 一个需要权衡的发现：plan-mode 改工具集 = 主动砸工具块缓存

DSH 在 plan mode 的实现里明确写了一句：

> The tool catalog stays the same across modes for **request-cache stability**.

而我们的 `plan-mode` 恰恰相反——它直接**把写工具从活动集合里摘掉**：

```1:11:F:/Projects/pi-agent-desktop/resources/extensions/plan-mode/gating.ts
/**
 * Write gating.
 *
 * Plan mode removes the structured write tools from the active set — a floor
 * the model cannot talk its way past. The `tool_call` hook is the second lock:
 * it catches a write tool that is still active for some reason (a custom tool
 * the extension never heard of, or a race with a tool-set change).
```

这是一次**刻意的取舍**，两边逻辑都成立：

- 我们买到的是"模型无法通过劝说绕过只读"的硬保证（工具根本不存在）。
- 代价是每次进出 plan mode 都会改变工具目录，**从工具块第一个 token 起缓存失效**，加上 `_baseSystemPrompt` 会因为工具集变化而重建（`pi-src/core/agent-session.ts:2491`）。

DSH 的替代方案是把 plan 约束放进**提示词 + 审批策略**（`PLAN_POLICY` 段），工具目录不动。**建议**：保持现有硬约束，但在进入/退出 plan mode 时**不要把这一次的缓存损失算在别处**——桌面端可以在切换瞬间给 CacheRing 一个"模式切换导致预期未命中"的标记，避免用户误以为模型行为异常。

---

## 7. 社区路径：外部证据与横向验证

前面六节全部来自本地读码。这一节是社区侧的外部证据，用来做交叉验证——**结论一致的部分互相加强，不一致的部分值得警惕**。检索用 Exa（`web_search_exa`）。

### 7.1 有一组公开的缓存命中率横评，且第一名是 ZCode

OpenCode 联合创始人 Dax Raad 公布的实测数据（同一批工具、同一个 DeepSeek 后端模型）：

| 工具 | 缓存命中率 |
| --- | --- |
| **ZCode** | **98.60%** |
| OpenCode V2 / Cursor / Codex | 较高（未给具体值） |
| Claude Code / CLI | **89.31%（最低）** |

来源：https://blog.4sapi.com/blog/deepseek-ai-coding-cache-benchmark （2026-08-10）

这组数字对本文的意义：**同一个模型、同一个 API，客户端差出近 10 个百分点**。它把"harness 层的缓存工程"从"设计品味"变成了"可测量的成本差"——也正是我们在 §3 逐条拆的那些东西（工具顺序、段划分、断点位置）在付账。

### 7.2 DSH 的 99% 命中率分析，列出的失效原因和我们找到的一一对应

> 把缓存命中率当作**运行时稳定性的诊断指标**，而不只是成本指标。

它列出的前缀失效原因：工具注册顺序不确定、system prompt 里注入时间戳/随机 ID、schema 字段顺序漂移、历史压缩改写旧消息、权限/沙箱/MCP 工具变更在日志里不可见。

来源：https://www.besthub.dev/articles/deepseek-harness-how-99-cache-hits-validate-request-prefix-stability-f40160929ea9 （2026-09-02）

这几条与 §2.5（顺序不变量测试）、§3.3（可重建请求）、§3.4（压缩复用热前缀）逐条对应。**尤其最后一条"变更在日志里不可见"**，正是 DSH 把"模型可见 ⟺ 可被日志重建"设为不变量的原因。

### 7.3 一个关键先例：Codex 也踩过同一个坑，并且用了同一种解法

同一篇分析里提到：**Codex 早期的 MCP 工具顺序不稳定导致缓存命中率下跌，他们的修复方式是"把配置更新作为新消息追加，而不是重写前缀"**——这与 DSH 的 `systemPromptUpdate: in-history` 是同一个解法，也与我们家 `resources/extensions/agent-team/prompts.ts` 里引用的那份 Codex 分析文档（`codex-rs/prompts/src/model_messages/multi_agent.rs`）是同一批设计。

**这条值得记下来**：当三家独立实现（Codex、DSH、以及 Grok 的"跨零点不改前缀只追加 reminder"）都收敛到"追加而非改写"时，它就不再是一个技巧，而是一条规律。

### 7.4 学术侧的数字：naive 缓存只有 15–35% 命中率

社区文章引用了一篇论文（`Don't Break the Cache`，arXiv 2601.06007，评测 500+ agent 会话）：

- agent 场景下、历史超过 5 轮的朴素缓存，命中率只有 **15–35%**；
- 结构化提示设计可以推到 **80% 以上**；
- 文章原话：每轮都打破缓存的 agent，输入 token 成本是**保持缓存者的 50 倍**。

来源：https://niteagent.com/blog/build-log-prompt-cache-agent-runtime/ （2026-07-02）

**注意**：这篇是社区文章转述的论文结论，我没有核对原文，**引用时按"社区二手数据"对待**。

### 7.5 意外收获：DSH 的基础 bundle 里挂了 Pi 的 `pi-ai`

这是本次调研里对我们最直接相关的一条。`packages/llm/` 下不只有 `llm-deepseek`，还有一个 `llm-pi-ai`：

```json
{
  "name": "@deepseek-ai/dsh-llm-pi-ai",
  "description": "pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek)",
  "dependencies": {
    "@earendil-works/pi-ai": "^0.85.1"
  }
}
```

三点值得注意：

1. **它依赖的 `@earendil-works/pi-ai` 版本是 `^0.85.1`**——和我们仓库里装的是同一个包、同一个版本。
2. **它不是边角实验品，而是挂在基础 bundle 里**：`packages/bundle/base/cordis.patch.yml:114-115` 显式挂载，`packages/bundle/base/package.json` 也把它列为依赖。它的用途是"把请求路由到多个 pi-ai provider、OpenAI 兼容网关或自托管服务"。
3. **它的自我定位是"design-verification twin"**（设计验证对照件）——即用 pi-ai 的实现来交叉验证自家 `llm-deepseek` 适配器的行为。

也就是说：**DeepSeek 在自家 harness 里内置了基于 Pi 的 LLM 适配层，用它当自家适配器的对照实现。** 社区文章也从另一侧印证了这点——"两个插件同时挂着：`dsh-llm-deepseek` 和 `dsh-llm-pi-ai`"（https://www.alex908.com/en/blog/deepseek-harness-architecture ）。

### 7.6 社区对 ZCode 的评价集中在"模型侧"而非"harness 侧"

Flavio Copes 的实测长文讲的是训练侧：GLM-5.3 与 5.2 同基座、没有重新预训练，提升来自**在任务环境里的后训练**——模型拿到目标、工具和可验证的结果，写码、跑、按是否通过来学习；环境由研究 agent 收集工作模式生成，另有一个 agent 校验任务可解；**校验者看不到参考答案**，以防模型"抄形状"。

来源：https://flaviocopes.com/zcode/ （2026-08-31）

这补上了本文的一个盲区：**ZCode 对自家模型的优化有一半在 harness 之外**——先用 agentic 任务后训练出一个"愿意长跑"的模型，再让 harness 围绕它做缓存与提示工程。反过来看，DSH 的社区分析几乎全在 harness 架构上。**两种路线的投入结构完全不同。**

### 7.7 一篇专门写"Pi + DeepSeek"的文章

标题就叫《Why the Harness Can Matter More Than the Model》，提出 "Harness Multiplier" 概念：同一个 DeepSeek V4 Flash，在不同 harness 里"更快、更便宜、更可靠"，理由是 harness 决定了**模型看到什么提示、能调什么工具、工具输出回多少**。

来源：https://docs.bswen.com/blog/2026-09-01-pi-agent-deepseek-harness-multiplier/ （2026-09-01）

**引用注意**：该文明确要求"模型版本、harness 清单、测试日期三者一致"才可作为证据引用，且我**没有复现它的测试**——只能当作"同一模型不同 harness 会显著分化"这一观点的社区旁证，不能当作性能数据。

### 7.8 社区证据的边界

- 上述覆盖率是**抽样**（一次 Exa 检索的 8 条高相关结果），不是系统性文献综述。
- 命中率数字（98.60% / 89.31% / 99%）来自不同时间、不同工具、不同任务的独立实测，**彼此不可直接相减**，横向比较只能看量级。
- 论文数字是二手转述，未核对原文。
- 社区文章里凡与本文源码结论冲突的，**以源码为准**；本文没有发现实质冲突。

---

## 8. 官方文档核对：一处硬冲突、三处需要修正的假设

前七节是"看别人怎么做"，这一节是"拿官方规则量自己"。核对下来有**一处硬冲突**（我们和所有同行都相反）和**三处需要修正的假设**。

### 8.1 硬冲突：plan mode 摘掉写工具——Anthropic 明确说不要这么做

Anthropic 在《Lessons from building Claude Code: Prompt caching is everything》里有一节标题就叫 **"Never add or remove tools mid-session"**：

> Changing the tool set in the middle of a conversation is one of the most common ways people break prompt caching. It seems intuitive—you should only give the model tools you think it needs right now. But because tools are part of the cached prefix, **adding or removing a tool invalidates the cache for the entire conversation**.
>
> **Plan Mode is a great example of designing features around caching constraints.** The intuitive approach would be: when the user enters plan mode, swap out the tool set to only include read-only tools, **but that would break the cache**.
>
> Instead, we keep all tools in the request at all times and use `EnterPlanMode` and `ExitPlanMode` **as tools themselves**. … The tool definitions never change.

来源：https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything

**而我们的 `plan-mode` 扩展做的恰恰是"直觉那一版"**：它用 `readOnlyTools()` 把写工具从活动集合里摘掉（`resources/extensions/plan-mode/gating.ts`）。

更值得警惕的是横向对照——**四家实现全部选了相反的做法**：

| 实现 | plan mode 的做法 |
| --- | --- |
| Claude Code（官方） | 工具集不变，用 `EnterPlanMode` / `ExitPlanMode` 两个工具表达状态 |
| ZCode | 工具名白名单里有 `EnterPlanMode` / `ExitPlanMode` |
| DSH | 有 `exit_plan_mode`，且明确写"The tool catalog stays the same across modes for **request-cache stability**" |
| Grok Build | 有 `enter_plan_mode` / `exit_plan_mode`，并有 `prefix_stable_after_tool_schema_change` 断言"换工具集不得影响前缀" |
| **我们** | **摘掉写工具（唯一一家）** |

**代价是量级可观的**：按 Anthropic 的表格，修改工具定义会失效**整个缓存（tools + system + messages）**；增删工具会让 tools 之后的 system 与 messages 前缀全部失配。也就是说每次进出 plan mode，整段会话历史都要按全价重算一次。

**已经有了现成的解法，而且就在我们的依赖里。** `pi-ai` 已实现 Anthropic 的 `defer_loading` 模式：

```ts
/** Split current tools into prefix and transcript-loaded definitions. */
export function splitDeferredTools(
	context: Context,
	enabled: boolean,
	normalizeName: ToolNameNormalizer = identityToolName,
): { immediate: Tool[]; deferred: Map<string, Tool> } {
```

它会把"通过工具搜索发现、但尚未使用"的工具降级成只带名字的轻量桩（`defer_loading: true`），并在 tools 数组里排在缓存断点**之后**；开关是 `compat.supportsToolReferences`（默认对 Anthropic 一方模型开启）。Anthropic 对这个模式的说明是：

> Deferred tools are **not included in the system-prompt prefix**. When the model discovers a deferred tool through tool search, the definition is appended inline as a `tool_reference` block in the conversation history. **The prefix is untouched, so prompt caching is preserved.**

**给我们的具体建议**（按改动量排序）：

1. **先别急着改工具集过滤，先把我们的 `tool_call` 钩子变成唯一的锁。** `gating.ts` 的注释自己写了：钩子本来就是"第二道锁"，用来拦"因为某种原因仍然活跃的写工具"。既然如此，**把它提到第一道锁，工具集就不必过滤了**——硬保证仍然成立（模型根本无法写入），缓存也不再被砸。
2. plan mode 的状态表达改用提醒（**我们已经有了**：`plan-mode/prompt.ts` 的隐藏消息）+ 一个显式的退出信号（对应 Claude Code 的 `ExitPlanMode`）。
3. 用户侧的成本可见：切换瞬间在 CacheRing 上标一次"预期未命中"（同 §6.1 的建议）。

**注意**：这条建议会改变 plan mode 的"硬保证"来源——从"工具不存在"变成"钩子拒绝"。安全性等价（都在 harness 层），但如果将来有人绕过钩子，保护就消失了。这个取舍必须在代码注释里写清楚。

### 8.2 需要修正的假设：`NOISE_FLOOR_TOKENS = 1024` 不再是通用下限

Anthropic 官方给出**按模型分档的最小可缓存前缀**，而且明确说这个下限**跨代不单调**：

| 模型 | 最小可缓存前缀 |
| --- | --- |
| Claude Opus 5 / Fable 5 / Fable 5.1 / Mythos 5.1 | **512 tokens** |
| Claude Opus 4.8 / Sonnet 5 / Sonnet 4.6 / Sonnet 4.5 | 1,024 tokens |
| Opus 4.7 / Mythos Preview / Haiku 3.5 | 2,048 tokens |
| Opus 4.6 / Opus 4.5 / Haiku 4.5 | 4,096 tokens |

> 短于下限的提示即使标了 `cache_control` 也不会被缓存，**且不报错**——只能从 usage 里发现 `cache_creation_input_tokens` 与 `cache_read_input_tokens` 都是 0。

我们的判定逻辑是：

```1:15:F:/_oss-research/pi-src/core/cache-stats.ts
/**
 * Prompt-cache TTL: idle gaps longer than this are worth mentioning as the
 * likely cause of a miss. Anthropic's default cache TTL is 5 minutes.
 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-turn misses at or below this are cache breakpoint granularity noise. */
const NOISE_FLOOR_TOKENS = 1024;
```

- **TTL 那一半是对的**：5 分钟与官方默认一致。
- **噪声下限那一半需要改**：在 512 下限的新模型上，一次真实的 600 token 未命中会被我们当成噪声吞掉。**建议把噪声下限做成按模型查表的常量，而不是全局 1024。**

另外官方给了 TTL 选择依据，可以直接写进我们 `PI_CACHE_RETENTION=long` 的说明——**1 小时档的写入价是 2 倍，要至少 3 次请求才回本**（`2× + 0.1× = 2.2×` vs 不缓存 `3×`）：

| 共享前缀的请求间隔 | 该用哪档 |
| --- | --- |
| < 5 分钟（连续流量、单轮生成远快于 5 分钟） | **5 分钟档**——每次命中都会免费续期，严格更便宜 |
| 5–60 分钟（用户隔 20 分钟才回复、生成耗时跨过 5 分钟） | **1 小时档**——只有这个区间 2 倍写入价才划算 |
| > 1 小时 | 两档都不划算，考虑定时预热或接受冷启动 |

### 8.3 需要补的一处：20-block lookback 与"第二个断点"

官方规则里有一条我们没利用：

> The lookback window is **20 blocks**. … If a growing conversation pushes your breakpoint 20 or more blocks past the last write, the lookback window misses it. **Add a second breakpoint closer to that position from the start** so a write accumulates there before you need it.
>
> **The robust combination for agent loops:** one explicit breakpoint on the last block of the static system prefix … plus top-level automatic caching for the growing conversation tail.

好消息是**Grok 那句注释正是在讲这条规则**（"The third covers a turn that appends more than the API's 20 block lookback"）——两家独立实现与官方文档三方一致。

我们的现状：Pi 打两个断点（最后一个 tool + 最后一条 user 消息），**没有中间写点**。官方说得很清楚，agent loop 里一轮可能追加很多 block，一旦把断点推离上一次写入 20 个位置以上，lookback 就够不着了。缓解因素是官方同时说明"连续的 `tool_use` 块算一个位置，连续的 `tool_result` 块也算一个位置"，所以并行工具调用不会自己把窗口挤爆。

**建议**：长会话场景（我们桌面端的 `ContextBadge` / `ContextRing` 正好能判断）考虑加一个中途写点，或改用官方推荐的"静态前缀显式断点 + 顶层 automatic caching 管增长尾部"组合。

### 8.4 需要留意的一处：改思考等级会砸 messages 缓存

官方给的失效对照表里有一条和我们直接相关：

| 变更 | 失效范围 |
| --- | --- |
| 修改工具定义 | **整个缓存**（tools + system + messages） |
| 开关 web search / citations | system 与 messages 缓存 |
| 改 `tool_choice` | messages 缓存 |
| 改 `disable_parallel_tool_use` | messages 缓存 |
| 图片有无切换 | messages 缓存 |
| **改思考参数** | **messages 缓存** |

来源：https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching

我们的桌面端**允许会话中途切换思考等级**（`pi-host.ts:395` 的 `setThinkingLevel`、渲染层的 `ModelThinkingControl.tsx`），而且 **Ultra 模式本身就是一次线上思考等级改写**：

```1119:F:/Projects/pi-agent-desktop/src/main/pi-host.ts
            thinkingLevel: this.ultraActive() ? "ultra" : session.thinkingLevel,
```

所以"开 Ultra"这个动作在部分情况下会连带砸掉 messages 缓存。

**这不必改行为**（用户切换思考等级是正当需求），但可以**让它可见**：`cache-stats.ts` 的 `CacheMiss` 里已经有 `modelChanged` 字段，照它加一个 `thinkingChanged` 即可——用户就能区分"是我自己切的"和"它莫名其妙掉了"。

### 8.5 附带确认：`NO_COLOR` 的做法有正式标准背书，但有个歧义

- **`NO_COLOR` 是正式标准**（https://no-color.org/）：变量存在且非空即抑制着色。`TERM=dumb` 是更老的同义约定。
- **`FORCE_COLOR` 是它的反面标准**（https://force-color.org/）……**这就是歧义所在**：按该标准，`FORCE_COLOR` 存在且非空 = **强制开启颜色**。Grok 设的 `FORCE_COLOR=0` 在 chalk / supports-color 那套实现里读作"等级 0 = 不着色"，但**严格按标准实现的工具会把它读成"强制上色"**。
  - **建议**：以 `NO_COLOR=1` + `TERM=dumb` 为主信号；`FORCE_COLOR=0` 只作为 chalk 系工具的补充，并在注释里写明这是实现方言而非常量。
- 生态正在往**专门的 agent 信号**收敛（`AI_AGENT` / `CLAUDECODE` / `VSCODE_AGENT`），理念是"harness 声明一次上下文，CLI 自己决定行为"，而不是往提示词里塞 N 个 `--no-pager`。Foundry 的 `FOUNDRY_MACHINE_MODE` 是个具体例子，声称在 agent 工作流里带来 **60–80% 的 token 下降**（关 ANSI + 关 spinner）。
  - 我们的 `PI_*` 环境变量（`PI_SESSION_ID` / `PI_MODEL` / …）属于同一族设计，方向没错。
- **一条安全提醒**：这类环境变量**只能当行为提示，不能当授权信号**。公开案例里出现过"提示注入 payload 通过 `export` 污染环境变量、进而绕过信任白名单"（CVE-2026-22708）。另外 `sudo` / `docker run` / `ssh` 都不会透传这些变量——依赖它们做安全判定会在跨越这些边界时静默失效。我们的 `PI_*` 目前纯属信息性，**保持这样**。

---

## 9. 性能优化：终端、搜索与并发（缓存之外的账）

前面 §3 讲的是"少花 token 与钱"，这一节讲"少花时间"。两者在**"什么东西会被写进历史、因而被反复重放"**这一点上会合。

### 9.1 终端：三笔可测量的账

**（a）流式输出要节流，不能每个 chunk 触发一次渲染。** 四家都做了，只是刻度不同：

| 实现 | 节流策略 | 位置 |
| --- | --- | --- |
| Pi | `BASH_UPDATE_THROTTLE_MS = 100`（100 ms），脏标记 + 定时器合并 | `pi-src/core/tools/renderers/bash.ts:19`、`core/tools/bash.ts` 的 `scheduleOutputUpdate` |
| Grok | **16 ms** 批量推送，单帧 delta 上限 16 KiB 且切在 UTF-8 边界 | 笔记 4.5 节（`xai-grok-shell-terminal/src/pty_session.rs`） |
| DSH | terminal 层合并碎片后再成串 | `packages/terminal/terminal-bash/src/session.ts:96` |

**（b）大缓冲给回放，小窗口给模型。** Grok 的交互式 PTY 按 `terminalId` 复用、256 KiB 环形缓冲、进程组独立；DSH 更彻底——把终端拆成 `terminal_open` / `send` / `read` / `list` / `signal` / `close` 六个工具，**"读"是一个显式动作**，模型不读就不进上下文。这正是我们桌面端的形态（`src/main/pty.ts` 的终端面板与 bash 工具是两条独立通道），但我们可以再往前一步：**把"读终端输出"也做成一个工具**，让长跑的进程输出不必挤进 bash 结果。

**（c）shell 启动成本用"状态传递"换"进程常驻"。** ZCode 每次新 shell 但记忆 cwd、用用户 profile 初始化（§5.1）；Grok 用 login shell `-ilc` + 状态 dump/replay 把 env/cwd/函数/别名带过去；DSH 干脆给两个工具让部署方选。**三家的共同判断是：常驻 shell 的状态腐烂成本，高于每次重建 + 传递状态的成本。**

### 9.2 搜索：三种加速路线，只有一家做了结果缓存

| 实现 | 搜索怎么跑 | 加速手段 | 有没有缓存 |
| --- | --- | --- | --- |
| **Pi** | 外部 ripgrep，**运行时自动下载** fd / rg 到工具目录（支持系统二进制优先） | 流式收集匹配 + 匹配上限 100 + 单行截断 500 字符 | 无，每次真跑 |
| **ZCode** | 内嵌搜索分支（默认开启，bash 里的 `find`/`grep` 走内嵌实现）+ 独立 `Grep`/`Glob` 工具 | 内嵌分支免去外部进程 | **有：WebFetch 结果缓存**——TTL 15 分钟、容量上限 50 MB、`get` 时重新插入实现 LRU |
| **DSH** | **随包分发的 ripgrep 二进制**（`@vscode/ripgrep`，无需系统安装） | 不经过 shell（argv 直传，无 quoting 与注入面）、raw stdout 上限 20 MB（注释注明对齐 Claude Code）、30 s 超时、3 s 终止宽限 | 无，但把**结果元数据**大小做成配置 |
| **Grok** | 内建影子（`find`→bfs、`grep`→ugrep）+ **常驻索引** | `ignore` walk + `nucleo` 匹配器跑在**后台守护线程**，调用方轮询当前 top-k；`fsnotify` 提供单一因果的文件系统事件流；`codebase-graph` 维护符号/导航索引 | 索引常驻内存 |

四条值得单独记下来的：

1. **二进制怎么来，是个可靠性取舍。** Pi 运行时下载（失败时会报 `ripgrep (rg) is not available and could not be downloaded`），DSH 随 npm 包分发（永远可用、且版本可控）。离线或受限网络下，随包分发明显更稳——**这是我们目前依赖外部工具时该重新评估的一点**。
2. **"搜索不进 shell"是三家共识。** DSH 的注释写得很直白：grep/glob "execute as ordinary foreground spawns through `ctx.subprocess` — never `ctx.shell`"，理由是 argv 直传没有 shell quoting，也就没有那类注入面。
3. **只有 Grok 走了常驻索引路线**（fsnotify 事件流 + 模糊搜索守护线程 + 代码库图），另外三家都是"每次真跑 ripgrep"。这是"用内存换延迟"，代价是索引失效与内存占用。
4. **跨到缓存的一条**：DSH 给搜索结果的序列化元数据单独设了上限，配置文件里叫 `searchMetaMaxBytes`，理由写得很清楚——

   > `meta` is persisted with the session log and **re-sent on every request**.

   也就是说：**存进会话的每一个字节，都要在之后每一轮请求里重新付费**。这不是缓存优化，而是"别把东西写进历史"。同理，Grok 的 fsnotify 事件流只在工作区层流转、不进模型上下文。**这条判据值得内化成我们的规矩：任何要写进会话记录的东西，先问一句"它值不值得在后续每一轮里被重发一次"。**

### 9.3 并发：四家都做了，且"能不能并行"交给工具自己声明

| 实现 | 判定方式 | 结果顺序 |
| --- | --- | --- |
| Pi | 默认 `parallel`：工具调用**串行 preflight**，通过检查的并发执行；工具可覆写自己的 `executionMode` | `tool_execution_end` 按完成顺序，**结果消息按助手源顺序** |
| ZCode | 四个安全属性（`readOnly` / `concurrentSafe` / `destructive` / `sideEffectScope`）+ 只读白名单，默认上限 10 | 按调度顺序落位 |
| DSH | `isConcurrencySafe(arguments)`，**只有精确 `true` 才算并行**；未知/隐藏/未声明/抛异常一律归为 exclusive；exclusive 形成屏障，parallel 走**有界滚动池**、启动前重新分类 | "Dispatch may overlap, while policy, results, and result context remain **model-ordered**" |
| Grok | `FuturesUnordered` 并发 | **按原始下标还原槽位** |

两条共性：

- **并发执行 + 按模型顺序落位。** 四家全部如此。顺序不只是可读性问题——它直接决定下一轮请求的前缀形状（§3.6）。
- **"能不能并行"是工具声明的，而且失败关闭。** DSH 那个"只有精确 `true` 才并行，抛异常也算 exclusive"是最保守也最稳的写法：**声称自己能并行的工具要自己负责，声明不出来就串行**。

#### 我们这里有一条现成的待办：扩展工具都没声明并发策略

Pi 的默认是并发执行（`toolExecution: "parallel"`），工具可以自己覆写：

```260:268:F:/_oss-research/pi-agent-core-src/pi-agent-core/src/types.ts
	/**
	 * Tool execution mode.
	 * - "sequential": execute tool calls one by one
	 * - "parallel": preflight tool calls sequentially, then execute allowed tools concurrently;
	 *   emit `tool_execution_end` in tool completion order after each tool is finalized,
	 *   then emit tool-result message artifacts later in assistant source order
	 *
	 * Default: "parallel"
	 */
	toolExecution?: ToolExecutionMode;
```

而 `executionMode` 是从扩展定义一路透传到运行时的（`wrapToolDefinition` 与 `createToolDefinitionFromAgentTool` 都显式搬运了这个字段）：

```5:21:F:/_oss-research/pi-src/core/tools/tool-definition-wrapper.ts
export function wrapToolDefinition<TDetails = unknown>(
	definition: ToolDefinition<any, TDetails>,
	ctxFactory?: () => ExtensionContext,
): AgentTool<any, TDetails> {
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		constrainedSampling: definition.constrainedSampling,
		prepareArguments: definition.prepareArguments,
		executionMode: definition.executionMode,
```

**但我们的六个扩展工具一个都没声明它**：`create_plan`、`todo_write`、`spawn_agent`、`wait_agent`、`list_agents`、`interrupt_agent` 全部落在默认的"并行"上。而这几个恰恰都在改共享状态——计划阶段机、fleet 的并发槽位与注册表状态。同一条助手消息里同时出现 `spawn_agent` 与 `interrupt_agent`（或 `create_plan` 与写工具）时，执行顺序不由我们决定。

**修法是一行**：给这些工具加 `executionMode: "sequential"`。这也正是 DSH 那条 fail-closed 规则想防的事。

### 9.4 这三块与缓存的关系（收束）

- **性能是"少花时间"，缓存是"少花 token"**，但两者的交叉点是同一件事：**什么内容会被写进历史**。写进去，就要在后续每一轮里重发、重算、重新付费。
- 由此得到三条可执行的规矩：
  1. 大输出**落盘不进历史**（Pi 的临时文件、DSH 的 spill、Grok 的输出文件）——模型想读才读；
  2. 必须进历史的东西**在写入前就裁剪**（DSH 的 `searchMetaMaxBytes`、§3.7 的工具结果裁剪）；
  3. 只为"人"服务的数据（终端回放、文件事件、索引）**根本不进模型上下文**。

**我们在这条上做对了一处，值得记下来**：Pi 的工具结果把"给模型看的内容"（`content`）和"给界面看的细节"（`details`）分开了，而转成 provider 请求时只读 `content`：

```1182:1207:F:/_oss-research/pi-ai-src/pi-ai/src/api/anthropic-messages.ts
function convertToolResult(
	msg: ToolResultMessage,
	...
): { toolResult: ContentBlockParam; siblingContent: ContentBlockParam[] } {
	...
	const convertedContent = convertContentBlocks(msg.content);
	return {
		toolResult: {
			type: "tool_result",
			tool_use_id: msg.toolCallId,
			content: references.length > 0 ? references : convertedContent,
			is_error: msg.isError,
		},
```

`details` 照样进会话文件（界面重放、diff 预览、截断元数据都靠它），但**从不进 provider 载荷**——所以它只花磁盘，不花 token。这正好避开了 DSH 要给 meta 设上限的那条坑：**"存下来"和"每轮重发"是两件事，能分开就要分开**。

---

## 10. 未验证 / 需要谨慎的地方

- **三家都已有独立取证笔记**：`docs/research/notes/{zcode,dsh,grok-build}.md`，本文的全部结论均可在这三份笔记里找到逐段原文与永久链接。
- **因果关系无法从源码证伪**：ZCode 那边能证明的是"官方 GLM 套餐走 `anthropic-messages` + `cache_control: ephemeral` + 多段 system 前缀"，但**不能**证明是"先有 GLM 缓存需求才这样设计"还是"先有 Anthropic 形态、再让 GLM 接入"。同理，本文多处"为缓存而这么做"的动机判断，代码注释里未必写明——凡是这类我都标注了「推测」。
- **ZCode 的 bash 进程启动位置仍未逐行追踪**：`core/src/tool/handlers/bash.ts` 只做策略与投影，实际 `spawn` 在 `packages/services` / `zcode-server-cli` 一侧。但"没有 PTY"现在是**强证据**：整个 `apps/zcode-cli/packages/*/package.json` 里没有 `node-pty` 依赖，且工具描述自己写了 "Shell state (env vars, functions) does not persist"。
- **Grok 的缓存机制分两条协议线，能力不对等**（已查清）：Anthropic `messages` 路径有 `apply_cache_breakpoints` 的 3+1 断点；OpenAI 兼容的 `responses` 路径没有断点，但**有** `prompt_cache_key`。也就是说走 Responses 后端时，缓存完全依赖服务端自动前缀缓存 + 客户端把请求做成"上一条的追加扩展"。
- **Grok 的 `find`→`bfs` / `grep`→`ugrep` 影子替换、`nono` 沙箱、`.grok/sandbox.toml` 的供应链防护**都只有笔记级证据（由配套笔记的永久链接支撑），我没有逐行复核这些实现。
- **「Stealth mode / 伪装 Claude Code 工具名」的真实动机没有代码注释支撑**，属于推测；代码只显示它在 OAuth token 分支生效。
- **`deepseek-v4-pro` 为什么不声明 `in-history`**：目录里只有 `deepseek-flash` 声明了它，更贵的 pro 没有。源码没给理由，**推测**是该端点尚不支持 mid-history 的 system 消息。
- **DSH 的两个关键数值缺少依据**：`maxInlineBytes: 50000`（spill）与 `thresholdChars: 8192`（工具结果裁剪）源码只写了 "Low-friction defaults for coding-agent tool output"，没有测算说明。
- **未在 DSH 源码中找到**除 `sandbox` / `approval` 之外的"危险命令黑名单"或正则拦截；也**没有**任何客户端可配置的前缀缓存开关或 TTL——它完全依赖服务端自动前缀缓存，只做"不破坏前缀"这一件事。
- 三家的 README 里都有大量"设计意图"陈述（尤其 DSH 与 Grok），本文引用时**尽量只引用与源码一致的部分**，纯文档性的性能承诺（例如缓存命中率提升百分比）一律没有采信。
- 三家仓库都在活跃变动：GitHub 上尚无 ZCode 的正式 Release/tag；上述行号只对本文给出的 SHA 有效。

---

## 附录 A：解出来的 Grok 提示词

解密产物在 `F:/_oss-research/grok-prompts/`：

| 文件 | 大小 |
| --- | --- |
| `base_prompt.md` | 10,155 字符 |
| `codex_prompt.md` | 21,206 字符 |
| `subagent_prompt.md` | 4,902 字符 |

原文仍是**未渲染的模板**（含 `${%- if %}...${%- endif %}` 与 `${{ ... }}` 占位符），直接用 `grok prompt --section template` 可以拿到同样内容。

## 附录 B：一页速查

| 维度 | 最小可抄的一条 |
| --- | --- |
| Tools | 工具顺序必须是显式契约（ZCode 白名单排序 / DSH 字典序 + 测试），不是注册顺序的副产品 |
| Tools | 工具说明可以完全不进 system prompt，只走 `tools` 字段（ZCode），让 system 前缀更短更稳 |
| Tools | "能不能并行"应该是工具定义里的安全属性（readOnly / concurrentSafe / destructive / sideEffectScope），不是在调度器里维护特例表 |
| Tools | 提示词里提到某个工具前，先确认它在（Grok `tools.by_kind.*`；我们只在 Ultra 里做了半条） |
| 缓存 | 系统提示按"稳定/易变"分段，易变内容后移或走独立通道（ZCode `cacheHint`、DSH 三段/上下文插件） |
| 缓存 | 头部重写改成尾部追加（DSH `systemPromptUpdate: in-history`），并留一格断点给网关（Grok 第四个断点） |
| 缓存 | 量化浪费：`missedTokens / missedCost / idleMs / modelChanged`（Pi `cache-stats.ts`） |
| 提示词 | 一次性调用不要买缓存写入（Pi `cacheRetention: "none"`） |
| 提示词 | 规则文件/技能/日期/环境各自独立成段，且知道自己的"投递通道"与生命周期（ZCode 26 种 source） |
| 提示词 | 动态上下文"不变则不写"（DSH `RuntimeContextProjection.project()` 返回 `undefined`） |
| 上下文 | 在"不压缩"和"整段摘要"之间补一档：只清旧工具结果正文、保留最近若干条、带空闲门槛与最小收益门槛（ZCode 微压缩） |
| 提示词 | 提示词里提到某个工具前先确认它在（Grok `tools.by_kind.*`；我们只在 Ultra 里做了半条） |
| bash | 强制 `NO_COLOR=1` / `TERM=dumb` / `FORCE_COLOR=0`，从源头消灭颜色转义（Grok 每次调用都做）——**我们目前没有** |
| bash | 双阈值截断 + 保尾 + 溢出落盘 + 行号区间话术（Pi 2000 行/50KB）——dsh 在同一理由下也选了保尾，并注明引用来自 pi |
| bash | 大输出再补一档"砍中间"（DSH 8192 触发 / 头 4096 / 尾 1024，纯代码无模型） |
| bash | 输出先清洗再进上下文（ANSI/二进制/CRLF）——**我们目前漏了这一条** |
| bash | 持久/非持久做成两个工具名，而不是一个参数（DSH `tool-bash` vs `tool-bash-persistent`） |
| bash | 最便宜的一档持久化：只持久 cwd，带越界重置与明确话术（ZCode）——比直接上 PTY 划算 |
| bash | 安全用"沙箱 + 审批"两个旋钮，不用危险词黑名单（DSH read-only / workspace-write / danger-full-access） |
| bash | 危险命令防护只卡"确定会伤到自己"的写法（裸 `&`、自匹配的 `pkill -f`），并在错误文案里给出替代参数（Grok） |
| bash | 超时先转后台再考虑终止（Grok 前台 15 s 预算 → 转后台；我们目前是直接 kill） |
| 架构 | 把"请求可被日志逐字节重建"当不变量来测（DSH `agent-loop/invariant` 用全新 Session 重建每次请求比对），前缀稳定自然成立 |
| 架构 | 把"请求 N 的输入是请求 N+1 的字节前缀"写成断言测试，覆盖记忆注入/推理项/**工具 schema 变化**/模型切换（Grok） |
| 架构 | 为保缓存接受具体的复杂度：日期不改前缀只发提醒、记忆块禁止重打分、图片剔除带迟滞、子代理前缀与父字节一致 |
| 横向 | 同一模型下各家缓存命中率实测差近 10 个百分点（ZCode 98.60% vs Claude Code 89.31%），harness 层的缓存工程是可测量的成本项（社区数据） |
| 横向 | 第三方实现反复收敛到"追加而非改写"：Codex 把配置更新作为新消息追加、DSH 的 `in-history`、Grok 的跨零点 reminder |
| 官方 | **不要在会话中途增删工具**（Anthropic 明确禁止，Claude Code 用 EnterPlanMode/ExitPlanMode 工具而非换工具集）——我们目前做反了，见 §8.1 |
| 官方 | 要动态换工具就用 `defer_loading` 轻量桩：桩排在缓存断点之后、不进前缀，前缀不受影响（pi-ai 已实现） |
| 官方 | 改思考参数会失效 messages 缓存；我们的 Ultra 就是一次线上思考等级改写，建议给 `CacheMiss` 加 `thinkingChanged` |
| 官方 | TTL 选择看"共享前缀的请求间隔"：<5 分钟用 5 分钟档（严格更便宜），5–60 分钟才值得上 1 小时档（2× 写入价需 3 次才回本） |
| 性能 | 流式输出必须节流（Pi 100 ms / Grok 16 ms 批量），别让每个 chunk 触发一次渲染 |
| 性能 | 大缓冲给回放、小窗口给模型：终端回放与文件事件不该进上下文，模型想读才读 |
| 性能 | "能不能并行"由工具自己声明且失败关闭（DSH 只认精确 `true`）——我们六个扩展工具目前都没声明，跑在默认并发下 |
| 搜索 | 搜索不进 shell（argv 直传，无 quoting 与注入面）；二进制随包分发比运行时下载更可靠 |
| 搜索 | 唯一做了结果缓存的是 ZCode 的 WebFetch（TTL 15 分钟 / 上限 50 MB / get 重插 LRU）；唯一做了常驻索引的是 Grok（fsnotify + 守护线程模糊搜索 + 代码库图） |
| 通用 | 任何要写进会话记录的东西，先问"它值不值得在后续每一轮里被重发一次"（DSH 因此给搜索 meta 单独设上限） |

## 附录 C：配套取证笔记

| 文件 | 内容 |
| --- | --- |
| `docs/research/notes/zcode.md` | ZCode 全量取证笔记（2719 行）：显式工具注册表与 alias 冲突拒绝、四类工具集开关、三档输出策略 `inline/truncate/artifact`、稳定/动态段划分、三家缓存字段统一、无 PTY 的 cwd 记忆、破坏性命令判定 |
| `docs/research/notes/dsh.md` | DSH 全量取证笔记（1157 行，124 条永久链接）：工具目录、4 个 preset、`in-history` 四步链路、压缩热前缀、工具结果裁剪、沙箱模型 |
| `docs/research/notes/grok-build.md` | Grok Build 全量取证笔记（2302 行）：工具注册链路与参数修复四件套、前缀稳定断言测试、为保缓存的六处妥协、持久 shell 的 state dump/replay、沙箱与危险命令防护、按内容类型分档的输出预算 |
| `F:/_oss-research/grok-prompts/` | 解出的 Grok 三份提示词模板原文 |
| `F:/_oss-research/dump-pi-src.cjs` | 从 sourcemap 还原 Pi 原始 TS 的脚本 |
| `F:/_oss-research/decrypt-grok-prompts.cjs` | Grok 混淆提示词解密脚本 |

## 附录 D：社区来源清单

| 主题 | 链接 |
| --- | --- |
| 缓存命中率横评（ZCode 98.60% / Claude Code 89.31%） | https://blog.4sapi.com/blog/deepseek-ai-coding-cache-benchmark |
| DSH 99% 命中率与前缀稳定性分析 | https://www.besthub.dev/articles/deepseek-harness-how-99-cache-hits-validate-request-prefix-stability-f40160929ea9 |
| 自建缓存感知 agent runtime（含论文数字转述） | https://niteagent.com/blog/build-log-prompt-cache-agent-runtime/ |
| DSH 架构源码级分析（插件内核） | https://martianlee.github.io/posts/2026-09-05-deepseek-harness-architecture |
| DSH 插件架构（提到同时挂载 `llm-deepseek` 与 `llm-pi-ai`） | https://www.alex908.com/en/blog/deepseek-harness-architecture |
| DSH 工具系统讲解 | https://dev.to/wonderlab/deepseek-harness-series-03-the-tool-system-giving-your-agent-hands-1a3b |
| ZCode 长文实测（含 GLM-5.3 训练侧） | https://flaviocopes.com/zcode/ |
| Pi + DeepSeek 的 "Harness Multiplier" | https://docs.bswen.com/blog/2026-09-01-pi-agent-deepseek-harness-multiplier/ |

## 附录 E：官方文档来源（第 8 节核对用）

| 主题 | 链接 |
| --- | --- |
| Claude Code 团队：提示缓存就是一切（"Never add or remove tools mid-session"、Plan Mode 的正确做法、`defer_loading`） | https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything |
| Anthropic 官方提示缓存文档（断点上限 4、最小可缓存前缀分档、20-block lookback、1 小时 TTL 定价） | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| Anthropic 官方：工具定义与提示缓存（`defer_loading`、失效对照表） | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching |
| Anthropic skills 仓库里的提示缓存放卡（渲染顺序 `tools → system → messages`、经济学与 TTL 判据、预热写法） | https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md |
| `NO_COLOR` 标准 | https://no-color.org/ |
| `FORCE_COLOR` 标准（注意其语义是"强制开启"） | https://force-color.org/ |
| agent 感知 CLI 的环境变量契约（含 CVE-2026-22708 的提醒） | https://agentpatterns.ai/tool-engineering/agent-aware-cli-via-env-var/ |
| MCP 规范要求工具列表顺序确定（供缓存复用） | https://connector.zone/guides/deterministic-tool-ordering/ |
