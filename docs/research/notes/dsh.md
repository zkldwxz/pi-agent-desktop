# dsh (DeepSeek Harness) 针对自家 DeepSeek 模型的工程优化 —— 源码取证笔记

- 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 本地路径：`F:/_oss-research/dsh`
- 固定 HEAD：`ddefc45fbc7f8e46dd73185e68295696d1297887`（2026-09-17，release `dsh-0.1.6-alpha.2`）
- 永久链接前缀（下文所有永久链接均已展开为绝对 URL，固定到该 SHA）：`https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/`
- 方法：先读 `docs/` 与 `.agents/notes/` 定位线索，再逐条回读源码确认；下文每条结论都给出「相对路径:起-止」+ 原样代码 + 永久链接。**没有代码证据的推测一律标注「推测」。**
- 仓库形态：pnpm monorepo，TS 为主 + `python/` 子包；`packages/<组>/<插件包>/`，每个插件包是 Cordis 插件（`export function apply(ctx, config)` + `export const inject`）。

---

## 0. 全局设计前提（理解后面所有优化的钥匙）

### 0.1 「模型可见 ⟺ 可被日志重建」——前缀稳定性是架构级不变量，不是补丁

`dsh` 把「每一次 LLM 请求都能从 session log 逐字节重建」写成硬约束，而**前缀缓存命中率是这条约束的推论**：append-only 的日志经每个事件节点的纯函数投影后，天然得到「后继请求 = 前驱请求的追加扩展」。

`.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:19`：

```text
Prefix-cache stability is corollary #1, not the headline: an append-only log
projected by a per-node pure function yields requests that are append-extensions
of their predecessors whenever the header is unchanged — stability is emergent,
not managed.
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md#L19>

强制手段（同文件 `:31`）：
- `dsh-agent-loop/invariant` 会用一个**全新 Session 从日志独立重建每一次请求**，再在 `llm/stream` 处比对 messages 与折叠后的 header —— 不能靠 live cache 自证。
- 请求对象由 `markAgentLoopRequest()` 打上进程内身份，direct one-shot（如压缩摘要调用）被排除在外。
- 「with-key e2e 要求第一个请求之后必须出现正的 cache-read token」：`A with-key e2e requires positive cache-read tokens after the first request`。

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md#L31
- 会话层如何落地这套纪律（append-only、只在 model-visible 状态真变化时重置）：`packages/core/agent-loop/README.md:91-95`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/README.md#L91-L95>

### 0.2 工具目录顺序是「逐字节确定性」的

`packages/core/system-prompt/src/index.ts:242-245`：

```ts
/** Order tool schemas lexicographically by name. */
function compareToolNames(a: ToolSchema, b: ToolSchema): number {
  return compareNames(a.name, b.name)
}
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L242-L245>
- `compareNames` 是**码点序比较**（`a < b ? -1 : a > b ? 1 : 0`，`:233-235`），注释明确写 `Code-unit name comparison — locale-independent, so the order is identical on every machine.`；未配置 `toolOrder` 时工具按此排序，保证跨机器字节一致。
- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L233-L235>

---

## 1. Tools（工具系统）

### 1.1 插件化注册：工具 = Cordis 插件 `apply()` 内的 `ctx.tools.register()`

工具不是内建表，而是每个 `packages/*/tool-*` 包在 `apply(ctx, config)` 里注册；`inject` 声明它需要的服务，注册返回精确的 disposer（卸载即摘除）。

`packages/core/tools/src/index.ts:1043-1068`：

```ts
  register(definition: ToolDefinition): () => void {
    const name = definition.name
    const output = (definition as Partial<ToolDefinition>).output
    if (output === undefined || typeof output !== 'object'
      || typeof output.render !== 'function'
      || (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')) {
      throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
    }
    assertSupportedJsonSchema(output.schema)
    const timeoutMs = definition.timeoutMs
    if (timeoutMs !== undefined
      && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`)
    }
    // Reserved unconditionally: any agent may select a code mode for itself,
    // so a name free to take under the deployment default would become a
    // collision the moment a preset mounted.
    if (name === RUN_CODE_NAME) {
      throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.tools.insert(name, definition),
      { label: 'tools.register()' },
    )
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/tools/src/index.ts#L1043-L1068>
- 每个 `apply()` 里注册的例子见 `packages/shell/tool-bash/src/index.ts:236-330`（`ctx.tools.register(defineTool({...}))`）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L236-L330>

**按需加载**由 Cordis loader 的声明式组合实现，而不是工具层运行时代码：每个 preset / bundle 是一份 YAML，行带 `disabled`（可为平台表达式或环境变量），loader 决定挂载哪些插件，工具随之出现或消失。

`packages/preset/agent-presets/presets/standard/agent.cordis.yml:45-51`：

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L45-L51>

### 1.2 内置工具清单（从生成的 catalog 抽取）

`docs/tool-catalog.md` 由 `scripts/gen-tool-catalog.ts` 真实启动每个 tool 插件后读取 `ctx.tools.schemas()` 生成（`pnpm run gen-tool-catalog` / `verify-tool-catalog`），并有完整性守卫（`packages/*/tool-*` 漏一个就失败）。抽取的「包 → 模型可见工具名」清单：

| 包（`@deepseek-ai/` 前缀省略） | 模型可见工具名 |
|---|---|
| `dsh-tool-fs` | `read`, `write`, `edit`, `read_image` |
| `dsh-tool-fs-search` | `glob`, `grep` |
| `dsh-tool-bash` | `bash` |
| `dsh-tool-pwsh` | `pwsh` |
| `dsh-tool-bash-persistent` | `bash`（PTY 持久版） |
| `dsh-tool-pwsh-persistent` | `pwsh`（PTY 持久版） |
| `dsh-tool-str-replace-editor` | `str_replace_editor` |
| `dsh-tool-terminal` | `terminal_open`, `terminal_send`, `terminal_read`, `terminal_list`, `terminal_signal`, `terminal_close` |
| `dsh-tool-jobs` | `job_list`, `job_output`, `job_kill` |
| `dsh-tool-todo` | `todo_write` |
| `dsh-tool-ask-user` | `ask_user_question` |
| `dsh-tool-web` | `web_search`, `web_fetch` |
| `dsh-tool-subagent` | `subagent`, `subagent_fork`, `list_subagent_models` |
| `dsh-tool-subagent-control` | `send_message`, `interrupt_agent`, `list_agents` |
| `dsh-tool-skill` | `skill` |
| `dsh-tool-goal` | `create_goal`, `get_goal`, `update_goal` |
| `dsh-tools`（PTC 传输） | `run_code` |
| `dsh-plan-mode` | `exit_plan_mode` |
| `dsh-tool-workflow` | `workflow` |
| `dsh-tool-ralph` | `ralph`（默认 disabled） |
| `dsh-tool-lsp` | `lsp` |
| `dsh-tool-session-query` | `session_search`, `session_trace`, `session_event_read/search/trace` |
| `dsh-tool-present` | `present` |
| `dsh-plugin-manager/tools` | `plugin_manager`（默认 disabled） |
| `dsh-tool-cordis` | `cordis_inspect_list`, `cordis_inspect_query` |
| `dsh-mcp-resources` | `list_mcp_resources`, `read_mcp_resource`, `list_mcp_resource_templates` |
| `dsh-schedule` | `schedule_create`, `schedule_list`, `schedule_delete` |

- 永久链接（表头 + 说明）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/tool-catalog.md#L1-L14>

**与 Claude Code / Codex 的差异（有代码证据的部分）**：
- 没有 `Task`/`Agent` 式单一子代理工具，而是 **两个位置参数化的委派工具**（`subagent` = 全新 spawn，`subagent_fork` = 继承历史的 fork），且可挂多个 provider（`spawn` / `fork` / `codex` / `claude-code` / `acp`）——即 dsh 反过来把 Claude Code、Codex 当成自己的子代理后端。见 `packages/preset/agent-presets/presets/standard/agent.cordis.yml:181-220`
- 没有 `Bash` 与 `bash` 同名混用；POSIX 与 Windows 分两条独立插件（`tool-bash` / `tool-pwsh`），且各有「一次性进程」与「持久 PTY」两种实现。
- 有 Claude Code / Codex 都没有的：`run_code`（PTC 模式，用一段 TS/Python 程序编排多步工具调用）、`job_*` 后台任务控制器、`session_query`（会话日志检索）、`read_image`。这些同样有源码证据（见 1.3、4.3）。
- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L181-L220>

### 1.3 「模式」：Standard / PTC / Minimal / Creator —— 由 agent preset 改变工具集合与提示词

仓库里存在 4 个 shipped preset，名字在 `preset.yml` 里是中文：

`packages/preset/agent-presets/presets/*/preset.yml`：

```yaml
# standard
name: 标准模式
description: 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。
order: 1
```

```yaml
# ptc
name: PTC 模式
description: 功能完整的编码 Agent，但默认不提供 workflow 工具；其他工具通过 PTC 模式 SDK 呈现，让模型用一个 TypeScript 程序组合多步操作。
order: 2
```

```yaml
# minimal
name: 极简模式
description: 仅提供持久 shell 的单工具编码 Agent。
order: 3
```

```yaml
# cordis
name: 创造模式
description: 用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、持久化插件管理和 preset 创作指导。
order: 4
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/preset.yml#L1-L3>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/ptc/preset.yml#L1-L3>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/minimal/preset.yml#L1-L3>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/cordis/preset.yml#L1-L3>

**Minimal 模式：单工具 + 固定提示词 + 无压缩**

`packages/preset/agent-presets/presets/minimal/agent.cordis.yml:1-14`：

```yaml
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

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/minimal/agent.cordis.yml#L1-L14>
- `complete: true` 的语义在 `packages/core/system-prompt/src/index.ts:69-75`（`PromptSection.complete`）：assembly 仍跑完整 waterfall 以解析工具/变量，然后把系统提示**还原为这一节**，多个 complete 段直接报错。

**PTC 模式：工具集合换成 `run_code` + 生成的 SDK 段**

`packages/preset/agent-presets/presets/ptc/agent.cordis.yml:280`：`mode: ptc`

`packages/core/tools/src/index.ts:652-667`：

```ts
/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'ptc' | 'both'

/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
  /**
   * Model presentation. `native` (default) sends every visible schema; `ptc`
   * sends only `run_code` plus a generated SDK prompt and collapses the
   * executor to the same surface (a model-direct call may only name
   * `run_code`; `run_code` SDK sub-dispatches keep every visible tool); `both`
   * sends both forms. PTC mode requires a `ctx.ptcRuntime` whose `language`
   * has a registered SDK renderer (TypeScript or Python) and fail prompt
   * assembly when it is absent or has no renderer. Under `ptc`, native names
   * in `toolOrder` are invalid.
   */
  mode?: ToolPresentationMode
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/tools/src/index.ts#L652-L667>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/ptc/agent.cordis.yml#L280>
- 进程级环境开关在 mode bundle 上：`packages/bundle/web-app/cordis.patch.yml:35-39` 的 `DSH_TOOLS_MODE (native|ptc|both)`（注释自称临时方案，等 UI 支持按 session 选择）。
- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/web-app/cordis.patch.yml#L35-L39>

**per-agent 工具裁剪**：`ctx.tools.restrict({allow, deny})`（`packages/core/tools/src/index.ts:1070-1085`），且被禁止用在全局 context 上（`restrict() requires a scoped context (agent.ctx)`）。

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/tools/src/index.ts#L1070-L1085>

### 1.4 工具结果溢出：`spill` 三件套（判断 / 预览 / 落盘）

三包分层：`dsh-spill` 只定义 `ctx.spillStore.saveText()` 契约；`dsh-spill-local` 实现本地文件后端；`dsh-spill-policy` 决定何时溢出。

**阈值（deployment 默认 50 000 字节）**：`packages/bundle/base/cordis.patch.yml:390-396`：

```yaml
    - id: spill-local
      name: '@deepseek-ai/dsh-spill-local'

    - id: spill-policy
      name: '@deepseek-ai/dsh-spill-policy'
      config:
        maxInlineBytes: 50000
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/base/cordis.patch.yml#L390-L396>

**算法**：`packages/spill/spill-policy/src/index.ts` 的 `apply()`：

```ts
export function apply(ctx: Context, config: Config): void {
  const maxInlineBytes = config.maxInlineBytes
  // Omitted ⇒ no automatic spill policy: register nothing at all.
  if (maxInlineBytes === undefined) return
  // Validate at LOAD, not per call: a negative/fractional cap would reach
  // TextRetainer's assertBudget and throw, turning every oversized-result call
  // into an isError. A bad config must fail the deployment, not the tool.
  if (!Number.isInteger(maxInlineBytes) || maxInlineBytes < 0) {
    throw new Error(`spill-policy: maxInlineBytes must be a non-negative integer (got ${maxInlineBytes})`)
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L105-L115>

关键细节（都在同一文件，逐条给链接）：
1. **头尾各半预览**：`preview()` 用 `TextRetainer({ kind: 'headTail', headBytes: ceil(budget/2), tailBytes: floor(budget/2) })`（`:96-102`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L96-L102>
2. **通知字节数从同一预算里预留**，保证「预览 + 空白行 + 通知」永不超 `maxInlineBytes`（`:158-170`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L158-L170>
3. **`read` 工具被刻意跳过**，避免 `read → spill → read again` 死循环（`:190-192`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L190-L192>
4. **最佳努力语义**：没有 session owner / 没有 `ctx.spillStore` / 落盘失败 ⇒ 记日志并保留原始内联结果，「spill 失败绝不把成功的工具调用变成 isError」（`:20-28`、`:149-156`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L20-L28>
5. 第二条臂 `tools/ptc-dispatch-log` 用同一函数裁剪 `tool/ptc-dispatch` 事件里 `run_code` 子调用的日志副本（`:212-226`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/index.ts#L212-L226>

**落盘位置与命名**：`packages/spill/spill-local/src/store.ts:78-116`：

```ts
export function sessionDir(root: string, sessionId: string): string {
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
  return join(root, `session-${hash}`)
}
...
export async function saveTextFile(options: SaveTextOptions): Promise<SavedText> {
  const dir = sessionDir(options.root, options.sessionId)
  const path = join(dir, `${randomBytes(6).toString('hex')}-${encodeSegment(options.suggestedName)}`)
  let handle
  for (;;) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      handle = await open(path, 'wx', 0o600)
      break
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-local/src/store.ts#L78-L116>
- 默认根目录是 `mkdtempSync(join(tmpdir(), 'dsh-spill-'))`（`:16`、`:37`），每进程私有 0700；`encodeSegment()` 把所有不可信字符转义为 `~XXXX`，整段的 `.` 与 `..` 也一并转义，杜绝路径穿越（`:48-70`）。
- 永久链接（`encodeSegment`）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-local/src/store.ts#L48-L70>

**通知文案**（模型看到的东西）由 `formatSpillNotice()` 拼装：`(Omitted N bytes. Full formatted result stored at: <locator>. <retrievalHint>)`，见 `packages/spill/spill-policy/src/notice.ts:24-26`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/spill/spill-policy/src/notice.ts#L24-L26>

**注意**：spill 替换的是 `tools/post-execute` 的最终结果，而**这个结果就是写进 `tool/result` 事件的模型可见内容**（见 2.4），因此全量文本只存在于磁盘文件，不进历史。

### 1.5 工具调用协议：原生 function calling，无特殊 token / 无 XML

两条协议都是**原生 tool schema**，没有自研 XML 或特殊 token：

- **Messages（默认协议，Anthropic 形状）**：`packages/llm/llm-deepseek/src/protocols/messages/serialize.ts:134-138`
  ```ts
  ...options.tools === undefined ? {} : {
    tools: options.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
  },
  ```
  助手工具调用序列化为 `{ type: 'tool_use', id, name, input }`（`:35`），工具结果序列化为 `{ type: 'tool_result', tool_use_id, content, is_error? }`（`:99`）。
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/protocols/messages/serialize.ts#L134-L138>
- **Chat Completions（OpenAI 形状）**：`...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}`（`:227`），工具结果变成 `{ role: 'tool', tool_call_id, content: ... || '(no output)' }`（`:259-264`），工具声明为 `{ type: 'function', function: { name, description, parameters } }`（`:341-348`）。
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/protocols/chat-completions/serialize.ts#L341-L348>
- **默认协议是 `messages`**（Anthropic 形状，官方 root `https://api.deepseek.com/anthropic`），不是 chat-completions：`packages/llm/llm-deepseek/src/config.ts:81` + README 表格。
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/config.ts#L77-L81>
- 流式增量组装（`tool-call-delta` 拼接 + `block-end` 冻结）在 `packages/llm/llm/src/assembler.ts:56-105`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/assembler.ts#L56-L105>

---

## 2. 缓存机制（prompt cache / prefix cache）

### 2.1 DeepSeek 硬盘缓存的用量被显式解析，并换算成 harness 的「互斥计数」约定

DeepSeek 的 `prompt_tokens` **包含** cache hit，harness 约定是 disjoint，所以适配器把 cache read 从 input 里减掉：

`packages/llm/llm-deepseek/src/protocols/chat-completions/translate.ts:46-72`：

```ts
/**
 * Map wire usage fields. DeepSeek's `prompt_tokens` INCLUDES cache hits
 * (`prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`,
 * api/create-chat-completion); the harness TokenUsage convention is
 * DISJOINT counts, so cache reads are subtracted out of `inputTokens`.
 * ...
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const combined = usage.prompt_tokens + usage.completion_tokens
  ...
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...hasExactTotal ? { totalTokens: combined } : {},
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/protocols/chat-completions/translate.ts#L46-L72>
- 字段声明见 `packages/llm/llm-deepseek/src/protocols/chat-completions/types.ts:162-178`（`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` / `prompt_tokens_details.cached_tokens`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/protocols/chat-completions/types.ts#L162-L178>
- cache-read 在 UI/统计上被当作一等指标（`packages/llm/token-meter/src/usage-projection.ts` 里 `cacheReadTokens` 与 `cacheWriteTokens` 是独立桶，并有「失败即关闭」的严格校验）。

### 2.2 ★ 核心证据：`systemPromptUpdate: 'in-history'` —— DeepSeek 专属的「系统提示改动不砸缓存」机制

这是整份笔记里最像「专门为自家模型做的工程优化」的一条。

**（a）DeepSeek 官方模型目录把 `deepseek-flash` 标成 `in-history`**

`packages/llm/llm-deepseek/src/common/models.ts:5-20`：

```ts
/** Advisory official model entries; deployments may replace the catalog. */
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
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
]
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/common/models.ts#L5-L20>
- 语义（类型定义）：`packages/llm/llm/src/types.ts:383-394`
  ```ts
  export type SystemPromptUpdate = 'in-history'
  ...
  /** Declared mid-conversation system prompt handling; absent means only a leading system message is read. */
  systemPromptUpdate?: SystemPromptUpdate
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/types.ts#L383-L394>
- 只有 `'in-history'` 是合法值，其它值在加载期就抛错：`packages/llm/llm-deepseek/src/config.ts:169-171`
  ```ts
  const systemPromptUpdate: string | undefined = model.systemPromptUpdate
  if (systemPromptUpdate !== undefined && systemPromptUpdate !== 'in-history') {
    throw new Error(`llm-deepseek: catalog model "${model.id}" systemPromptUpdate must be "in-history" when present`)
  }
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/config.ts#L169-L171>
- 未声明该能力的模型**不会**得到该优化（`packages/llm/llm-deepseek/src/common/model-info.ts:78` 只在配置存在时透出字段）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/common/model-info.ts#L78>

**（b）loop 读 `prepareCall()` 的能力位，把系统提示变更「追加到缓存历史之后」而不是原地改写 node 0**

`packages/core/agent-loop/src/agent.ts:359-373`：

```ts
    const { assembly } = decision
    const renderedPrompt = renderPrompt(assembly)
    let firstAttempt = true
    while (true) {
      const { config, preparedCall } = await this.prepareRequest(turn, step, signal)
      const startsRequestSeries = firstAttempt && decision.startsRequestSeries === true
      const commits = this.systemPrompt.project(renderedPrompt, {
        inHistory: preparedCall?.systemPromptUpdate === 'in-history',
        startsSeries: startsRequestSeries
          || this.requestSurfaceGeneration !== this.session.surface.contentGeneration
          || this.toolsChanged(assembly.tools),
      })
      for (const { message, intent } of commits) {
        this.session.append('system/message', { turn, step, message }, intent)
      }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/agent.ts#L359-L373>

`packages/core/agent-loop/src/runtime-context.ts:77-98` 是决策本体：

```ts
  project(rendered: string, input: SystemPromptDecisionInput): SystemPromptCommit[] {
    const nodes = this.systemNodes()
    const head = nodes[0]
    if (head === undefined) {
      return [{ message: createSystemMessage(rendered, SOURCE), intent: { surfaceOp: 'append' } }]
    }
    const latest = nodes.findLast(node => node.text !== '') ?? head
    if (!input.inHistory || input.startsSeries || rendered.length === 0) {
      const updates = nodes.slice(1).filter(node => node.text !== '')
        .map(node => this.replace(node.seq, ''))
      if (head.text !== rendered) updates.push(this.replace(head.seq, rendered))
      return updates
    }
    if (latest.text === rendered) return []
    return [{ message: createSystemMessage(rendered, SOURCE), intent: { surfaceOp: 'append' } }]
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/runtime-context.ts#L77-L98>
- 三个分支：① 没有 system node ⇒ 追加（占位 node 0）；② 不支持 `in-history`、或开启新请求序列、或提示被清空 ⇒ **把 node 0 原地改写**（最坏情况：整段前缀从第一个 token 起全部失效）；③ 支持 `in-history` 且序列延续 ⇒ 提示未变则**一个事件都不写**，变了则**追加**一条新的 `system/message`，历史前缀继续可复用。
- adapter 侧消费方式：`packages/llm/llm-deepseek/src/protocols/messages/serialize.ts:58` 判定能力，`:84-96` 处理 system 分支——`inHistory` 为真时，第一条 system 作为顶层 `system`，之后的 system 快照被插在对应 user/tool-result 轮之后（下面这段是跨行的节选，`...` 处省略了若干行）：
  ```ts
  const messages: WireMessage[] = []
  let historySystem: string | undefined
  const systemUpdates: WireMessage[] = []
  ...
  const inHistory = model?.systemPromptUpdate === 'in-history'
  const input = ...
  for (const message of history) {
    if (message.role === 'system') {
      ...
      if (inHistory && messages.length > 0) {
        if (text.length === 0) return unsupported('empty in-history system update')
        systemUpdates.push({ role: 'system', content: [{ type: 'text', text }] })
      } else {
        historySystem = text
      }
      continue
    }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/src/protocols/messages/serialize.ts#L58-L96>（`inHistory` 判定在 `:58`，system 分支在 `:84-96`）
- 文档化结论（KV Cache 小节）在 `packages/core/agent-loop/README.md:158-160`：
  ```text
  #### KV Cache effect

  Append-only only while system text, schemas, and earlier history remain byte-identical under the same provider and model route. ...
  when the prepared call declares `systemPromptUpdate: 'in-history'`, a non-empty prompt change inside a continuing request series is appended after the cached history, so the prefix through that history stays reusable.
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/README.md#L158-L160>

### 2.3 ★ 压缩（compaction）的辅助调用被改造成「热请求的前缀延长」

`.agents/notes/archived/bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md` 记录了完整的问题与决策：原本 summarizer 用一个**独立的 system prompt** + 把历史压成一条 transcript 字符串，导致第一个 token 就与热请求分叉、整个前缀缓存失效，而在会话最大时「双重全价」。修法：

- 摘要指令从前端（system）移到对话末尾（最后一条 user message）；
- 重放上一次「已路由请求」的前缀（`system` + `tools` + 历史 messages）**逐字节一致**，只在末尾追加一条 `COMPACTION_INSTRUCTION`；
- **即使模型不会调用工具也照传 `tools`**，因为 tool schema 属于被缓存的 token 序列，省略会导致后续每个 token 错位。

永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/archived/bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md#L10-L14>

代码证据 —— 前缀重建：`packages/compaction/compaction-basic/src/region.ts:534-560`：

```ts
/**
 * Reconstruct the last routed request's cacheable prefix for the shadowed
 * region: the system prompt held by the `system/message` at surface node 0,
 * the header's tool schemas, then the region's own derived messages in surface
 * order. The summarizer appends only the compaction instruction after this, so
 * the call is a genuine prefix of the conversation and reuses the provider's
 * KV cache. ...
 */
function buildSummarizationInput(
  session: Session,
  shadowedSeqs: readonly SessionSeq[],
): SummarizationInput {
  const header = session.requestHeader()
  ...
  const head = systemHead(session, session.surface.nodes[0]!)
  const system = head === undefined ? null : session.deriveEventMessage(head)
  const regionMessages = shadowedSeqs
    .map(seq => session.deriveEventMessage(session.eventAt(seq)!))
    .filter((message): message is Message => message !== null)
  return {
    ...header?.tools === undefined ? {} : { tools: header.tools },
    messages: system === null ? regionMessages : [system, ...regionMessages],
  }
}
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/region.ts#L534-L560>

指令作为尾随 user message：`packages/compaction/compaction-basic/src/summarizer.ts:24-31` 与 `:144-160`：

```ts
/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
```

```ts
  const messages: Message[] = [
    ...input.messages,
    createUserMessage({
      content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-basic' },
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.tools === undefined ? {} : { tools: [...input.tools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/summarizer.ts#L24-L31>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/summarizer.ts#L144-L160>
- 代价是显式的：手工 mid-range `compactRegion` 与「配置了不同于会话路由的 summarization provider/model」都会放弃复用（笔记 `:30` 说明这是部署的显式取舍，不是缺陷）。

### 2.4 「工具结果不写回历史」策略：用溢出/裁剪替换落盘内容，而非事后重写

工具结果的**模型可见内容被 spill-policy 替换后，才作为 `tool/result` 事件的 message 写入日志**——所以全量文本从未进入历史，不需要事后改写历史（也就不会砸缓存）。

`packages/core/agent-loop/src/tool-calls.ts:277-289`：

```ts
  const message = createToolResultMessage({
    callId: block.id,
    content: result.content,
    isError: result.isError,
  })
  session.append('tool/result', {
    turn, step,
    message,
    ...result.error?.info ? { error: result.error.info } : {},
    ...result.meta !== undefined ? { meta: result.meta } : {},
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/tool-calls.ts#L277-L289>
- `result.content` 就是 `tools/post-execute` waterfall 已被 spill-policy 裁剪后的结果（1.4 节）。
- 已进入历史的结果若仍需收缩，则走 `compaction-tool-result-pruner` 的**单节点 surface replace**（`startSeq === endSeq`），并把被遮蔽节点的价格记入 `compaction/prune` 事件，保证「纯消费者」不改状态也能正确扣减：

`packages/compaction/compaction-tool-result-pruner/src/index.ts:203-222`：

```ts
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-tool-result-pruner/src/index.ts#L203-L222>

默认阈值（**8192 字符触发，保留头 4096 + 标记 + 尾 1024**）：

`packages/compaction/compaction-tool-result-pruner/src/config.ts:6-14`：

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

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-tool-result-pruner/src/config.ts#L6-L14>
- 同一份数值在 shipped bundle 里显式再声明一遍：`packages/bundle/base/cordis.patch.yml:403-408`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/base/cordis.patch.yml#L403-L408>
- 它是**纯代码、不调用模型**（package doc: `Replay-safe, model-free tool-result pruning service.`），避免为了省 token 再花一次模型调用；同时它自身会破坏从被裁剪节点起的缓存，因此与压力逻辑同批触发。见 `:1-5`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-tool-result-pruner/src/index.ts#L1-L5>

### 2.5 动态提醒（runtime context / 时间）走「不变则不写事件」

`RuntimeContextProjection.project()` 只在渲染结果与保留值**不同**时才产出待写消息，否则返回 `undefined`：

`packages/core/agent-loop/src/runtime-context.ts:147-158`：

```ts
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
    return createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      // The cleared marker has no contributions left to attribute.
      source: sections.length === 0
        ? { kind: 'plugin', plugin: SOURCE }
        : { kind: 'plugin', plugin: SOURCE, form: 'snapshot', sections },
    })
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/runtime-context.ts#L147-L158>
- 快照文案固定为 `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.`（`packages/core/system-prompt/src/index.ts:304-308`），即「新快照取代旧快照」而不是每轮重写 —— 追加式，不砸前缀。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L304-L308>
- `time-context` 默认**每个步骤都注入时间**（`refreshIntervalMs` 省略即每步），但它是**追加 user message**，因此不破坏已有前缀；同时提供 `refreshIntervalMs` 降低历史增长。见 `packages/context/time-context/src/index.ts:50-59`、`:181-210`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/time-context/src/index.ts#L50-L59>

### 2.6 其他刻意保证字节稳定性的细节

- **请求冻结与复用**：loop 对每个派生 message 只在「首次进入请求」时 deep-freeze，并在同一 agent 内复用该冻结证明；请求构造时不冻结事件包装器（`packages/core/agent-loop/README.md:95`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/README.md#L95>
- **header 只在真变化时落新快照**：`reason` 取 `initial | resume | change | series`，未变的步骤/重试/同序列后续轮次都继承上一份快照（`packages/core/agent-loop/src/agent.ts:569-583`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/agent.ts#L569-L583>
- **call config 是会话级日志状态**：`packages/llm/llm/src/call-config.ts:1-6` 的模块注释直言「provider/model/reasoningEffort/temperature 是可以影响缓存复用的 header 状态；waterfall 只能替换它们，loop 记录变更快照，而不是允许每次调用静默漂移」。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/call-config.ts#L1-L6>
- **`request/context` 只在 provider/model/contextWindow/systemPromptUpdate 变化时才写**（`packages/core/agent-loop/src/agent.ts:585-600`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/agent.ts#L585-L600>
- **subagent fork 不带模型选择**，注释明确理由是「provider/model 与父相同，继承的历史继续享用 KV Cache」：`packages/preset/agent-presets/presets/standard/agent.cordis.yml:188-198`。永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L188-L198>
- **plan mode 不改工具目录**，理由同样是 cache stability：plan-mode 的 `section` 文案里有 `The tool catalog stays the same across modes for request-cache stability.`（`packages/bundle/base/cordis.patch.yml:308-316`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/base/cordis.patch.yml#L308-L316>

### 2.7 适配器自身明确承认的缓存失效源（诚实清单）

`packages/llm/llm-deepseek/README.md` 的 `#### KV Cache effect` 一节列出：执行世界路径变化会重写历史中的图片描述文本、刷新上传会替换 `file_id`、Files→base64 回退会改变图片表示、模型路由/提示/schema/历史/图片预算任一变化都可能导致从第一个受影响 token 起缓存失效；`reasoning passback` 在每个带思考的轮次追加。

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/README.md#L180-L186>（README 中 `#### KV Cache effect` 段落，标题在 `:180`）

---

## 3. 注入提示词优化（coding 场景）

### 3.1 system prompt 的来源与拼装顺序

**来源**：`@deepseek-ai/dsh-system-prompt` 是一个**中央注册表**（`ctx.systemPrompt`），任何插件通过 `ctx.systemPrompt.section({name, order, text})` 贡献段落，`context({name, order, text})` 贡献动态上下文，`tools(provider)` 贡献工具 schema，`variable(name, provider)` 贡献 `{{变量}}`。

**顺序**由中心化的 `SECTION_ORDERS` 常量表统一分配（避免各包抢号）：

`packages/core/system-prompt/src/index.ts:125-160`：

```ts
const SECTION_ORDERS = {
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_CORDIS: 2500,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  // Local paths and endpoints follow reusable instructions.
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
} as const
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L125-L160>
- 排序规则：`a.order - b.order || compareNames(a.name, b.name)`（`:238-241`），段落以 `\n\n` 连接（`renderPrompt`，`:280-287`）。
- 永久链接（`renderPrompt`）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L280-L287>

**「按模型分支」的实现方式**：不是 `model === 'deepseek-x'` 的硬编码分支，而是 **(i) 固定 identity 段 + (ii) persona 模板里的 `{{model}}` 变量 + (iii) adapter 上报的能力位**：

`packages/core/system-prompt/src/index.ts:426-432`：

```ts
    if (config.includeHarnessIdentity ?? true) {
      this.section({
        name: 'harness:identity',
        order: this.getSectionOrder('HARNESS_IDENTITY'),
        text: 'You are an AI agent powered by DeepSeek Harness.',
      })
    }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L426-L432>
- 第一段永远是 `You are an AI agent powered by DeepSeek Harness.`（order `-1000`，可用 `includeHarnessIdentity: false` 关掉）。
- persona 段用模板插值出模型名：`packages/preset/agent-presets/presets/standard/agent.cordis.yml:22-29`
  ```yaml
  # The preset's own persona, shadowing the deployment default for this agent.
  # `{{model}}` and `{{cwd}}` resolve from the agent's own route and workspace.
  - id: persona
    name: '@deepseek-ai/dsh-persona'
    config:
      suffix: Your working directory is {{cwd}}.
      prefix: >-
        You are a coding agent powered by the {{model}} model.
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L22-L29>
- 插值是**严格模式**：未知/未定义变量直接抛错（`interpolate()`，`packages/core/system-prompt/src/index.ts:326-363`），避免把 `{{model}}` 原样发给模型。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L326-L363>
- 变量由 loop 提供（README `Model Experience` 段 `:152`：`It supplies provider, model, and cwd variable values but no additional fixed prose.`）：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/README.md#L152>

### 3.2 环境/仓库上下文注入：易变事实走「追加式运行时上下文快照」，不变事实才进 system prompt

原则很明确：**一个会话内不变的事实**（cwd、模型名）可以写进 system prompt，因为它在整个会话里字节不变；**会变的事实**（沙箱模式、审批策略、子代理委派策略）绝不写进 system prompt，而是做成随快照追加的 runtime context。

- **不变的 cwd 进 system prompt**：standard/ptc preset 的 persona `suffix` 就是 `Your working directory is {{cwd}}.`（`packages/preset/agent-presets/presets/standard/agent.cordis.yml:24-29`），而 cwd 来自 `session.header.cwd`（会话创建后不可变）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L24-L29>
- **工具 schema 里的 `workdir`** 描述交代默认值（`Defaults to the session workspace; a relative path is resolved against it.`，`packages/shell/tool-bash/src/index.ts:254`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L254>
- **会变的沙箱/审批策略**走 runtime context 段，随快照追加：

`packages/sandbox/sandbox-policy/src/index.ts:13-18`（模块文档）：

```ts
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-policy/src/index.ts#L13-L18>
- 具体文案由 `renderPolicyContext()` 生成（三种 mode 各一句，并明确「不要因为这个策略就拒绝执行，按工具的 denial/escalation 指引走」）：`packages/sandbox/sandbox-policy/src/index.ts:42-53`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-policy/src/index.ts#L42-L53>
- runtime context 段的 order 只有三个（`SANDBOX_POLICY: 110`、`APPROVAL_POLICY: 115`、`SUBAGENT_DELEGATION: 120`）：`packages/core/system-prompt/src/index.ts:165-169`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts#L165-L169>
- cwd 的另一半在工具调用时动态解析（`resolveWorkdir()`：显式 `workdir` > 沙箱策略 root > session cwd），不靠提示词。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L147-L160>

### 3.3 AGENTS.md / CLAUDE.md 的发现与注入

`@deepseek-ai/dsh-agent-instructions` 默认候选文件名**同时包含 AGENTS.md 与 CLAUDE.md**，并支持 `.local.md` 覆盖层；项目根由向上查找 `.git` 决定；用户全局固定文件是 `$DSH_HOME/AGENTS.md`。

`packages/context/agent-instructions/src/config.ts:11-13`：

```ts
const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/agent-instructions/src/config.ts#L11-L13>
- 用户全局路径：`packages/context/agent-instructions/src/files.ts:529` → `` return `${dshHomeDisplay(dshHome)}/AGENTS.md` ``。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/agent-instructions/src/files.ts#L529>
- 发现函数：`findProjectRoot()`（`:181`）、`discoverBaselineInstructionFiles()`（`:325`）、`loadBaselineInstructions()`（`:401`）、`loadBaselineInstructionSet()`（`:414`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/agent-instructions/src/files.ts#L325-L414>
- 注入形态：**baseline 在首个请求前进入持久上下文**，之后 fs 工具触碰到嵌套/变更/删除的指令文件时增量刷新到 inbox；每批 `maxBytes` 上限由组合配置（shipped 为 `65536`）。
  - 模块文档 `packages/context/agent-instructions/src/index.ts:1-10`：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/agent-instructions/src/index.ts#L1-L10>
  - shipped 配置 `maxBytes: 65536`：`packages/preset/agent-presets/presets/standard/agent.cordis.yml:31-34`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L31-L34>
- 增量刷新挂在 `agent/pre-step` 与 `tools/result`（只跟踪 `read`/`write`/`edit` 的 `file_path`，且失败的调用不触发）：`packages/context/agent-instructions/src/index.ts:74-80`、`:343-360`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/agent-instructions/src/index.ts#L74-L80>

### 3.4 每轮动态提醒机制的三种形态

1. **runtime context 快照**（沙箱/审批/子代理委派）——见 2.5、3.2，只在变化时追加。
2. **`agent/pre-step` waterfall**：任何插件可返回必须与当前批次一起落地的消息或改写决策；`time-context` 用 `{ prepend: true }` 插入时间读数（`packages/context/time-context/src/index.ts:181-210`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/context/time-context/src/index.ts#L181-L210>
3. **`tools/post-execute` 的 `additionalContexts`**：工具级提醒沿同一条流水线回注，例如重复调用提醒（3.5）。

另外 `agent.inject()` 与工具 `additionalContexts` 走 **inbox**（落到后续某次 claim），而不是当前请求，因此不会砸当前前缀 —— 这一条有明确文档：

```text
Model-visible context uses logged message channels. `agent.inject()` and tool
`additionalContexts` enter the inbox for a later claim, while `agent/pre-step`
returns context that must settle with the current claimed batch. Each entered
value is a durable sourced `user/message`, paid once and prefix-cached
thereafter at the price of accumulating in history until compaction.
```

- 来源：`.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:51`；永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md#L51>

### 3.5 针对 coding 的行为规则（有代码证据的三条）

**（a）先读后写：由 `fs-observation-policy` 用事件门强制，不靠提示词**

`packages/fs/fs-observation-policy/src/index.ts:78-89`：

```ts
  editIntent(target: FsTarget, actor: object | undefined): { version: FsVersion } {
    const owner = this.owner(actor)
    const prior = owner ? this.get(owner, target.targetKey) : undefined
    if (!owner || prior === undefined) {
      throw new FsError(`edit requires reading "${target.displayPath}" first`, 'FS_NOT_OBSERVED')
    }
    if (prior.kind === 'absent') {
      throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    }
    return { version: prior.version }
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/fs/fs-observation-policy/src/index.ts#L78-L89>
- 模型侧看到的修复措辞：`cannot modify "<path>": file has not been read — read the file, then retry`（`packages/fs/tool-fs/src/error.ts:23-29`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/fs/tool-fs/src/error.ts#L23-L29>
- `write` 的语义相应变成「没观测过 ⇒ `createIfAbsent`；已观测存在 ⇒ 按观测版本 `replaceIfVersion`」，即 CAS 防覆盖：`packages/fs/fs-observation-policy/src/index.ts:60-72`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/fs/fs-observation-policy/src/index.ts#L60-L72>

**（b）失败/重复重试的拦截：`repeat-tool-reminder`**

阈值默认 `[3, 5, 8]`，第一次温和提醒、之后详细提醒（工具名 + 连续次数 + 参数规范化 JSON 预览，预览上限 500 字符以免提醒本身拖垮上下文）；**只观察不否决**（delegate 后再附加），且参数做深 key-sort 规范化后再比对，避免属性顺序差异漏判。

`packages/guard/repeat-tool-reminder/src/index.ts:62-67` 与 `:31-39`：

```ts
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'
```

```ts
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/guard/repeat-tool-reminder/src/index.ts#L62-L67>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/guard/repeat-tool-reminder/src/index.ts#L31-L39>
- 计数放在 `post-execute` 而非 `pre-execute`，理由写在代码里：被 deny 的调用也走同一条流水线，「模型死磕一个被拒绝的调用」正是最该打断的循环（`:184-203`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/guard/repeat-tool-reminder/src/index.ts#L184-L203>
- shipped 阈值：`packages/bundle/base/cordis.patch.yml:441-444`（`thresholds: [3, 5, 8]`, `argumentsPreviewChars: 500`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/base/cordis.patch.yml#L441-L444>

**（c）并行工具调用**：有专门的调度器（exclusive barrier + bounded parallel pool），默认并行度常量在 `packages/core/agent-loop/src/constants.ts`（`DEFAULT_MAX_PARALLEL_TOOL_CALLS`），调度实现在 `packages/core/agent-loop/src/tool-calls.ts`。永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/agent-loop/src/tool-calls.ts（文件级，行号随重构变动，未逐行引用）

**（d）bash 结果必读 exit code** —— 通过 prompt section 而非每个工具 schema 重复：

`packages/shell/tool-bash/src/index.ts:234-240`：

```ts
  // Cross-call guidance belongs in the prompt rather than one-call schema prose.
  ctx.systemPrompt.section({
    name: 'tool:bash',
    order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
    text: 'Check the [exit code: N] marker on every bash result; investigate failures before moving on.',
  })
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L234-L240>

**（e）skills 的注入**：`skill-filesystem` 做本地根发现、`tool-skill` 提供目录与加载（`skill` 工具 + `agent.inject()` 替换目录）。shipped 组合见 `packages/preset/agent-presets/presets/standard/agent.cordis.yml:77-88`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/standard/agent.cordis.yml#L77-L88>

---

## 4. bash / 终端优化

### 4.1 `shell` / `terminal` / `subprocess` 三者分工

- **`packages/subprocess`**：进程执行底座（stdio 模式、有界输出、spill、托管进程树终止）。`packages/subprocess/subprocess/src/types.ts:3-7`：`Node-shaped per-stream stdio modes, bounded collected output with spill recovery, raw piped streams, and managed-range termination. Command defaulting, shell semantics, protocol framing, and presentation belong to consumers such as the bash executor seam.` https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess/src/types.ts#L3-L7>
- **`packages/shell`**：`ctx.shell` 能力缝 + 一次性命令执行器（`bash-local` / `pwsh-local` / `*-sandbox`）与模型可见工具（`tool-bash` / `tool-pwsh`）。`shell` 只定义 `ShellExecutor` 抽象与 `ShellRunResult`，不实现进程。
- **`packages/terminal`**：owner 隔离的**持久 PTY 注册表**（`ctx.terminals`），后端可替换；模型可见工具为 `tool-bash-persistent` / `tool-pwsh-persistent` / `tool-terminal`。`packages/terminal/terminal/src/index.ts:1-5`：`Owner-scoped persistent PTY registry. Backends own terminal mechanics while this service owns ids, publication, authorization, and awaited cleanup.` https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/terminal/terminal/src/index.ts#L1-L5>

**是否持久 shell**：两种都有，由 preset 选择。默认 shipped preset（standard / ptc / cordis）用**非持久** `tool-bash`（每次 `bash -c` 新进程），`minimal` 用**持久 PTY** 版。

`packages/preset/agent-presets/presets/minimal/agent.cordis.yml:23-40`：

```yaml
- id: persistent-shell
  name: cordis:group
  group: true
  isolate:
    terminals: true
  config:
    - id: pty
      name: '@deepseek-ai/dsh-terminal'

    - id: terminal-bash
      name: '@deepseek-ai/dsh-terminal-bash'
      disabled: !!js process.platform === 'win32'
      config:
        timeoutMs: 300000

    - id: persistent-bash
      name: '@deepseek-ai/dsh-tool-bash-persistent'
      disabled: !!js process.platform === 'win32'
      config:
        timeoutMs: 300000
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/preset/agent-presets/presets/minimal/agent.cordis.yml#L23-L40>

### 4.2 非持久 `bash` 工具：语义与边界

工具描述本身就是最好的规格（`packages/shell/tool-bash/src/index.ts:69-90`，节选）：

```ts
  const base = 'Execute a bash command (`bash -c`) and return its stdout/stderr. '
    + 'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L69-L90>
- **超时**：executor 默认 120 s，上限 600 s，可用 `timeoutMs` 覆盖（`packages/shell/bash-local/src/index.ts:105-112`）：
  ```ts
  static Config: z<Config> = z.object({
    cwd: z.string(),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
  })
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/bash-local/src/index.ts#L105-L112>
- **后台任务**：`run_in_background: true` 立即返回 job id，用 `job_output` / `job_kill` 收集与终止；注册到通用 `ctx.jobs`（`packages/shell/tool-bash/src/index.ts:348-374`）。后台运行**不受超时约束**（`packages/shell/bash-local/src/index.ts:285`：`Background runs ignore timeoutMs; callers stop them through kill() or spec.signal.`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/bash-local/src/index.ts#L285>
- **环境变量**：每次调用重建 `DSH_*` 命名空间，环境里原有的 `DSH_*` 先被丢弃再注入受管快照；内置 `DSH_HOME` / `DSH_SHELL` / `DSH_SESSION_ID` 保留键。`packages/shell/shell-env/src/index.ts:70-76`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/shell-env/src/index.ts#L70-L76>

### 4.3 持久 PTY `bash`：命令包裹、标记、解析

`packages/shell/tool-bash-persistent/src/index.ts` 的实现要点：

- 默认超时 300 s，默认返回上限 16 000 字符（`:445-451`）：
  ```ts
  export const Config: z<Config> = z.object({
    backendType: z.string().default('shell'),
    timeoutMs: z.number().default(300_000),
    maxOutputChars: z.number().default(16_000),
    description: z.string().default(DEFAULT_DESCRIPTION),
  })
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L445-L451>
- **命令用随机 nonce 标记包裹**，靠 `printf` 输出起始标记、`eval -- ` 执行、再打印结束标记 + `$?`（`:63-77`）：
  ```ts
  function wrapCommand(command: string, marker: CommandMarkers): string {
    // Keep the wrapper on one physical line. An interactive bash prints PS2 for
    // embedded newlines before executing the buffer, which would leak terminal
    // prompts and marker source text into the model-facing result.
    return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`
  }
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L63-L77>
- **同一 owner 的调用被串行化**（`serialized()` 用 per-agent promise 链），避免并发写同一个 PTY（`packages/shell/tool-bash-persistent/src/index.ts:392-400`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L392-L400>
- **shell 退出 / 超时 / stdin 读 三种异常都各自返回可读输出并重置 shell**（`respondToSessionExit`、超时分支、`waitReason === 'stdin_read'` 分支，`:225-250`、`:330-390`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L330-L390>
- 截断文案是 Claude Code 风格的一长句（`:15`）：
  ```ts
  const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'
  ```
  永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L15>
- **scrollback 全量聚合**：只有命令结算或需要部分输出时才从最新一页往回翻，逐页拼装（`retainedScrollback()`，`:142-162`；页大小 `SCROLLBACK_PAGE_LINES = 1_000`，`:24`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash-persistent/src/index.ts#L142-L162>
- PTY 后端（`terminal-bash`）会做 **CSI/OSC/短转义序列清洗**，并识别受控提示符 `133;D;` + `dsh> `，避免把终端控制码喂给模型：`packages/terminal/terminal-bash/src/sanitize.ts:5-9`、`:24-38`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/terminal/terminal-bash/src/sanitize.ts#L5-L9>
- PTY 有界保留：`scrollbackLines` / `scrollbackMaxBytes` / `maxReadBytes` / `disposeGraceMs`（`packages/terminal/terminal-bash/src/config.ts:22-44`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/terminal/terminal-bash/src/config.ts#L22-L44>

### 4.4 输出截断的算法（两层，都在 `subprocess` 侧）

**第一层：保留尾部（tail）**

`packages/subprocess/subprocess-local/src/output.ts:47-55`：

```ts
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

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess-local/src/output.ts#L47-L55>
- 关键实现细节：`push()` 按 **byte-exact** 裁掉窗口头部（不足一块时 `subarray` 切，而不是丢整块），保证「诊断尾巴」正好是最后 N 字节（`:84-107`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess-local/src/output.ts#L84-L107>

**第二层：溢出即写盘，写盘有独立上限，超上限就丢弃整个 spill 文件**

`packages/subprocess/subprocess-local/src/output.ts:109-124`：

```ts
  /** Open the spill file lazily and append `chunk` (and any prior chunks once). */
  private spillAll(chunk: Buffer): void {
    if (this.maxSpillBytes !== undefined && this.total > this.maxSpillBytes) {
      this.discardSpill()
      return
    }
    if (this.spillFd === undefined) {
      // Random suffix + O_EXCL + no-follow-equivalent ('wx' fails on any
      // existing path, symlink or not) + owner-only mode: defeats spill-path
      // prediction and symlink planting in shared tmp dirs.
      this.spillFile = join(
        this.spillDir,
        `dsh-subprocess-${process.pid}-${++spillCounter}-${randomBytes(6).toString('hex')}-${this.label}.log`,
      )
      this.spillFd = openSync(this.spillFile, 'wx', 0o600)
      for (const prior of this.chunks) writeSync(this.spillFd, prior)
    }
    writeSync(this.spillFd, chunk)
  }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess-local/src/output.ts#L109-L124>
- 写盘目录是每进程私有的 `mkdtempSync(join(tmpdir(), 'dsh-subprocess-'))`（0700），进程退出时若目录为空则删除（`:19-31`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess-local/src/output.ts#L19-L31>
- 默认 spill 上限 64 MiB（`packages/shell/bash-local/src/index.ts:37-38`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/bash-local/src/index.ts#L37-L38>

**回读方式（模型侧）**：被截断的流在文本末尾追加 `[output truncated; full output: <path>]`，模型用 `read`（带 offset/limit）或 `grep` 读该路径：

`packages/shell/tool-bash/src/render.ts:11-15`：

```ts
/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/render.ts#L11-L15>
- 后台读取（`job_output`）也有对应通知：`[some output was dropped from memory; full output: <paths>]`（`packages/shell/tool-bash/src/render.ts:75-90`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/render.ts#L75-L90>

### 4.5 危险命令拦截与沙箱

**没有「正则匹配危险命令」的黑名单**；拦截机制是**文件效果沙箱 + 审批策略**两个独立旋钮，组合成 preset：

`packages/bundle/base/cordis.patch.yml:236-248`（节选）：

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

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/bundle/base/cordis.patch.yml#L236-L248>
- 默认值是 fail-safe 的 `read-only`（`packages/sandbox/sandbox-policy/src/index.ts:108-115`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-policy/src/index.ts#L108-L115>

**执行侧**（`bash-sandbox`）：`danger-full-access` 直接透传；其它模式把命令包进平台沙箱运行器，然后从退出码 + stderr **签名匹配**判定 `denied`，并把「runner 自身失败」优先于「被拒绝」区分开：

`packages/shell/bash-sandbox/src/index.ts:89-123`（节选）：

```ts
  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') {
      const result = await super.run(spec)
      return { ...result, sandbox: { mode, denied: false } }
    }
    ...
    const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, facts.runnerFailureRules)
    if (runnerFailure !== undefined) {
      throw new SandboxUnavailableError(mode, runnerFailure.detail)
    }
    return { ...result, sandbox: { mode, denied: classifyDenial(result, facts.denialSignatures), enforcement: facts.enforcement } }
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/bash-sandbox/src/index.ts#L89-L123>

**平台方言**（同一个 policy 翻译成三种内核机制）：

`packages/sandbox/sandbox-local/src/profiles.ts:12-41`：

```ts
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  return args
}
...
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}
```

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-local/src/profiles.ts#L12-L41>
- macOS Seatbelt（`sandbox-exec` + SBPL）用同一份 `writableRoots(policy)`，注释明确要求与进程内 fs 围栏（`fs-sandbox`）**不能漂移**（`:44-63`）。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/sandbox/sandbox-local/src/profiles.ts#L44-L63>

**升级（escalation）**：被沙箱拒绝后，模型可以在**同一轮**用 `sandbox_permissions`（最窄的更宽模式）+ `justification`（一句话）重试同一条命令一次，走审批通道；被拒即终结该命令。工具描述把这条规则写得很细（`packages/shell/tool-bash/src/index.ts:81-91`），工具侧只提供组合守卫与审批输入，真正的 fail-closed 序列由共享的 `approveEscalation()`（来自 `@deepseek-ai/dsh-sandbox`）执行（`packages/shell/tool-bash/src/index.ts:212-232`）。

- 永久链接：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L81-L91>、https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/shell/tool-bash/src/index.ts#L212-L232>

**进程终止升级**：POSIX 先 `SIGTERM`，宽限后 `SIGKILL`；Windows 用 `taskkill` 直接终结进程树：`packages/subprocess/subprocess-local/src/spawn.ts:5`（`POSIX owners stage TERM before KILL; Windows owners terminate immediately.`）、`:346-362`。https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/subprocess/subprocess-local/src/spawn.ts#L346-L362>

---

## 5. 对「DeepSeek 专属」的四条最强证据（收束）

1. **`systemPromptUpdate: 'in-history'`** 是模型目录上的能力位，只有 `deepseek-flash` 默认声明；loop 与 adapter 双向配合，把系统提示变更变成「追加」而非「原地改写」，从而保住历史前缀缓存。见 2.2。
2. **压缩摘要调用重放上一次已路由请求的前缀**（system + tools + messages 逐字节一致），指令降到末尾 user message。见 2.3。
3. **DeepSeek 用量字段的语义差异被专门处理**：`prompt_tokens` 含缓存命中，harness 改成互斥计数；`prompt_cache_hit_tokens` 与 `prompt_tokens_details.cached_tokens` 两种拼写都兜住。见 2.1。
4. **适配器自带的 provider 侧扩展字段**（`dsh_session_log` / `dsh_plugin_packages`）**不进模型输入、不改模型可见前缀**——文档明确：`They remain outside messages, system prompts, and tool schemas, so they do not add model-input tokens or alter the model-visible prefix.` 见 `docs/deepseek-llm-api-wire-extensions.md:7`：https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/deepseek-llm-api-wire-extensions.md#L7>

---

## 6. 未证实 / 推测项

- **推测**：`deepseek-v4-pro` 为什么不声明 `in-history`，源码没有给理由（只给了「newer models require an explicit models declaration」这一类约束性描述）。可能是该端点尚未支持 mid-history system message；**无代码证据**。
- **推测**：`maxInlineBytes: 50000`（spill）与 `thresholdChars: 8192`（pruner）这两个数值的选取理由，源码只说是 "Low-friction defaults for coding-agent tool output"，没有测算依据。
- **推测**：仓库里大量 README 的 `#### KV Cache effect` 小节的**检查机制**（是否 CI 强制）未在本次取证中确认；观察到 `packages/*/README.md` 几乎每个包都有该小节，且 `.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md` 是相关流程说明，但未逐行核对其强制性。
- **未在源码中找到**：`prompt_cache` 相关的显式客户端开关或 TTL 控制；dsh 似乎完全依赖服务端自动前缀缓存，只有「不破坏前缀」这一条策略。
- **未在源码中找到**：除 `sandbox`/`approval` 之外的「危险命令黑名单」或正则拦截。所有拦截都以文件系统效果与审批为中心。
