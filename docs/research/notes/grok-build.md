# Grok Build (grok CLI/TUI) —— Grok 自家模型的工程优化证据笔记

- 仓库: https://github.com/xai-org/grok-build
- 本地: `F:/_oss-research/grok-build`
- HEAD: `4247f661689354b831191f11eeeac8424993fe3d`（2026-09-19，"Synced from monorepo"）
- 类型: Rust cargo workspace，Apache-2.0，全部 crate 位于 `crates/codegen/`
- 本文所有「证据」行号均基于上述 SHA。永久链接格式：`https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/<相对路径>#L<起>-L<止>`
- 无代码证据的结论标注「推测」。

---

## 0. 全局定位：哪些 crate 承载「针对自家 Grok 的优化」

| 层面 | crate | 关键文件 |
|---|---|---|
| 工具系统 | `xai-grok-tools`, `xai-grok-tools-api` | `registry/types.rs`, `types/tool_metadata.rs`, `implementations/grok_build/**` |
| agent 运行时 / 提示词 | `xai-grok-agent`, `xai-chat-state` | `templates/prompt.md`, `prompt/context.rs`, `actor/request_builder.rs` |
| 采样 / 线协议 | `xai-grok-sampler`, `xai-grok-sampling-types`, `xai-grok-models` | `conversation.rs`, `conversation/messages.rs`, `conversation/responses.rs`, `default_models.json` |
| shell / 终端 | `xai-grok-shell`, `xai-grok-shell-base`, `xai-grok-shell-terminal`, `xai-grok-shell-session-support` | `computer/local/*`, `session/acp_session_impl/*` |
| 沙箱 | `xai-grok-sandbox` | `lib.rs`, `profiles.rs`, `deny/*`, `child_net.rs` |

顶层 shell crate 只做编排，实际实现分散在上面这些 crate 中，通过 `pub use` 再导出：

```1:4:crates/codegen/xai-grok-shell/src/lib.rs
#![allow(
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_code,
    dead_code
)]
```

（`xai-grok-shell/src/lib.rs` 第 4 行之后是 `pub use xai_grok_shell_base::env;`、`pub use xai_grok_shell_terminal as terminal;` 等再导出，见 `crates/codegen/xai-grok-shell/src/lib.rs:16-58`。）

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/lib.rs#L1-L4

---

# 维度 1：Tools（工具系统）

## 1.1 工具清单与定义位置

### 1.1.1 唯一注册入口

所有内置工具在 `ToolRegistryBuilder::new()` 里一次性注册。注册键是 `Namespace:id`（例如 `GrokBuild:run_terminal_cmd`）。

```617:702:crates/codegen/xai-grok-tools/src/registry/types.rs
        b.register_with_params::<grok_build::BashTool, grok_build::bash::BashParams>();
        b.register_with_params::<grok_build::ReadFileTool, grok_build::read_file::ReadFileParams>();
        b.register_with_params::<
                grok_build::SearchReplaceTool,
                grok_build::search_replace::SearchReplaceParams,
            >();
        b.register_with_params::<grok_build::ListDirTool, grok_build::list_dir::ListDirParams>();
        b.register_with_params::<grok_build::GrepTool, grok_build::grep::GrepParams>();
        b.register::<grok_build::KillTaskTool>();
        b.register::<grok_build::KillTerminalCommandTool>();
        b.register::<grok_build::TodoWriteTool>();
        b.register::<grok_build::UpdateGoalTool>();
        b.register::<grok_build::WorkflowTool>();
        b.register::<grok_build::TaskOutputTool>();
        b.register::<grok_build::GetTerminalCommandOutputTool>();
        b.register::<grok_build::WaitTasksTool>();
        b.register_with_params::<grok_build::TaskTool, grok_build::task::TaskParams>();
        b.register::<grok_build::SendSubagentMessageTool>();
        b.register::<grok_build::SendFeedbackTool>();
        b.register::<grok_build::WebSearchTool>();
        b.register_with_params::<grok_build::WebFetchTool, grok_build::web_fetch::WebFetchParams>();
        b.register::<grok_build::LspTool>();
        b.register::<grok_build::ImageGenTool>();
        b.register::<grok_build::ImageEditTool>();
        b.register::<grok_build::ImageToVideoTool>();
        b.register::<grok_build::ReferenceToVideoTool>();
        b.register::<grok_build::EnterPlanModeTool>();
        b.register::<grok_build::ExitPlanModeTool>();
        b.register_with_params::<
                grok_build::AskUserQuestionTool,
                grok_build::ask_user_question::AskUserQuestionParams,
            >();
        b.register::<grok_build::MonitorTool>();
        b.register::<grok_build::SchedulerCreateTool>();
        b.register::<grok_build::SchedulerDeleteTool>();
        b.register::<grok_build::SchedulerListTool>();
        b.register::<codex::apply_patch::ApplyPatchTool>();
        b.register::<codex::list_dir::CodexListDirTool>();
        b.register::<codex::grep_files::CodexGrepFilesTool>();
        b.register::<codex::read_file::CodexReadFileTool>();
        b.register::<opencode::OpenCodeBashTool>();
        b.register::<opencode::OpenCodeReadTool>();
        b.register::<opencode::OpenCodeEditTool>();
        b.register::<opencode::OpenCodeWriteTool>();
        b.register::<opencode::OpenCodeGrepTool>();
        b.register::<opencode::OpenCodeGlobTool>();
        b.register::<opencode::OpenCodeTodoWriteTool>();
        b.register::<opencode::OpenCodeSkillTool>();
        b.register::<crate::implementations::memory::search_tool::MemorySearchImpl>();
        b.register::<crate::implementations::memory::get_tool::MemoryGetImpl>();
        b.register::<crate::implementations::search_tool::SearchTool>();
        b.register_with_params::<
                crate::implementations::use_tool::UseTool,
                crate::implementations::use_tool::UseToolParams,
            >();
        b.register_with_params::<
                grok_build_concise::ReadFileConciseTool,
                grok_build::read_file::ReadFileParams,
            >();
        b.register_with_params::<
                grok_build_concise::SearchReplaceConciseTool,
                grok_build::search_replace::SearchReplaceParams,
            >();
        b.register_with_params::<
                grok_build_concise::BashConciseTool,
                grok_build::bash::BashParams,
            >();
        b.register_with_params::<
                grok_build_hashline::HashlineReadTool,
                grok_build_hashline::config::HashlineSchemeParams,
            >();
        b.register_with_params::<
                grok_build_hashline::HashlineEditTool,
                grok_build_hashline::config::HashlineSchemeParams,
            >();
        b.register_with_params::<
                grok_build_hashline::HashlineGrepTool,
                grok_build_hashline::config::HashlineSchemeParams,
            >();
        b.register_reminder(crate::reminders::LspDiagnosticsReminder);
        b.register_reminder(crate::reminders::TaskCompletionReminder);
        b.register_reminder(SkillDiscoveryReminder);
        for pack in tool_packs().lock().iter() {
            pack(&mut b);
        }
        b
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/registry/types.rs#L617-L702

要点：

- **三套并存的工具命名空间**：`GrokBuild`（自有）、`Codex`（OpenAI codex 兼容：apply_patch / codex_read_file / codex_grep_files / codex_list_dir）、`OpenCode`（openCode 兼容 8 个工具），外加 `GrokBuildConcise`（紧凑输出变体）和 `GrokBuildHashline`（锚点哈希编辑变体）。这是「同一 agent 换模型/换配置就能切换工具契约」的设计，而不是按模型版本硬裁剪。
- **跨切面 reminder 只有 3 个**：`LspDiagnosticsReminder`、`TaskCompletionReminder`、`SkillDiscoveryReminder`（同上 698-700 行）。

### 1.1.2 注册时如何生成 name / schema / dispatch

```493:545:crates/codegen/xai-grok-tools/src/registry/types.rs
    pub fn register<T>(&mut self)
    where
        T: xai_tool_runtime::Tool
            + ToolMetadata
            + std::fmt::Debug
            + Default
            + Send
            + Sync
            + 'static,
        T::Args: serde::de::DeserializeOwned + schemars::JsonSchema + Into<ToolInput>,
        T::Output: serde::Serialize + serde::de::DeserializeOwned + Into<ToolOutput>,
    {
        self.register_with_params::<T, ()>();
    }
    /// Register a built-in tool with typed configuration params. `P` is the tool's configuration type (e.g. `BashParams`),
    /// stored as `Params<P>` in Resources. For tools with no config, use [`register`] which defaults `P = ()`. `pub` so
    /// out-of-tree tool packs registered via [`register_tool_pack`] can contribute tool registrations.
    pub fn register_with_params<T, P>(&mut self)
    ...
    {
        let tool = T::default();
        let name = format!(
            "{}:{}",
            tool.tool_namespace(),
            xai_tool_runtime::Tool::id(&tool).as_str()
        );
        let namespace = tool.tool_namespace().to_string();
        let id = xai_tool_runtime::Tool::id(&tool).as_str().to_string();
        let kind = tool.kind();
        let requires = tool.requires_expr();
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/registry/types.rs#L493-L545

工具定义（name/description/schema）由两个 trait 分工：`xai_tool_runtime::Tool`（类型化 Args/Output + `run()`）与 `xai-grok-tools` 自己的 `ToolMetadata`。**只有 3 个方法是必需的**：

```30:46:crates/codegen/xai-grok-tools/src/types/tool_metadata.rs
pub trait ToolMetadata: Send + Sync {
    /// High-level category (Read, Edit, Search, Execute, ...).
    /// Drives template rendering (`${{ tools.by_kind.search }}`) and the
    /// default `is_read_only()` derivation.
    fn kind(&self) -> ToolKind;

    /// Namespace grouping (GrokBuild, Cursor, OpenCode, ...).
    /// Used to build the fully-qualified tool ID at registration time
    /// (e.g., `"GrokBuild:grep"`).
    fn tool_namespace(&self) -> ToolNamespace;

    /// Raw MiniJinja description template with `${{ tools.by_kind.X }}` and
    /// `${{ params.tool.param }}` placeholders. Resolved at finalize time by
    /// the `TemplateRenderer`.
    fn description_template(&self) -> &str;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/types/tool_metadata.rs#L30-L46

finalize 后的运行时对象：

```401:419:crates/codegen/xai-grok-tools/src/registry/types.rs
pub struct FinalizedToolset {
    tools: parking_lot::RwLock<Vec<FinalizedTool>>,
    reminders: Vec<Box<dyn Reminder + Send + Sync>>,
    pub resources: SharedResources,
    resources_persistence: Arc<ResourcesPersistence>,
    scheduler_cancel: Option<tokio_util::sync::CancellationToken>,
    /// Shared local registry for in-process dispatch.
    /// Contains only config-enabled tools. Can be shared with ToolHarness.
    local_registry: xai_computer_hub_sdk::LocalRegistry,
    /// Lock-free access to the template renderer for tool name/param resolution.
    /// Cloned into `ToolCallContext::extensions` on each `call()` so tools
    /// can resolve names without acquiring the `resources` mutex.
    renderer: Arc<TemplateRenderer>,
    /// Tag name for system-reminder wrappers in tool result text.
    system_reminder_tag: &'static str,
    /// Per-user feature-flag bag stamped on every dispatch ctx by
    /// `prepare_dispatch`. `None` outside a workspace bind.
    workspace_viewer_ctx: Option<xai_tool_runtime::WorkspaceViewerContext>,
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/registry/types.rs#L401-L419

「工具 JSON schema」不是手写 JSON，而是由 Rust 类型经 `schemars` 生成并做名称重映射，例如 `BashTool::versioned_definition`：

```1458:1487:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
    fn versioned_definition(
        &self,
        contract_version: Option<&str>,
        client_name: &str,
        description_override: Option<&str>,
        renderer: &TemplateRenderer,
        param_map: &std::collections::HashMap<String, String>,
        input_schema: &serde_json::Value,
        effective_params: &serde_json::Value,
    ) -> ToolDefinition {
        let params: BashParams =
            serde_json::from_value(effective_params.clone()).unwrap_or_default();
        let description = Self::rendered_description(description_override, renderer, &params);
        // Only this tool's param_map renames schema property keys — do not fall back to kind-wide
        // renderer aliases (another Execute tool's override could advertise e.g. max_wait while
        // this schema still exposes timeout).
        let timeout_param_name = param_map
            .get("timeout")
            .map(String::as_str)
            .unwrap_or("timeout");
        let exported_schema =
            Self::exported_input_schema(input_schema, &params, timeout_param_name);
        let remapped_schema = if param_map.is_empty() {
            exported_schema
        } else {
            crate::util::remap::remap_schema_properties(&exported_schema, param_map)
        };
        let _ = contract_version;
        ToolDefinition::function(client_name, Some(&description), remapped_schema)
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1458-L1487

### 1.1.3 单个工具的定义分布位置（示例）

`name` / `kind` / `description` / `id` 都写在工具自己的 `mod.rs` 里，没有集中式清单：

- bash（`GrokBuild:run_terminal_cmd`）：`crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs:1441`（kind）、`:1443`（description_template）、`:1510`（id）。
- monitor（`GrokBuild:monitor`）：`.../grok_build/monitor/tool.rs:23-40`（含 40 行描述文本）、`:52-54`（id）。
- web_search：`.../grok_build/web_search/mod.rs:24-30`（kind/namespace）、`:33-35`（description）、`:45-55`（id + capabilities）。
- memory_search：`.../memory/search_tool.rs:12-33`（description 含"Use this proactively when..."清单）、`:40-42`（id）。
- enter_plan_mode：`.../grok_build/enter_plan_mode/mod.rs:45-51`（description）、`:70-72`（id）。

示例（monitor，一个 ChatGPT/Claude Code 均无对应物的工具）：

```29:40:crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/tool.rs
    fn description_template(&self) -> &str {
        r#"Start a background monitor that streams events from a long-running script. Each stdout line is an event${%- if system_reminders_enabled %} - you can keep working and notifications arrive in the chat${%- endif %}. Exit ends the watch.

**Output volume**: Every stdout line is a main-agent wake. Print only `DONE`/`FAILED`/`CANCELLED`. No progress or CHANGE lines. Use `grep --line-buffered` in pipes (plain `grep` buffers and delays events by minutes).

**Responsiveness**: Emit `FAILED` to notify immediately when any required item fails; never wait for unrelated work to finish. Include every tracked failure signal in this immediate failure condition.

Set `persistent: true` for session-length watches (PR monitoring, log tails) -- the monitor runs${%- if tools.by_kind.kill_task_action %} until you call ${{ tools.by_kind.kill_task_action }} or${%- endif %} until the session ends. Otherwise it stops at `timeout_ms` (default 10h)."#
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/tool.rs#L29-L40

## 1.2 与竞品差异：Grok 独有的工具

从 1.1.1 的注册表可以直接列出「不在 Claude Code / Codex 标准 7 件套里的」工具：

| 工具 | 证据 |
|---|---|
| `monitor`（把长脚本 stdout 逐行变成主 agent 唤醒事件，带限流） | `implementations/grok_build/monitor/tool.rs:29-40`、`monitor/rate_limiter.rs` |
| `scheduler_create` / `scheduler_delete` / `scheduler_list`（会话级定时任务，含 occurrence journal） | `implementations/grok_build/scheduler/{create,delete,list}.rs`、`scheduler/occurrence_journal.rs` |
| `workflow`（执行 Rhai 脚本工作流） | 注册于 `registry/types.rs:631`；`.rhai` 资源见 `crates/codegen/xai-grok-shell/src/session/workflow/registry.rs:18` |
| `memory_search` / `memory_get`（跨会话记忆检索） | `implementations/memory/search_tool.rs:12-33` |
| `image_gen` / `image_edit` / `image_to_video` / `reference_to_video` | `registry/types.rs:641-644` |
| `lsp`（语言服务器诊断） | `registry/types.rs:640`；`implementations/grok_build/lsp/mod.rs` |
| `enter_plan_mode` / `exit_plan_mode`（agent 主动进入只读计划模式） | `enter_plan_mode/mod.rs:1-27`（含"requires user approval"契约） |
| `send_subagent_message`（给运行中的子代理发消息） | `registry/types.rs:636`；`implementations/grok_build/send_subagent_message.rs` |
| `send_feedback`（用户反馈通道） | `registry/types.rs:637` |
| `search_tool` + `use_tool`（MCP 工具的 BM25 检索与调用） | `implementations/search_tool/mod.rs:1`、`implementations/use_tool/` |
| `apply_patch` / `codex_*` / OpenCode 全套（第三方 harness 兼容工具在同一 registry 里） | `registry/types.rs:655-666` |

其中 `search_tool` 是「MCP 工具太多时按 BM25 检索」的方案，并对 MCP 描述做 2048 字符截断：

```20:38:crates/codegen/xai-grok-tools/src/implementations/search_tool/mod.rs
/// Maximum length for MCP tool/server descriptions. Matches the common
/// `MAX_MCP_DESCRIPTION_LENGTH` constant. Descriptions exceeding this are truncated.
pub const MAX_MCP_DESCRIPTION_LENGTH: usize = 2048;

const TRUNCATION_SUFFIX: &str = "\u{2026} [truncated]";

/// Truncate a string to `MAX_MCP_DESCRIPTION_LENGTH` chars, appending a
/// suffix if truncated. Operates on char boundaries to avoid splitting
/// multi-byte characters.
pub fn truncate_description(s: &str) -> String {
    if s.len() <= MAX_MCP_DESCRIPTION_LENGTH || s.chars().count() <= MAX_MCP_DESCRIPTION_LENGTH {
        return s.to_owned();
    }
    let budget = MAX_MCP_DESCRIPTION_LENGTH - TRUNCATION_SUFFIX.len();
    let truncated: String = s.chars().take(budget).collect();
    format!("{truncated}{TRUNCATION_SUFFIX}")
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/search_tool/mod.rs#L20-L38

`monitor` 的限流常量（防止脚本刷屏把主 agent 唤醒打爆）：

```crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/types.rs
（见 `RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_MS`，被 `monitor/tool.rs:16` 导入）
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/types.rs

## 1.3 工具结果的 token 预算 / 截断 / 落盘策略

### 1.3.1 全局默认预算

```8:14:crates/codegen/xai-grok-tools/src/lib.rs
/// Default maximum output size (in bytes) for tool results sent to the model.
/// 40 KB ≈ 10 000 tokens
pub const DEFAULT_TOOL_OUTPUT_BYTES: usize = 40_000;

/// Default maximum output size (in characters) for bash/terminal tool results.
/// 20 000 chars ≈ 5 000 tokens. Matches the common `SHELL_CHAR_HARD_LIMIT`.
pub const DEFAULT_TOOL_OUTPUT_CHARS: usize = 20_000;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/lib.rs#L8-L14

（bash 的 `output_byte_limit` 默认走 `DEFAULT_TOOL_OUTPUT_CHARS`，见 `bash/mod.rs:1718-1720`；MCP 结果另有独立上限 `MCP_MAX_OUTPUT_BYTES`，见 `lib.rs:16-19`。）

### 1.3.2 bash 的「保头保尾 + 全量落盘」

**三段式**：模型看到头 + 尾，中间被替换为标记，完整输出写到磁盘并在结果里给出路径。

```343:350:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
fn annotations(bash: &BashOutput) -> String {
    let mut s = String::new();
    if bash.truncated {
        let shown = format_bytes(bash.output.len() as u64);
        let total = format_bytes(bash.total_bytes as u64);
        s.push_str(&format!(
            " [truncated: showing first/last {} of {} - full output at: {}]",
            shown, total, bash.output_file
        ));
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L343-L350

分割标记：

```243:244:crates/codegen/xai-grok-tools/src/util/truncate.rs
/// Separator between the retained head and tail of a truncated output.
pub(crate) const FRONT_BACK_TRUNCATION_MARKER: &str = "\n\n... (output truncated) ...\n\n";
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/util/truncate.rs#L243-L244

截断算法（按 **字符** 而非字节计，前后各留一半）：

```388:413:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
    /// Front-and-back truncation by char count (not bytes); `to_result` re-joins the halves.
    fn maybe_truncate(&mut self) {
        let s = String::from_utf8_lossy(&self.output_buffer);
        let char_count = s.chars().count();
        if char_count <= self.output_byte_limit {
            return;
        }
        let half = self.output_byte_limit / 2;

        if self.front_buffer.is_none() {
            let front_end = s
                .char_indices()
                .nth(half)
                .map(|(i, _)| i)
                .unwrap_or(s.len());
            self.front_buffer = Some(s.get(..front_end).unwrap_or("").as_bytes().to_vec());
        }

        let tail_start_char = char_count.saturating_sub(half);
        let tail_start_byte = s
            .char_indices()
            .nth(tail_start_char)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        self.output_buffer = s.get(tail_start_byte..).unwrap_or("").as_bytes().to_vec();
        self.truncated = true;
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L388-L413

### 1.3.3 落盘的上限与回收

```59:75:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
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

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L59-L75

```415:423:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
    async fn flush_and_truncate_output_file(&mut self) {
        if let Some(ref mut file) = self.file_handle {
            let _ = file.flush().await;
            if self.total_bytes as u64 > MAX_RETAINED_OUTPUT_FILE_BYTES {
                let _ = file.set_len(MAX_RETAINED_OUTPUT_FILE_BYTES).await;
                // Seek to new end so post-exit drain appends correctly.
                let _ = file.seek(std::io::SeekFrom::End(0)).await;
            }
        }
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L415-L423

读回时最多 1 MiB，且「读了多少 / 是否还有更多」会显式上报：

```9:30:crates/codegen/xai-grok-tools/src/computer/task_log.rs
/// Far more than any tool shows the model, so this bounds memory only. The
/// assertion pins the built-in budget; a runtime budget raised past this
/// would see the prefix instead of the whole log.
pub(crate) const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;
const _: () = assert!(MAX_SNAPSHOT_BYTES > crate::DEFAULT_TOOL_OUTPUT_BYTES);

/// Reads up to `max_bytes` from the start of `path`, and whether the file
/// continues past it. An unreadable file reads as empty and incomplete.
pub(crate) async fn read_prefix(path: &Path, max_bytes: usize) -> (String, bool) {
    match read_bounded(path, max_bytes).await {
        Ok((bytes, more)) => {
            let (text, cut) = decode(&bytes);
            (text, more || cut)
        }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/task_log.rs#L9-L30

### 1.3.4 子代理/后台任务完成提醒的内联预算

```42:44:crates/codegen/xai-grok-tools/src/reminders/task_completion.rs
/// Inline preview cap applied ONLY to bash completion reminders that ship
/// with a disk-pointer footer.
const MAX_INLINE_COMPLETION_BYTES: usize = 4_000;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/reminders/task_completion.rs#L42-L44

### 1.3.5 工具状态（非结果）的落盘

`ResourcesPersistence` 用「去抖 + 原子重命名」的后台写盘，避免每次工具调用都同步 I/O：

```13:30:crates/codegen/xai-grok-tools/src/persistence.rs
/// Background persistence for `Resources` state/params. Same pattern as `ToolStatePersistence` — debounced background writes with atomic
/// rename. Takes a `serde_json::Value` from `Resources::serialize()` and writes it to disk. On load, parses the JSON and feeds it to
/// `Resources::load_from()`. This replaces the old `ToolStatePersistence` pipeline for the new architecture.
pub struct ResourcesPersistence {
    /// `None` means this handle reads and writes nothing.
    state_path: Option<PathBuf>,
    /// Channel to send serialized state to the background writer
    tx: tokio::sync::mpsc::UnboundedSender<ResourcesPersistenceCommand>,
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/persistence.rs#L13-L30

## 1.4 是否按模型版本动态裁剪工具集

### 1.4.1 有「工具行为版本」机制，但它是配置驱动的，不是模型驱动的

```22:40:crates/codegen/xai-grok-tools/src/versions.rs
/// Lifecycle stage of a behavior preset or version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BehaviorLifecycle {
    /// Fully supported and recommended.
    Active,
    /// Still works but will be removed in a future release.
    Deprecated,
    /// Scheduled for removal — hosts should reject requests using this version.
    RemovalCandidate,
}

/// Per-tool version metadata. Each managed tool has one entry in `TOOL_VERSION_REGISTRY`.
#[derive(Debug)]
pub struct ToolVersionEntry {
    /// Fully-qualified tool ID (e.g. `"GrokBuild:run_terminal_cmd"`).
    pub fq_tool_id: &'static str,
    /// Supported versions and their individual lifecycle.
    pub versions: &'static [VersionLifecycle],
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/versions.rs#L22-L40

```78:95:crates/codegen/xai-grok-tools/src/versions.rs
pub const MANAGED_TOOLS: &[&str] = &[
    "GrokBuild:run_terminal_cmd",
    "GrokBuild:read_file",
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/versions.rs#L78-L95

（同文件开头注释：`"current"` 是移动别名，`"legacy-0.4.10"` 是重建的旧行为；preset 由客户端通过 `ToolServerConfig.behavior_preset` 传入。见 `versions.rs:1-12`。）

每个工具还各自维护 `versions/` 子目录保存旧契约实现：

```crates/codegen/xai-grok-tools/src/implementations/grok_build/read_file/versions/
legacy_0_4_10.rs
mod.rs
```
（同样结构存在于 `list_dir/versions/legacy_0_4_10.rs`。）

### 1.4.2 真正的「按模型」差异来自 api_backend / 模型清单，而不是工具裁剪

`crates/codegen/xai-grok-models/default_models.json` 里每个模型带这些字段（节选）：

```8:19:crates/codegen/xai-grok-models/default_models.json
      "id": "grok-4.6",
      "model": "grok-4.6",
      "model_family": "xai",
      "name": "Grok 4.6",
      "description": "SpaceXAI's latest frontier model",
      "context_window": 500000,
      "api_backend": "responses",
      "supports_backend_search": true,
      "system_prompt_label": "Grok 4.6",
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-models/default_models.json#L8-L19

仓库里内置两个模型条目：`grok-4.6`（`supports_backend_search: true`）与 `grok-4.5`（`supports_backend_search: false`，`reasoning_efforts` 少了 `xhigh`）。也就是说**按模型版本调整的是采样/压缩/标签参数，不是工具集**。

唯一一处「工具集按 API 后端裁剪」的证据（Anthropic Messages 后端不能看到 file-form 的 `use_tool` schema）：

```1412:1425:crates/codegen/xai-grok-tools/src/registry/types.rs
    /// Built-in definitions with `use_tool` advertised inline-only. The Anthropic Messages API rejects the file-form
    /// schema's root-level union, and Messages-backed models must not see the file forms at all.
    pub fn tool_definitions_builtins_only_inline_mcp(&self) -> Vec<ToolDefinition> {
        self.tools
            .read()
            .iter()
            .filter(|t| !t.client_name.contains("__"))
            .map(|t| {
                t.inline_mcp_definition
                    .clone()
                    .unwrap_or_else(|| t.definition.clone())
            })
            .collect()
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/registry/types.rs#L1412-L1425

`Messages` 后端还会强制打开 reasoning effort（说明有按后端/模型族的参数补全）：

```3979:3987:crates/codegen/xai-grok-shell/src/agent/config.rs
        if let Some(v) = self.supports_reasoning_effort {
            entry.info.supports_reasoning_effort = v;
        } else if !entry.info.supports_reasoning_effort
            && matches!(entry.info.api_backend, ApiBackend::Messages)
        {
            entry.info.supports_reasoning_effort = true;
        }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/agent/config.rs#L3979-L3987

**结论**：Grok Build 用「工具命名空间 + 行为版本 preset + 本地/远程配置」来切换工具契约，而不是用模型 slug 硬编码裁剪。同一份 registry 同时提供 `GrokBuild`/`GrokBuildConcise`/`GrokBuildHashline`/`Codex`/`OpenCode` 五套，供不同 harness/配置选用。

```317:330:crates/codegen/xai-grok-shell/src/tools/config.rs
pub enum FileToolset {
```

（`file_toolset` 解析优先级：本地 config.toml 非默认值 > 远程 `/v1/settings` 的 `file_toolset == "hashline"` > 默认 Standard，见 `crates/codegen/xai-grok-shell/src/tools/config.rs:253-262`。）

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/tools/config.rs#L253-L262

### 1.4.3 竞品工具名映射表（用于读 Claude Code 的设置文件）

```44:57:crates/codegen/xai-grok-tools/src/types/claude_alias.rs
#[rustfmt::skip]
const CLAUDE_TOOLS: &[ClaudeTool] = &[
    k("Read",            Read,                 &["read_file", "hashline_read"]),
    k("Write",           Write,                &["write", "search_replace", "hashline_edit"]), // search_replace kept for back-compat
    k("Edit",            Edit,                 &["search_replace", "hashline_edit"]),
    k("MultiEdit",       Edit,                 &["search_replace", "hashline_edit"]), // legacy, superseded by Edit
    k("NotebookEdit",    Edit,                 &["search_replace", "hashline_edit"]),
    k("Bash",            Execute,              &["run_terminal_command"]),
    k("PowerShell",      Execute,              &[]),
    k("Grep",            Search,               &["grep", "hashline_grep"]),
    k("Glob",            List,                 &["list_dir"]),
    k("LS",              List,                 &[]),                                  // legacy name for Glob
    k("LSP",             Lsp,                  &["lsp"]),
    k("WebSearch",       WebSearch,            &["web_search"]),
    k("WebFetch",        WebFetch,             &["web_fetch"]),
    k("DeployApp",       DeployApp,            &[]),
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/types/claude_alias.rs#L44-L57

## 1.5 并行工具调用处理

同一批 approved 工具调用被丢进 `FuturesUnordered` 并发执行，结果经 mpsc 按完成顺序回流：

```980:986:crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs
        let mut dispatch_stream = futures::stream::FuturesUnordered::new();
        for fut in dispatch_futures {
            dispatch_stream.push(fut);
        }
        let mut approved_slots: Vec<Option<PreparedToolCall>> =
            approved.into_iter().map(Some).collect();
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs#L980-L986

注意「完成顺序 ≠ 原始顺序」：回包时用 `approved_slots.get_mut(idx)` 按原始下标还原槽位，再 `take()`（`tool_calls.rs:987-1000`），保证结果与调用一一对应。

对模型的并行指令来自子代理模板：

```15:16:crates/codegen/xai-grok-agent/templates/subagent_prompt.md
<tool_calling>
- Parallelize independent tool calls in a single response.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/subagent_prompt.md#L15-L16

## 1.6 工具参数错误重试与「工具调用修复」

仓库里有四类彼此独立的机制：

### (a) 宽松反序列化 —— 专门针对「模型把数字写成字符串」

```226:236:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
    // Some models serialize numeric tool args as JSON strings (`"120000"`), which a plain `Option<u64>` rejects. Accept
    // string-or-number here; the schema still advertises an integer. Serde default stays None so omit ≠ Some(120000):
    // background omit must stay unbounded (see resolve_effective_timeout). Schema still advertises 120000.
    #[serde(
        default,
        deserialize_with = "crate::types::schema::deserialize_lenient_u64",
        skip_serializing_if = "Option::is_none"
    )]
    pub timeout: Option<u64>,
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L226-L236

同族反序列化器（字符串/布尔互转，注释里点名「models routinely send numeric-looking IDs as JSON numbers」）：

```159:176:crates/codegen/xai-grok-tools/src/types/schema.rs
/// Deserialize `Option<String>` from a JSON string, number, or boolean — scalar values are coerced to their string
/// form. Mirrors zod's `z.coerce.string()` used by the TypeScript grok-computer tools, where models routinely send
/// numeric-looking IDs (e.g. CDP request IDs such as `62576.34`) as JSON numbers.
pub fn deserialize_lenient_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(serde_json::Value::Number(n)) => Ok(Some(n.to_string())),
        Some(serde_json::Value::Bool(b)) => Ok(Some(b.to_string())),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected string, got {other}"
        ))),
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/types/schema.rs#L159-L176

### (b) 参数校验错误带「结构化修复提示」字段

校验失败不是一句报错，而是带 `field_path` / `expected` / `bad_value` / `category` 的对象，便于模型精准重试：

```49:90:crates/codegen/xai-grok-tools/src/types/params_validation.rs
pub fn validate_params_json<T>(json: &serde_json::Value) -> Result<(), ParamValidationError>
where
    T: DeserializeOwned + ResourceType,
{
    let typed: T = serde_path_to_error::deserialize(json.clone()).map_err(|err| {
        let path = normalize_serde_path(err.path().to_string());
        let message = err.inner().to_string();
        let mut out = ParamValidationError::new(message.clone(), classify_serde_error(&message));
        if let Some(path) = path.clone() {
            out = out.with_field_path(path.clone());
            if let Some(value) = value_at_path(json, &path) {
                out = out.with_bad_value(value.clone());
            }
        }
        if let Some(expected) = extract_expected(&message) {
            out = out.with_expected(expected);
        }
        out
    })?;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/types/params_validation.rs#L49-L90

分类函数把 serde 消息映射成稳定 category（`params_unknown_field` / `params_missing_field` / `params_unknown_variant` / `params_type` / `params_invalid`），见 `params_validation.rs:129-140`。

### (c) 会话历史完整性修复（dangling tool call / 重复 tool result）

启动时和每次变更后都会修，防止上一次崩溃留下的「有 tool_call 无 tool_result」历史导致 400：

```195:215:crates/codegen/xai-chat-state/src/actor/state.rs
    /// Create a `ChatState`, repairing dangling tool calls in the initial conversation.
    ...
        let deduped = dedup_duplicate_tool_results(&mut conversation);
        if deduped > 0 {
            ...
        }
        let repaired =
            repair_dangling_tool_calls(&mut conversation, DanglingToolCallReason::UserCancelled);
        if repaired > 0 {
            ...
                "Repaired dangling tool calls in initial conversation (likely from a previous crash)"
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/state.rs#L195-L215

```81:108:crates/codegen/xai-chat-state/src/actor/mutations.rs
    /// Repair dangling tool calls (assistant call IDs with no `ToolResult`) and persist.
    ...
    /// Do not call from read handlers — concurrent tool execution would look dangling.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/mutations.rs#L81-L108

另外还有专门的 `repair_history`：`Unlike integrity repair, this also removes orphaned ToolResults that brick sessions with 400s.`（`mutations.rs:149-152`）。

### (d) 通用重试退避 + ACP 层认证重试

```47:100:crates/codegen/xai-grok-tools/src/retry.rs
pub async fn execute_with_backoff<T, E, EFut, R, RFut>(
    config: &BackoffConfig,
    mut execute: E,
    mut on_retry: R,
) -> Result<T, E::Error>
...
    loop {
        attempt += 1;

        match execute.call().await {
            Ok(output) => {
                if attempt > 1 {
                    tracing::info!("Execution succeeded after {} attempts", attempt);
                }
                return Ok(output);
            }
            Err(err) => {
                let delay = config.calculate_delay(attempt);
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/retry.rs#L47-L100

工具调用路径上还有 `call_with_auth_retry(...)`（`crates/codegen/xai-grok-shell/src/session/acp_session_impl/tool_calls.rs:937-943`）。

---

# 维度 2：缓存机制

## 2.1 结论速览

Grok Build 的缓存优化不是「自己实现 prompt cache」，而是**围绕服务端 prefix cache / KV cache 做请求体形状约束**。四类具体手段：

1. 在 Anthropic Messages 线格式上显式打 `cache_control: ephemeral` 断点（system 尾部 + 上一轮末尾 + 本轮 tip）。
2. 用测试把「第 N 轮请求的 input 必须是第 N+1 轮 input 的字节前缀」写成不变量。
3. 所有会改动前缀的功能（memory 注入、图片剔除、日期滚动、子代理工具投影）都被显式设计成「追加而非插入」或「宁可不动」。
4. 有显式的缓存命中遥测字段（`cached_prompt_tokens` / `cache_creation_prompt_tokens` / `cache_read_rate`）。

## 2.2 显式 cache_control 断点

```3:75:crates/codegen/xai-grok-sampling-types/src/conversation/messages.rs
/// Marks the last block that can carry one, scanning back past `Thinking`, which the API rejects a breakpoint on.
fn mark_message_cache_breakpoint(msg: &mut crate::messages::Message) -> bool {
    use crate::messages::{CacheControl, ContentBlock, MessageContent};

    match &mut msg.content {
        MessageContent::Blocks(blocks) => {
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
                return true;
            }
            false
        }
        // Plain text cannot carry a breakpoint, so promote it to block form.
        MessageContent::Text(text) => {
            let text = std::mem::take(text);
            msg.content = MessageContent::Blocks(vec![ContentBlock::Text {
                text,
                cache_control: Some(CacheControl::ephemeral()),
            }]);
            true
        }
    }
}

/// An entry is written only at a breakpoint, so marking the system prompt alone leaves the transcript uncached.
/// The third covers a turn that appends more than the API's 20 block lookback.
/// The fourth slot stays free: a gateway that turns on automatic caching takes it, and five is rejected outright.
fn apply_cache_breakpoints(
    system_blocks: &mut [crate::messages::TextBlock],
    messages: &mut [crate::messages::Message],
) {
    use crate::messages::{CacheControl, MessageRole};

    if let Some(last) = system_blocks.last_mut() {
        last.cache_control = Some(CacheControl::ephemeral());
    }

    let tip = (0..messages.len()).rev().find(|&i| {
        messages
            .get_mut(i)
            .is_some_and(mark_message_cache_breakpoint)
    });

    // Where the previous request ended
    // A turn can append several user messages in a row, so skip the whole trailing run rather than a neighbour of the tip
    if let Some(tip) = tip
        && let Some(before_tip) = messages.get(..tip)
        && let Some(prev) = before_tip
            .iter()
            .rposition(|m| matches!(m.role, MessageRole::Assistant))
            .and_then(|assistant| {
                before_tip.get(..assistant).and_then(|before_asst| {
                    before_asst
                        .iter()
                        .rposition(|m| matches!(m.role, MessageRole::User))
                })
            })
        && let Some(msg) = messages.get_mut(prev)
    {
        mark_message_cache_breakpoint(msg);
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/conversation/messages.rs#L3-L75

这段注释直接说明了设计意图：「只在断点处写 entry，所以只标记 system prompt 会让整段 transcript 都不被缓存」、「第 4 个槽位留给网关自动缓存，第 5 个会被直接拒绝」。

## 2.3 前缀稳定性（前缀 cache 命中的核心）

### 2.3.1 把前缀稳定性写成测试不变量

```4704:4755:crates/codegen/xai-chat-state/src/actor/tests.rs
// KV-cache prefix stability through `build_conversation_request` (prune, memory, images, restore).
// Prefix stability within a compaction epoch is what keeps the inference prefix cache hitting.
// Targets the sibling-Reasoning shape: no placeholder/splice machinery.

/// Serialize a ConversationRequest via the public `From` impl only.
/// After the sibling-Reasoning refactor the From output is the wire shape; type-stamping does not reorder items.
fn serialize_via_public_api(
    req: &xai_grok_sampling_types::ConversationRequest,
) -> serde_json::Value {
...
/// Assert that request N's serialized input is a byte-stable prefix of
/// request N+1's.
fn assert_prefix_stable_pair(
    base: &xai_grok_sampling_types::ConversationRequest,
    extended: &xai_grok_sampling_types::ConversationRequest,
    label: &str,
) {
    let base_body = serialize_via_public_api(base);
    let ext_body = serialize_via_public_api(extended);

    let base_input = base_body.get("input").and_then(|v| v.as_array()).unwrap();
    let ext_input = ext_body.get("input").and_then(|v| v.as_array()).unwrap();
...
    assert_eq!(
        ext_input.get(..base_input.len()).unwrap_or(&[]),
        base_input.as_slice(),
        "{label}: prefix broken. Base has {} items, extended has {}. \
         First divergence at index {}",
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/tests.rs#L4704-L4755

同一处还用参数化测试覆盖了「前缀稳定」在各种功能开启后仍成立：

- `prefix_stable_across_user_assistant_turns`（`:4783`）
- `prefix_stable_with_consistent_memory_injection`（`:4825`）
- `prefix_stable_with_reasoning_siblings_through_build_request`（`:4868`）
- `prefix_stable_after_tool_schema_change`（`:4919`，「Changing the tool set between requests must not affect the input prefix」）
- `prefix_stable_after_model_switch`（`:4969`）
- `prefix_stable_with_synthetic_user_messages`（`:5005`）
- `turn_capture_survives_integrity_repair_prefix_shrink`（`:3027`）
- `strict_switch_append_preserves_prefix_and_deduplicates_generation`（`:213`）

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/tests.rs#L4783-L5010

### 2.3.2 线格式层的顺序不变量（含历史 bug 记录）

```3:5:crates/codegen/xai-grok-sampling-types/src/conversation/responses.rs
/// Flatten `response.output` into `ConversationItem`s, preserving emission order.
/// Replaying that order byte for byte on the next turn is what keeps the server-side prefix cache hot.
pub fn response_to_conversation_items(response: rs::Response) -> Vec<ConversationItem> {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/conversation/responses.rs#L3-L5

```4388:4390:crates/codegen/xai-grok-sampling-types/src/conversation.rs
    // `tco_*` reasoning items from parallel backend tool calls round-trip losslessly as N sibling `Reasoning` items. (A prior data-loss bug: `AssistantItem.reasoning` was last-write-wins.); Multi-turn conversations preserve emission order `[Sys, U1, R, BTC*, A1, U2, R, BTC*, A2, ...]` rather than `[Sys, U1, ..., UN, R*, A*]`. (A prior ordering bug defeated the server-side prefix cache.); `conversation_to_chat_messages` folds preceding Reasoning siblings into the next assistant's `reasoning_content`. This is the chat-completions wire path; `patch_reasoning_text_types` injects the `type: "reasoning_text"` discriminator on nested `content[]` items. async-openai's derived Serialize omits it.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/conversation.rs#L4388-L4390

（这句明确写下：曾经因为顺序 bug 导致服务端 prefix cache 失效。）

```4805:4832:crates/codegen/xai-grok-sampling-types/src/conversation.rs
    /// INVARIANT: prefix stability across turns without reasoning.
    /// Context and instructions must be prefixed once and consistently across requests.
    #[test]
    fn prefix_stable_across_turns_no_reasoning() {
...
    /// Prefix stability when turns carry Reasoning siblings with encrypted_content.
    /// Encrypted reasoning is the cache-sensitive payload.
    /// Its serialized position must be byte-identical across turns or the server-side prefix cache misses.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/conversation.rs#L4805-L4832

### 2.3.3 请求体拼装顺序（`build_conversation_request`）

```22:30:crates/codegen/xai-chat-state/src/actor/request_builder.rs
/// Build a `ConversationRequest` from current actor state (image eviction, prune, memory reminder).
/// The command handler already ran integrity repair on the actor conversation before this clone.
/// Do not re-run dangling/dedup repair on the clone — those would be O(n) no-ops.
pub(super) fn build_conversation_request(
```

固定顺序：`image_budget → prune → memory reminder 注入 → ModelRequestHistory 归一 → 组装`，见 `request_builder.rs:32-95`。

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L22-L95

memory reminder 的注入策略是「能就地改就改，避免新增 item 破坏前缀」：

```190:215:crates/codegen/xai-chat-state/src/actor/request_builder.rs
    let updated: String = if let Some(prefix_len) = existing_start {
        let prefix = system_prompt
            .get(..prefix_len)
```

（同文件 `inject_memory_reminder`，见 `request_builder.rs:186-230`。）

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L190-L215

### 2.3.4 为保缓存而做的具体妥协（最直观的「优化意图」证据）

**(a) 日期滚动不改 `<user_info>`，改用 system-reminder 追加：**

```505:507:crates/codegen/xai-grok-shell/src/session/acp_session_impl/reminders.rs
    /// Injects a one-shot date-rollover `<system-reminder>` when a long session crosses local midnight.
    /// The cached `<user_info>` prefix keeps its startup date to preserve the prompt cache.
    pub(super) async fn maybe_inject_date_rollover_reminder(&self) {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session_impl/reminders.rs#L505-L507

**(b) memory 块重评分会击穿 KV cache，所以禁止：**

```15:crates/codegen/xai-grok-shell/src/session/helpers/memory_context.rs
/// A re-scored block would mutate the system-prompt prefix and bust the KV cache for the whole downstream conversation.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/helpers/memory_context.rs#L15

同样表述出现在测试里：`/// A re-scored block would bust the prompt-prefix KV cache.`（`crates/codegen/xai-grok-shell/src/session/acp_session_tests/memory_config_tests.rs:1208`）。

**(c) 图片剔除采用「迟滞」策略，避免每轮都重写前缀：**

```18:31:crates/codegen/xai-chat-state/src/image_budget.rs
/// Evict old images once the serialized body reaches this size (3 MB below the hard ceiling).
/// Headroom covers uncounted tool definitions and the request envelope.
/// Below the trigger every image stays so the KV-cache prefix remains byte-stable.
pub const IMAGE_COMPACT_TRIGGER_BYTES: usize = MAX_REQUEST_BYTES - 3 * 1024 * 1024;

/// Low-water mark that eviction reclaims down to once it fires (hysteresis).
/// Clearing only the trigger would re-cross and re-bust the KV cache every turn.
/// Dropping to half the hard limit rewrites the prefix once, then stays cache-warm.
pub const IMAGE_COMPACT_RECLAIM_TARGET_BYTES: usize = MAX_REQUEST_BYTES / 2;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/image_budget.rs#L18-L31

**(d) 子代理的工具投影必须和父会话字节一致，否则打散 radix cache：**

```823:826:crates/codegen/xai-grok-shell/src/session/acp_session.rs
    /// That keeps the child's request prefix byte-identical to the parent for radix cache reuse.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session.rs#L823-L826

配套测试注释：`// Ordinary tools pass through unchanged, so the child's specs serialize to the parent's exact bytes and the radix cache stays aligned`（`crates/codegen/xai-grok-shell/src/session/acp_session_impl/child_tool_projection_tests.rs:83`）。

**(e) 子代理 fork 时强制继承父模型，因为 radix 前缀按模型划分：**

`crates/codegen/xai-grok-shell/src/session/acp_session_impl/goal_support.rs:1443-1450`、`crates/codegen/xai-grok-shell/src/agent/subagent/tests/rest.rs:2505`。

**(f) 计划器/镜像子代理不能插入前缀（插入会把继承的前缀挤出父会话缓存流）：**

`crates/codegen/xai-grok-shell/src/session/acp_session_tests/project_instructions_idempotence_tests.rs:216`。

## 2.4 显式 `prompt_cache_key`（只在 Responses 后端有效）

```662:crates/codegen/xai-grok-sampling-types/src/conversation.rs
    pub prompt_cache_key: Option<String>,
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/conversation.rs#L662

```1045:1050:crates/codegen/xai-grok-sampling-types/src/types.rs
    /// Whether [`ConversationRequest::prompt_cache_key`] reaches the wire. Only the Responses mapping sends it, so a key set elsewhere is inert.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sampling-types/src/types.rs#L1045-L1050

**最重要的用法**：辅助调用（recap / turn summary）刻意复用父回合的 cache key，从而搭父回合的 prefix cache 便车：

```102:131:crates/codegen/xai-grok-shell/src/session/acp_session_impl/side_call.rs
    /// Request skeleton for an auxiliary call that replays the parent conversation under the parent's `prompt_cache_key`.
    /// Temperature stays unset: cli-chat-proxy may inject a `thinking` config, and the Messages API then requires temperature == 1.
    pub(crate) fn parent_cached_request(&self, call: AuxCall) -> ConversationRequest {
        let session_id = self.session_info.id.to_string();
        // Only the Responses mapping sends the cache key
        // On the other backends the conv id is what ties a call to its conversation, so it has to stay the parent session id
        // The `btw-`/`recap-` label still shows up in `x_grok_req_id`
        let conv_id = if call.backend.forwards_prompt_cache_key() {
            call.conv_id
        } else {
            session_id.clone()
        };
        ConversationRequest {
            ...
            model: Some(call.model),
            temperature: None,
            // Effort changes the prompt ahead of the conversation history, so dropping it here would share no prefix with the main turn.
            reasoning_effort: call.reasoning_effort,
            x_grok_conv_id: Some(conv_id),
            ...
            prompt_cache_key: Some(session_id),
            // Side calls persist text and never execute tools (the attached tools only align the prompt-cache prefix)
            // A Length sample must fail rather than salvage
            length_policy: xai_grok_sampling_types::LengthPolicy::Fail,
            ..Default::default()
        }
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session_impl/side_call.rs#L102-L131

配套测试注释：`/// The recap sends the main turn's tools and the session id as prompt_cache_key, so it rides the parent turn's prefix cache.`（`crates/codegen/xai-grok-shell/src/session/acp_session_tests/recap_display_only_tests.rs:900`）。

## 2.5 与上下文压缩的关系

- 前缀稳定性只在「一个压缩 epoch 内」成立，压缩本身就是断点：`tests.rs:4705`（"Prefix stability within a compaction epoch is what keeps the inference prefix cache hitting"）。
- 压缩模式 `transcript`/`segments` 的自包含渲染在 `xai-compaction-transcript`（`crates/codegen/xai-compaction-transcript/src/lib.rs:1-8`），产物是 markdown 段落而非会话历史，因此不参与前缀缓存。
- 两段式压缩（two-pass）会用 `fingerprint_prefix(prefix)` 校验缓存的 NOTE₁ 是否还有效，prefix 变了就回退单段式压缩：

```348:360:crates/codegen/xai-grok-shell/src/session/compaction.rs
                "two_pass: cached NOTE1 stale or model changed; falling back to single-pass"
            );
        }
        if cache.prefix_len == 0
            || cache.model_slug != model_slug
            || fingerprint_prefix(prefix) != cache.fingerprint
        {
            tracing::info!(
                prefix_len = cache.prefix_len,
                "two_pass: cached NOTE1 stale or model changed; falling back to single-pass"
            );
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/compaction.rs#L348-L360

- recap 的取舍写成注释：「超预算就剥掉 reasoning（一裁剪前缀缓存就没了）」、「未剥离的估算才是安全上界；逐字路径能保持 grok 前缀缓存热」：`crates/codegen/xai-grok-shell/src/session/helpers/session_recap.rs:83,113,714,731`。

## 2.6 缓存命中率遥测字段（有）

辅助调用显式上报缓存读写率：

```31:58:crates/codegen/xai-grok-shell/src/session/acp_session_impl/side_call.rs
        Self {
            prompt_tokens,
            cached_prompt_tokens: usage.cached_prompt_tokens,
            cache_creation_prompt_tokens: usage.cache_creation_prompt_tokens,
            uncached_prompt_tokens,
            cache_read_rate: rate(usage.cached_prompt_tokens),
            cache_write_rate: rate(usage.cache_creation_prompt_tokens),
        }
    }
}

/// Logs the provider-reported prompt cache buckets for one auxiliary call.
pub(crate) fn log_prompt_cache_usage(
    call: &str,
    backend: crate::sampling::ApiBackend,
    response: &xai_grok_sampling_types::ConversationResponse,
) {
    let Some(usage) = response.usage.as_ref() else {
        return;
    };
    let usage = PromptCacheUsage::from(usage);
    tracing::info!(
        call,
        backend = ?backend,
        prompt_tokens = usage.prompt_tokens,
        cached_prompt_tokens = usage.cached_prompt_tokens,
        cache_creation_prompt_tokens = usage.cache_creation_prompt_tokens,
        uncached_prompt_tokens = usage.uncached_prompt_tokens,
        cache_read_rate = usage.cache_read_rate,
        cache_write_rate = usage.cache_write_rate,
        cache_key_forwarded = backend.forwards_prompt_cache_key(),
        "auxiliary call prompt cache usage"
    );
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session_impl/side_call.rs#L31-L58

其他遥测位点：

- `crates/codegen/xai-grok-telemetry/src/events/tool.rs:51`：`pub cached_prompt_tokens: Option<u32>,`
- `crates/codegen/xai-grok-telemetry/src/external/schema.rs:720`：`.attr_opt(ExternalKey::CacheReadTokens, ev.cached_prompt_tokens)`
- `crates/codegen/xai-chat-state/src/usage.rs:55`：`cached_read_tokens: u64::from(usage.cached_prompt_tokens),`
- 采样器解析上游 usage：`crates/codegen/xai-grok-sampler/src/stream/responses.rs:622`（`cached_prompt_tokens: u.input_tokens_details.cached_tokens,`）

## 2.7 关于「时间戳/随机数位置」的检查结果

- `PromptContext.build_timestamp_utc` 存在（`crates/codegen/xai-grok-agent/src/prompt/context.rs:104`），但**没有**出现在渲染占位符里：

```226:233:crates/codegen/xai-grok-agent/src/prompt/context.rs
        serde_json::json!({
            "memory_enabled": self.memory_enabled,
            "memory_v2_enabled": self.memory_v2_enabled,
            "memory_global_path": self.memory_global_path.as_deref().unwrap_or(""),
            "memory_workspace_path": self.memory_workspace_path.as_deref().unwrap_or(""),
            "role_instructions": self.role_instructions.as_deref().unwrap_or(""),
            "persona_instructions": self.persona_instructions.as_deref().unwrap_or(""),
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/context.rs#L226-L233

  → 时间戳只用于持久化/诊断，不进 system prompt，因此不会破坏前缀稳定性（这是正向设计，不是巧合）。

- **日期是唯一进入前缀的时间量**，且被设计成「会话启动时固定、跨天只追加 reminder」（见 2.3.4(a)）。`crates/codegen/xai-grok-shell/src/session/user_message.rs:54-56`：

```54:56:crates/codegen/xai-grok-shell/src/session/user_message.rs
/// Date label in the `<user_info>` prefix; `spawn::resumed_prefix_carries_fallback_date` scans for it.
pub(crate) const USER_INFO_DATE_MARKER: &str = "Today's date:";
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/user_message.rs#L54-L56

- 工具排序：工具定义按注册顺序（`HashMap` 插入序不保证）→ 但**工具变化不影响前缀稳定性**，因为有 `prefix_stable_after_tool_schema_change` 测试（`tests.rs:4919`）。推测实现方式是把 tools 放在请求体里与 input 分离的位置（Responses API 的 `tools` 字段与 `input` 字段平行），所以工具集变化不移动 `input` 前缀。

---

# 维度 3：注入提示词优化（coding 场景）

## 3.1 system prompt / 指令文本存放位置

三份 MiniJinja 模板，全部在 `crates/codegen/xai-grok-agent/templates/`：

| 文件 | 行数 | 用途 |
|---|---|---|
| `prompt.md` | 100 | 主 agent system prompt |
| `subagent_prompt.md` | 90 | 子代理 system prompt |
| `apply_patch_prompt.md` | 283 | Codex 风格 apply_patch harness 的 system prompt |

模板以 **XOR 混淆**形式编译进二进制（防止 `strings` 直接捞明文），运行时解密并 `Zeroizing`：

```1:8:crates/codegen/xai-grok-agent/src/prompt/template.rs
//! Templates are XOR-obfuscated by `scripts/encrypt_templates.py` so they don't appear as obvious plaintext in `strings` output.
//! This is obfuscation, not security; the seeds live in-repo.
//! They are decrypted on demand and the returned `Zeroizing<String>` wipes the plaintext from memory on drop.

use zeroize::Zeroizing;

// Encrypted template bytes (pre-generated by scripts/encrypt_templates.py).
#[path = "prompt_encrypted.rs"]
mod prompt_encrypted;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/template.rs#L1-L8

```13:21:crates/codegen/xai-grok-agent/src/prompt/template.rs
fn decrypt(data: &[u8], seed: u8) -> Zeroizing<String> {
    let bytes: Vec<u8> = data
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ seed.wrapping_add(i as u8))
        .collect();
    Zeroizing::new(String::from_utf8(bytes).expect(
        "prompt template decryption produced invalid UTF-8 — \
         prompt_encrypted.rs is likely stale; run: \
         python3 scripts/encrypt_templates.py",
    ))
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/template.rs#L13-L21

**注意**：明文模板本身就在仓库里公开（`templates/*.md`），加密只是混淆层，不是安全边界（注释明确写了 "This is obfuscation, not security"）。

除模板外，还有大量提示词散落在 Rust 内联字符串：

- shell 层目标模式（goal harness）：`crates/codegen/xai-grok-shell/src/session/templates/*.md`（goal_planner_prompt.md、goal_strategist_prompt.md、goal_summarizer_prompt.md、goal_verifier_prompt.md、goal_verifier_kind_lens_{code_change,research,analysis}.md、goal_rules.md、goal_task_discipline.md、goal_plan_block.md、goal_continuation_directive.md 等），经 `include_str!` 载入（`crates/codegen/xai-grok-shell/src/session/acp_session.rs:326-338`）。
- 工作流脚本：`crates/codegen/xai-grok-shell/src/session/workflow/registry.rs:18` 的 `deep_research.rhai`。
- auto mode 分类器：`crates/codegen/xai-grok-workspace/templates/auto_mode_classifier_system_prompt.md`。
- 子代理 persona：`crates/codegen/xai-grok-agent/src/prompt/subagent_prompts.rs:21`（`EXPLORE_PROMPT` / `GENERAL_PURPOSE_PROMPT` / `PLAN_PROMPT`，定义在 `xai-tool-types`）。

## 3.2 提示词拼装管线

```253:282:crates/codegen/xai-grok-agent/src/prompt/context.rs
    pub fn render_with_renderer(&self, renderer: &TemplateRenderer) -> Option<String> {
        let placeholders = self.placeholders();
        let render = |template: &str| renderer.render_with_extra(template, &placeholders).ok();
        let prompt = match self.prompt_mode {
            PromptMode::Extend => {
                let decrypted;
                let base = match &self.system_prompt {
                    TemplateOverride::Custom(template) => template.as_str(),
                    TemplateOverride::Codex => {
                        decrypted = apply_patch_template();
                        &decrypted
                    }
                    TemplateOverride::None => {
                        decrypted = if self.audience == PromptAudience::Subagent {
                            subagent_template()
                        } else {
                            base_template()
                        };
                        &decrypted
                    }
                };
                let mut prompt = render(base)?;
                if let Some(body) = &self.prompt_body {
                    prompt.push_str("\n\n");
                    prompt.push_str(&render(body).unwrap_or_else(|| body.clone()));
                }
                prompt
            }
            PromptMode::Full => render(self.prompt_body.as_deref().unwrap_or(""))?,
        };
        Some(prompt)
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/context.rs#L253-L282

`crates/codegen/xai-grok-agent/README.md:186-198` 用表格固化了顺序：

```
promptMode: extend                     promptMode: full
──────────────────                     ─────────────────
1. Base template (MiniJinja)           1. Markdown body (MiniJinja, ${{ }}/${% %})
   (work policy, formatting,           2. AGENTS.md section (if agentsMd: true)
    user_info, background tasks)       3. Skills section
2. Markdown body (appended raw)
3. AGENTS.md section (if agentsMd: true)
4. Skills section
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/README.md#L186-L198

## 3.3 是否按模型分支提示词

**结论：没有「Grok 自家 vs 第三方模型」的提示词分支。** 分支维度是：

**(a) audience（主 / 子代理）** —— 决定用 `prompt.md` 还是 `subagent_prompt.md`：

```62:72:crates/codegen/xai-grok-agent/src/prompt/context.rs
/// Controls which base template and catalog sections are rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PromptAudience {
    /// Top-level interactive session. Full base template, all catalog sections.
    #[default]
    Primary,
    /// Child/subagent session. Compact base template, no persona/subagent catalogs.
    Subagent,
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/context.rs#L62-L72

**(b) 每模型一个身份标签**（这是唯一按模型变的提示词内容）：

```137:145:crates/codegen/xai-grok-agent/src/prompt/context.rs
    /// Identity in the primary grok-build system prompt (`You are <label>…`).
    /// Not the UI picker name. Defaults to [`DEFAULT_SYSTEM_PROMPT_LABEL`].
    #[serde(default = "default_system_prompt_label")]
    pub system_prompt_label: String,
}
/// Default identity on trim-tool-descriptions (`You are Grok released by xAI`).
pub const DEFAULT_SYSTEM_PROMPT_LABEL: &str = "Grok";
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/context.rs#L137-L145

模板首行消费它：

```1:1:crates/codegen/xai-grok-agent/templates/prompt.md
You are ${{ system_prompt_label }} released by xAI. You are ${%- if is_non_interactive %} an autonomous agent that completes software engineering tasks. There is no human operator in this session.${%- else %} an interactive CLI tool that helps users with software engineering tasks.${%- endif %} Your main goal is to complete the user's request, denoted within the <user_query> tag.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/prompt.md#L1-L1

`grok-4.6` 在模型清单里把 label 设成 `"Grok 4.6"`（见 1.4.2），所以换模型时提示词里自报的身份会随之改变；全局默认 label 在 `crates/codegen/xai-grok-config-types/src/lib.rs:861-863`（远程设置可覆盖）。

**(c) harness 风格分支**（Codex / Cursor / 自定义），不是厂商分支：

```11:19:crates/codegen/xai-grok-agent/src/prompt/context.rs
pub enum TemplateOverride {
    /// Use the standard base template (or subagent template based on audience).
    #[default]
    None,
    /// Use the apply-patch profile prompt template (decrypted on demand).
    Codex,
    /// A caller-provided custom template string.
    Custom(String),
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/context.rs#L11-L19

**(d) 工具存在性分支** —— 模板里的 `${%- if tools.by_kind.X %}` 决定整段出现与否（例如 bash 描述里是否有 `kill_task` 提示）。这是「按可用工具集」而非按模型的动态分支。

**(e) 有 per-model 的工具描述差异**：`has_unix_utilities` / `is_windows` / `shell_uses_semicolon` 由运行环境计算，见 3.5。

**没有找到的证据**（明确记录）：仓库里没有 `if model == "grok..." { ...claude prompt... }` 之类的分支。`types/claude_alias.rs` 是把 Claude Code 的设置文件术语映射到 grok 工具名，与提示词分支无关。

## 3.4 环境注入

### 3.4.1 `<user_info>` 块（cwd / OS / shell / 日期）

```23:56:crates/codegen/xai-grok-shell/src/session/user_message.rs
/// Minimal user message prefix for fast-start / headless contexts.
/// Intentionally excludes workspace snapshot and git status — training/actors
/// never put `<git_status>` on the first-message prefix, and the harness matches that.
/// When `override_info` is provided, uses remote workspace info instead of local machine introspection.
pub(crate) fn construct_user_message_minimal(
    working_directory: &Path,
    override_info: Option<&UserInfoOverride>,
) -> String {
    let local_shell;
    let (os, shell, cwd) = match override_info {
        Some(info) => (info.os.as_str(), info.shell.as_str(), info.cwd.clone()),
        None => {
            local_shell = resolve_shell_display();
            (
                std::env::consts::OS,
                local_shell.as_str(),
                working_directory.to_string_lossy().to_string(),
            )
        }
    };
    let today = chrono::Local::now().format("%Y-%m-%d");
    format!(
        r#"<user_info>
OS Version: {os}
Shell: {shell}
Workspace Path: {cwd}
{USER_INFO_DATE_MARKER} {today}
</user_info>"#,
    )
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/user_message.rs#L23-L56

**重要发现**：默认（Default 模板）路径下**不注入 workspace 快照、不注入 git status**，这是刻意为之（注释：「training/actors never put `<git_status>` on the first-message prefix, and the harness matches that」）。测试同样断言前缀里没有 `<git_status>` / `<jj_status>`：`crates/codegen/xai-grok-shell/src/session/acp_session_tests/wait_for_mcp_prefix_tests.rs:494,525`。

`<git_status>` 只作为历史数据出现在 memory 抽取的样例输入里（`crates/codegen/xai-grok-shell/src/session/memory/hooks.rs:184-189`），以及 compaction 的剥离列表（`crates/codegen/xai-chat-state/src/compaction_utils.rs:262`）。

### 3.4.2 可定制模板路径的完整注入面

```150:167:crates/codegen/xai-grok-agent/src/prompt/user_message.rs
    /// Display path: the path the model sees as the workspace.
    pub workspace_path: PathBuf,
    /// OS identifier surfaced as the `<user_info>` `OS Version:` value.
    /// This is `"<kernel> <release>"`, not the OS family. Producers without uname may pass `std::env::consts::OS`.
    pub os_family: String,
    /// `$SHELL` env, basename only (e.g. "zsh", "bash").
    pub shell: String,
    /// Git/jj working-tree root, if any.
    pub vcs_root: Option<PathBuf>,
    /// Local date captured at session start (or compaction).
    /// Formatted inside the renderer using [`USER_MESSAGE_DATE_FORMAT`] so the producer cannot accidentally drift the model-facing date shape.
    pub today_local: Option<NaiveDate>,
    /// Per-workspace terminals folder, surfaced in the `<user_info>` block.
    /// The shell tool persists each background command's output here. `None` omits the line.
    pub terminals_folder: Option<PathBuf>,
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/user_message.rs#L150-L167

日期格式固定为 `%A %b %-d, %Y`（例如 "Friday Apr 24, 2026"），注释明确「Any format change is observable to the model」（`user_message.rs:16-18`）。

vcs_root 的发现：`crates/codegen/xai-grok-shell/src/session/repo_status_prefix.rs:4-12`（`discover_git_root`，没有 repo 就返回 `None`）。

### 3.4.3 环境相关的工具描述分支

```51:72:crates/codegen/xai-grok-tools/src/types/template_renderer.rs
struct TemplateContext {
    tools: ToolsContext,
    params: HashMap<String, HashMap<String, String>>,
    /// `cfg!(not(unix))`.
    is_windows: bool,
    /// `powershell.exe` 5.1 and `cmd.exe` chain with `;`; everything else
    /// with `&&`. Used by templates that document command chaining.
    shell_uses_semicolon: bool,
    /// Whether `grep`, `head`, `tail`, `sed`, `awk`, `find` are usable from the active shell. False
    /// on Windows + PowerShell / cmd.exe; true everywhere else. Tool descriptions branch on this to
    /// swap Unix-centric guidance for PowerShell-aware guidance.
    has_unix_utilities: bool,
    /// Whether the client delivers system reminders (e.g. completion notifications for backgrounded commands/subagents) to the
    /// model. Descriptions that promise "you are notified on completion" branch on this so the promise is only made
    /// when it can be kept. Defaults to `true` (prod CLI behavior).
    system_reminders_enabled: bool,
    /// Absolute path to this session's drafts file, when known.
    feedback_drafts_path: String,
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/types/template_renderer.rs#L51-L72

bash 描述里对这些 flag 的实际消费：

```1369:1377:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
  - If the output exceeds {max_output_bytes} characters, output will be truncated before being returned to you.
${%- if shell_uses_semicolon %}
  - '&&' is not supported in this shell; chain sequential commands with ';'.
${%- endif %}
${%- if not has_unix_utilities %}
  - The Unix utilities `grep`, `head`, `tail`, `sed`, `awk`, and `find` are NOT available in this shell. Use the dedicated tools instead.
${%- endif %}"#
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1369-L1377

## 3.5 AGENTS.md / CLAUDE.md / skills 的发现与注入

### 3.5.1 发现

```1:8:crates/codegen/xai-grok-agent/src/prompt/agents_md.rs
//! AGENTS.md / Claude.md / rules directory discovery and loading.
//!
//! Searches from cwd to repo root, plus `~/.grok/`. Also discovers
//! `*.md` files in rules directories: vendor-prefixed `.grok/rules/`,
//! `.claude/rules/`, and `.cursor/rules/` in project directories, a
//! plain `rules/` directly under the vendor-qualified home-scope roots
//! (`~/.grok/rules/`, `~/.claude/rules/`, `~/.cursor/rules/`), and any
//! user-configured `[paths] extra_rule_dirs` (scanned as home-scope rules).
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L1-L8

源分类（决定是否受 folder-trust 门控、是否套 `.gitignore`）：

```28:45:crates/codegen/xai-grok-agent/src/prompt/agents_md.rs
/// Where a discovery root (and every file found under it) comes from; decides folder-trust gating, whether the
/// repo's gitignore applies, and how the prompt and `grok inspect` scope the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstructionSource {
    /// `$GROK_HOME` and the vendor homes.
    Home,
    /// `[paths] extra_rule_dirs`: user-listed, so neither trust-gated nor gitignore-filtered.
    Configured,
    /// The cwd-to-git-root chain; dropped when the folder is untrusted.
    #[default]
    Project,
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L28-L45

### 3.5.2 注入格式与顺序

AGENTS.md 被包成 `<system-reminder>`，且**明确声明「从 repo root 到 cwd 排序，深层优先」**；对内容做 HTML 转义防注入：

```388:411:crates/codegen/xai-grok-agent/src/prompt/agents_md.rs
fn render_agents_md(configs: &[AgentConfigFile]) -> Option<String> {
    if configs.is_empty() {
        return None;
    }

    let mut section = String::new();
    section.push_str(LEGACY_AGENTS_MD_REMINDER_PREFIX);
    section.push_str(
        " (ordered from repo root to current directory - deeper files take precedence on conflicts):\n",
    );

    for config in configs {
        section.push_str(&format!(
            "\n## From: {}\n",
            neutralize_reminder_tags(&config.file_path)
        ));
        section.push_str(&neutralize_reminder_tags(&config.content));
        section.push('\n');
    }

    section.push_str("\nFollow these instructions exactly. When working in subdirectories not listed above, check for additional project instruction files (AGENTS.md, Claude.md, etc.).");
    section.push_str("\n</system-reminder>");

    Some(section)
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L388-L411

防注入函数（把 `<system-reminder>` / `<system_reminder>` 的大小写与空格变体统一转义）：

```381:386:crates/codegen/xai-grok-agent/src/prompt/agents_md.rs
/// HTML-escape leading `<` so untrusted AGENTS.md cannot break out of or forge harness framing.
fn neutralize_reminder_tags(content: &str) -> String {
    SYSTEM_REMINDER_TAG_RE
        .replace_all(content, "&lt;$1")
        .into_owned()
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L381-L386

### 3.5.3 规则分「工作区规则」与「用户规则」两级注入（用户规则在后）

```44:62:crates/codegen/xai-grok-agent/src/prompt/user_message.rs
pub fn format_rules_section(
    workspace_rules: &[RuleEntry],
    user_rules: &[RuleEntry],
) -> Option<String> {
    if workspace_rules.is_empty() && user_rules.is_empty() {
        return None;
    }
    let mut out = String::from("<rules>\n");
    out.push_str(RULES_SECTION_INTRO);
    out.push_str("\n\n\n");
    if !workspace_rules.is_empty() {
        out.push_str(
            "<always_applied_workspace_rules description=\"These are workspace-level rules that the agent must always follow.\">\n",
        );
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/user_message.rs#L44-L62

分级的判定：`Configured` 源、或路径位于 `~/.grok` / `~/.claude` / `~/.cursor` / 工作区根之外 → 用户规则；其余 → 工作区规则：

```32:56:crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs
/// A `Configured` file is a user rule wherever its dir sits; everything else is scoped by path.
fn partition_rules_by_scope(
    files: Vec<xai_grok_agent::prompt::agents_md::AgentConfigFile>,
    grok_home: &std::path::Path,
    vendor_homes: &[(std::path::PathBuf, bool)],
    workspace_roots: &[&std::path::Path],
) -> (
    Vec<xai_grok_agent::prompt::user_message::RuleEntry>,
    Vec<xai_grok_agent::prompt::user_message::RuleEntry>,
) {
    let mut workspace = Vec::new();
    let mut user = Vec::new();
    for file in files {
        let is_user_rule = file.source
            == xai_grok_agent::prompt::agents_md::InstructionSource::Configured
            || crate::util::is_user_instruction_path(
                std::path::Path::new(&file.file_path),
                grok_home,
                vendor_homes,
                workspace_roots,
            );
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L32-L56

规则内容同样被中和（防止 AGENTS.md 里的 `</rules>` 截断包裹层）：

```29:37:crates/codegen/xai-grok-agent/src/prompt/user_message.rs
fn neutralize_file_rule_content(content: &str) -> String {
    content
        .replace("</rules>", "&lt;/rules>")
        .replace("<rules>", "&lt;rules>")
        .replace("</system-reminder>", "&lt;/system-reminder>")
        .replace("<system-reminder>", "&lt;system-reminder>")
        .replace("</system_reminder>", "&lt;/system_reminder>")
        .replace("<system_reminder>", "&lt;/system_reminder>")
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/user_message.rs#L29-L37

### 3.5.4 skills

- 发现与预算渲染：`crates/codegen/xai-grok-agent/src/prompt/skills.rs`（2723 行）
- 列出时按预算裁剪（默认「上下文的 1%」启发式）：

```226:227:crates/codegen/xai-grok-agent/src/prompt/user_message.rs
    /// Optional listing budget in characters; defaults to the standard 1%-of-context heuristic when None.
    pub skill_listing_budget_chars: Option<usize>,
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/prompt/user_message.rs#L226-L227
- 预算渲染模式与溢出指示：`user_message.rs:298-312`（`XmlRenderMode::Budgeted { budget_chars, overflow_indicator: true }`）
- 运行中还有 `SkillDiscoveryReminder` 在工具结果里追加「发现了新 skill」的提示（`crates/codegen/xai-grok-tools/src/reminders/mod.rs:11-17`）

### 3.5.5 主 prompt 里的 `skill_information` 位置约定

`crates/codegen/xai-grok-shell/src/session/acp_session_impl/interjection.rs:337`：「Model-visible text: `<skill_information>` follows the wrapped `<user_query>`, the same order as turn-start prompt assembly」。

## 3.6 每轮追加的 reminder / 动态状态注入

三层 reminder：

**(1) 工具级 / 跨切面 reminder**（附在工具结果里）：

```11:17:crates/codegen/xai-grok-tools/src/reminders/mod.rs
//! This module contains the cross-cutting reminders:
//! - [`LspDiagnosticsReminder`], [`SkillDiscoveryReminder`], [`TaskCompletionReminder`]
//!
//! All reminders are collected and appended in `call_new_tool()`.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/reminders/mod.rs#L11-L17

`TaskCompletionReminder` 的机制：不靠模型轮询，而是在**每次工具调用**时查后台任务/子代理状态，把新完成的塞进工具结果：

```1:17:crates/codegen/xai-grok-tools/src/reminders/task_completion.rs
//! Background task and subagent completion reminder.
//!
//! On each tool call, [`TaskCompletionReminder`] queries the
//! [`TerminalBackend`] (already on `SharedResources`) via `list_tasks()`
//! and reports any newly-completed background tasks as plain reminder
//! text. It also queries the subagent coordinator via
//! [`SubagentEventSender`] for newly-completed subagents.
//!
//! The tool pipeline wraps each string in `<system-reminder>` tags
//! inside the tool result so the model learns about completions without
//! polling `get_task_output`.
//!
//! A [`ReportedTaskCompletions`] state set tracks which task/subagent IDs
//! have already been surfaced, preventing duplicate reminders.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/reminders/task_completion.rs#L1-L17

**(2) 轮次级 reminder**（作为合成 user 消息追加）：

- 日期跨天：`crates/codegen/xai-grok-shell/src/session/acp_session_impl/reminders.rs:505-522`，文案在 `:174`（"The local date has changed since this session started. Today's date is now..."）
- `push_system_reminder` / `push_system_reminder_with_tag`：`reminders.rs:533-545`

**(3) Todo 相关两张门**：

```10:50:crates/codegen/xai-grok-agent/src/system_reminder.rs
pub struct ReminderPolicy {
    /// Whether system reminders are enabled at all.
    pub enabled: bool,
    /// Configuration for the periodic TodoWrite nudge reminder.
    pub todo_nudge: TodoNudgeConfig,
    /// Configuration for the runtime turn-end TodoGate.
    pub todo_gate: TodoGateConfig,
}
...
/// The system will remind the model to use `todo_write` when it hasn't done so within a configurable number of turns.
#[derive(Debug, Clone)]
pub struct TodoNudgeConfig {
    pub enabled: bool,
    pub turns_since_todo_write: u32,
    pub turns_between_reminders: u32,
}

impl Default for TodoNudgeConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            turns_since_todo_write: 3,
            turns_between_reminders: 5,
        }
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/src/system_reminder.rs#L10-L50

（TodoGate 默认关闭、每 prompt 最多触发 2 次，见同文件 `:52-66`。）

**(4) 记忆 reminder 的就地注入**：`crates/codegen/xai-chat-state/src/actor/request_builder.rs:32-48`（先尝试就地改已有 `System` item，改不了才 prepend；两者都会 `snapshot_turn_slice()` + `rebase_turn_capture_offset()`）。

## 3.7 coding 行为规则（提示词里的硬约束）

`templates/prompt.md` 的章节划分即行为约束清单：

| 章节 | 行号 | 内容要点 |
|---|---|---|
| 开头身份 | `:1` | `You are <label> released by xAI`，交互/非交互两种人格 |
| `<dangerous_actions>` | `:3-9` | 破坏性/不可逆操作、共享系统变更须先确认；授权范围不外溢 |
| `<work_policy>` | `:11-20` | 明确要求全流程保持可见；只在明确是「实施」请求时才改代码；清晰可逆的本地工作应在当前轮直接做而不是反问；**「只有在工具有输出支撑时才可声称完成/修复/测试过」** |
| `<memory>` | `:22-43`（`memory_v2_enabled` 时） | 记忆是用户可控的知识库；先读 topic 文件再动手 |
| `<background_tasks>` | `:46-56` | 长命令后台跑并继续独立工作 |
| `<communication>` | `:58-76` | 面向「没看过工具调用」的读者，先给答案，不重复既有词汇 |
| `<formatting>` | `:78-80` | GFM；嵌套代码围栏必须外层更长 |
| `<user_guide>` | `:82-87`（交互式） | TUI 文档在 `~/.grok/docs/user-guide/` |
| `<browser_verification>` | `:88-100`（可选） | UI 改动必须在浏览器端到端验证 |

（行号基于 `crates/codegen/xai-grok-agent/templates/prompt.md`，全文 100 行。）

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/prompt.md

`<work_policy>` 关键段（这是最接近「coding 行为规则」的硬约束）：

```11:21:crates/codegen/xai-grok-agent/templates/prompt.md
<work_policy>
- Keep every explicit requirement of the request in view until it is completed, superseded by the user, or genuinely blocked. If something is blocked, say so plainly rather than quietly dropping it.
- Match your response to the user's intent. Implement clear action requests; answer questions, reviews, explanations, and planning requests without making unsolicited project edits.
- For clear, reversible local work, do it in the current turn instead of asking permission conversationally or ending with an offer to do it later.
${%- if tools.by_kind.task %}
- When the user explicitly asks you to use subagents or delegate work, those launches are part of the requested outcome: make the `${{ tools.by_kind.task }}` calls near the start of the work. Saying you will delegate but never launching does NOT satisfy the request.
${%- endif %}
- Claim that something is done, fixed, tested, or addressed only when tool output supports the claim. Otherwise state what you did not verify and why.
- Keep changes scoped to what was asked. Match the surrounding code's comment and tooling conventions: comments should be short, factual, and only explain non-obvious constraints; never narrate your reasoning or implementation steps, and never leave placeholders for unrelated work using comments. Comments and suppressions must NOT substitute for fixing a problem.
</work_policy>
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/prompt.md#L11-L21

**「先搜索再编辑」类规则不在主 prompt 里，而在子代理 prompt 里**（主 agent 靠工具描述里的 `${{ tools.by_kind.read }}` 引用与 hunk 工具语义约束）：

```14:22:crates/codegen/xai-grok-agent/templates/subagent_prompt.md
<tool_calling>
- Parallelize independent tool calls in a single response.
${%- if tools.by_kind.read == "hashline_read" and tools.by_kind.edit and tools.by_kind.search %}
- Prefer the hashline workflow: use `${{ tools.by_kind.search }}` to locate targets and edit directly via anchors. Reuse fresh anchors from `${{ tools.by_kind.edit }}` results. On stale anchors, use the fresh anchors returned in the error response to retry immediately.
- `${{ tools.by_kind.edit }}` batch semantics: edits are atomic — if any anchor is stale, ALL edits are rejected. Retry the full batch. Never fabricate or modify anchors.
${%- endif %}
- `<system-reminder>` tags in tool results are automated context.
</tool_calling>
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/subagent_prompt.md#L14-L22

```28:33:crates/codegen/xai-grok-agent/templates/subagent_prompt.md
${%- if tools.by_kind.edit %}

<making_code_changes>
Never output code unless requested. Read files before editing. Ensure generated code runs immediately.${%- if tools.by_kind.lsp %} Fix linter errors but don't guess.${%- endif %}
</making_code_changes>
${%- endif %}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/subagent_prompt.md#L28-L33

**输出格式约束**（`startLine:endLine:filepath` 形式的代码块引用）：

````35:44:crates/codegen/xai-grok-agent/templates/subagent_prompt.md
<formatting>
Use ```startLine:endLine:filepath for codeblocks. Use markdown links with absolute paths for file references.
</formatting>

<inline_line_numbers>
Code chunks may include LINE_NUMBER→LINE_CONTENT. The LINE_NUMBER→ prefix is metadata, not code.
${%- if tools.by_kind.read == "hashline_read" and tools.by_kind.edit %}
Hashline format: ANCHOR→CONTENT (e.g. `22:abc:rst→code`). The anchor is only `22:abc:rst` — never include → or content when passing anchors to `${{ tools.by_kind.edit }}`.
${%- endif %}
</inline_line_numbers>
````

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/subagent_prompt.md#L35-L44

注意这一行：*"Code chunks may include LINE_NUMBER→LINE_CONTENT. The LINE_NUMBER→ prefix is metadata, not code."* 这正是本会话父 agent 上下文里 `<inline_line_numbers>` 的来源。

**项目指令文件的 scope/precedence 规则**（同时出现在主 prompt 的 AGENTS.md 段落和子代理 prompt 的 `<project_instructions_spec>`）：

```46:66:crates/codegen/xai-grok-agent/templates/subagent_prompt.md
<project_instructions_spec>
## Project Instruction Files

Repos often contain project instruction files named `AGENTS.md`, `Agents.md`, `Claude.md`, or `AGENT.md`. These files can appear anywhere within the repository. They provide instructions or context for working in the codebase.
...
### Scoping rules
- The scope of a project instruction file is the entire directory tree rooted at the folder that contains it.
- For every file you touch, you must obey instructions in any project instruction file whose scope includes that file.
...
### Precedence rules
- More-deeply-nested project instruction files take precedence over higher-level ones when instructions conflict.
- Direct user instructions in the chat always take precedence over any project instruction file content.
- When working in a subdirectory below CWD, or in a directory outside the CWD path, you must check for additional project instruction files (AGENTS.md, Claude.md, etc.) that may apply to files you're editing.
</project_instructions_spec>
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-agent/templates/subagent_prompt.md#L46-L66

---

# 维度 4：bash / 终端优化

## 4.1 `xai-grok-shell*` 系列的分层职责

| crate | 职责 | 证据 |
|---|---|---|
| `xai-grok-shell-base` | 最底层基础件：env、util、cpu_profile。注释明确「从 `xai-grok-shell` 抽出以并行编译、避免 shell 改动触发重建」 | `xai-grok-shell-base/src/lib.rs:1-7` |
| `xai-grok-shell-terminal` | 本地/ACP/PTY 三种终端 runner、后台任务注册表、交互式 PTY 会话 | `xai-grok-shell-terminal/src/lib.rs:1-30` |
| `xai-grok-shell-session-support` | 目前只剩 `managed_mcp`（企业托管 MCP） | `xai-grok-shell-session-support/src/lib.rs:1-10` |
| `xai-grok-shell` | 编排层：session actor、agent、插件、扩展；`pub use xai_grok_shell_terminal as terminal;` 等再导出 | `xai-grok-shell/src/lib.rs:14-58` |
| `xai-grok-tools/src/computer/local` | 工具侧终端后端：`terminal.rs`(5741 行) 负责进程生命周期+截断，`shell_state.rs` 负责持久 shell 状态 | `xai-grok-tools/src/computer/local/mod.rs:1-17` |

```1:7:crates/codegen/xai-grok-shell-base/src/lib.rs
//! Foundation modules shared by the grok shell crate family.
//! Extracted from `xai-grok-shell` (which re-exports them at their original paths) so they build in parallel and stop rebuilding on shell edits.

#![deny(clippy::indexing_slicing)]

pub mod cpu_profile;
pub mod env;
pub mod util;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell-base/src/lib.rs#L1-L7

```43:47:crates/codegen/xai-grok-shell-terminal/src/lib.rs
pub const DEFAULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
pub const DEFAULT_OUTPUT_BYTE_LIMIT: usize = 30_000;

/// Resolved absolute path to bash. On Unix uses the `xai_grok_config` cascade (`$GROK_SHELL` > `$SHELL` > `which` > common dirs > `/bin/bash`), cached process-wide. On non-Unix returns `"/bin/bash"`.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell-terminal/src/lib.rs#L43-L47

## 4.2 持久化 shell 会话（state dump + replay）

设计核心：**每次调用仍是新进程**，但调用前后把 shell 的环境（env vars、cwd、函数、别名、options）dump 出来再回放，用户观感是一条连续会话。状态走 fd 3/fd 4，避免污染 stdout/stderr。

```1:8:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
//! Persistent shell state across command invocations.
//!
//! After each command, the shell's environment
//! (env vars, cwd, functions, aliases, options) is serialized via a dump script,
//! and replayed before the next command. Each invocation is still a fresh process,
//! but the user observes a single continuous session.
//!
//! State is transported via extra file descriptors (fd 3 for input, fd 4 for output)
//! so that dump traffic never pollutes stdout/stderr.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L1-L8

```35:45:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
/// Maximum time to wait for a shell state init (login shell + rc files).
const INIT_TIMEOUT: Duration = Duration::from_secs(15);

/// Maximum time to wait for the dump reader task after the child process exits.
/// Uses a 5s close timeout. If a background process inherits fd 4,
/// the reader would hang forever without this.
const DUMP_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Environment overrides applied to every agent terminal / persistent shell spawn.
/// Prevents color/pager noise in captured output and marks the process as agent-driven.
pub fn shell_env_overrides() -> HashMap<String, String> {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L35-L45

环境继承的固定覆盖（保证输出可解析）：

```45:56:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
pub fn shell_env_overrides() -> HashMap<String, String> {
    HashMap::from([
        ("TERM".to_string(), "dumb".to_string()),
        ("NO_COLOR".to_string(), "1".to_string()),
        ("FORCE_COLOR".to_string(), "0".to_string()),
        // Re-applied last via [`crate::util::apply_grok_agent_marker`] so request
        // env cannot clear it.
        (
            crate::util::GROK_AGENT_ENV.to_string(),
            crate::util::GROK_AGENT_ENV_VALUE.to_string(),
        ),
    ])
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L45-L56

初始化走 **交互式 login shell**（加载用户 rc 文件），并把 login 噪音（MOTD、bashrc echo）用 marker 切掉：

```270:312:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
    /// Initialize shell state by running an interactive login shell that loads the user's rc files,
    /// then capturing the resulting environment. This is the expensive path — only called once
    /// (lazily on first command).
    pub async fn init(
        shell: ShellKind,
        cwd: &Path,
        shell_env_policy: Option<&crate::util::ShellEnvironmentPolicy>,
    ) -> Result<Self, crate::computer::types::ComputerError> {
        let dump_script = shell.dump_script();
        let dump_fn = shell.dump_function_name();

        // Build the one-liner: define the dump function, print a marker (to separate
        // login noise from our output), then call the dump function.
        let script = format!("{dump_script} builtin printf '{INIT_STATE_MARKER}\\n'; {dump_fn}");

        let args: Vec<&str> = match shell {
            ShellKind::Bash => vec!["-O", "extglob", "-ilc", &script],
            ShellKind::Zsh => vec!["-o", "extendedglob", "-ilc", &script],
        };
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L270-L312

**cwd 跟踪**：dump 的首行就是 cwd，回放前校验必须是绝对路径才接受新 cwd，否则保留旧值：

```466:481:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
    /// Update this state from a raw dump string (read from fd 4).
    /// Returns `true` if the state was successfully updated.
    pub fn update_from_dump(&mut self, raw: &str) -> bool {
        match parse_dump(self.shell, raw) {
            Some((new_cwd, new_snapshot)) => {
                if new_cwd.is_absolute() {
                    self.cwd = new_cwd;
                }
                self.snapshot = new_snapshot;
                true
            }
            None => {
                tracing::debug!("shell state dump markers missing, keeping previous state");
                false
            }
        }
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L466-L481

一个显式的安全告警（说明已知边界）：策略过滤只能作用于 base env，**rc 文件导出的变量会绕过策略进入 replay 快照**：

```304:311:crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs
        // Apply the policy before the `export -p` snapshot so the replayed state is already filtered; otherwise the restore would undo it. No-op
        // unless set. SECURITY: this filters the base env only. Variables an rc file exports during login are captured in the replay snapshot and are
        // not re-filtered by `exclude`/`include_only` on the persistent backend, so warn when a policy is active.
        if shell_env_policy.is_some_and(|p| !p.is_noop()) {
            tracing::warn!(
                "shell_environment_policy filters the persistent shell's base env only; \
                 variables exported by rc files enter the replay snapshot unfiltered"
            );
        }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs#L304-L311

## 4.3 交互式 PTY（与 bash 工具分离的一条通道）

```1:8:crates/codegen/xai-grok-shell-terminal/src/pty_session.rs
//! Agent-scoped interactive PTY manager.
//! PTYs are keyed by `terminalId`, outlive sessions, and multiplex I/O over the existing ACP WebSocket.
//! Shells enroll in the process-global scope as terminal owners, so teardown hangs a live shell up and it forwards that to its jobs.
//! A shell that exits on its own leaves them running, as a terminal does.
//! Their process groups are their own and nothing here holds a handle to them.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L1-L8

PTY 的关键参数（输出环形缓冲 256 KiB、16ms 批量、500ms 忙轮询、输入通道 256）：

```54:64:crates/codegen/xai-grok-shell-terminal/src/pty_session.rs
const NOTIFICATION_METHOD: &str = "x.ai/terminal/pty/notification";
const OUTPUT_RING_BUFFER_SIZE: usize = 256 * 1024;
const OUTPUT_BATCH_INTERVAL_MS: u64 = 16;
const BUSY_POLL_INTERVAL_MS: u64 = 500;
const INPUT_CHANNEL_CAPACITY: usize = 256;
const EXIT_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);
/// This wait collects a killed shell rather than waiting on a live one.
const REAP_GRACE: std::time::Duration = std::time::Duration::from_millis(100);
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L54-L64

## 4.4 超时 / 后台任务 / 交互式行为

```41:48:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
/// Eviction delay for completed tasks; the on-disk output file persists for the session.
const COMPLETED_TASK_TTL: Duration = Duration::from_secs(300);
/// SIGTERM → SIGKILL grace period.
const SIGTERM_GRACE: Duration = Duration::from_secs(1);
/// Max background task lifetime; 10 hours to support long monitor and bash runs.
pub(crate) const BACKGROUND_MAX_RUNTIME: Duration = Duration::from_secs(36_000);
/// Max time an auto-backgroundable foreground command blocks the turn before being
/// backgrounded (never killed), independent of `timeout`. Env: `GROK_FOREGROUND_BLOCK_BUDGET_MS`.
pub(crate) const FOREGROUND_BLOCK_BUDGET: Duration = Duration::from_secs(15);
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L41-L48

「前台超时 → 自动转后台（不是杀掉）」这一行为直接写在工具描述里给模型看：

```1349:1363:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
    fn default_description_template_enabled() -> &'static str {
        r#"Run a ${%- if is_windows %} shell command${%- else %} bash command${%- endif %} and return its output.

Usage notes:
  - You can specify an optional ${{ params.execute.timeout }} in milliseconds (up to ${{ max_timeout_ms | default(300000) }}ms). ${%- if auto_background_on_timeout %} ${%- if fg_budget_disabled %} A foreground command still running at ${{ params.execute.timeout }} is moved to the background instead of killed; once backgrounded it runs until it exits (background cap ${{ background_cap_hours }}h). You will receive a task id; wait for it with ${{ tools.by_kind.background_task_action }}. If you do not receive a task id, the command was killed at timeout instead.${%- else %} Foreground commands block this tool for at most about ${{ fg_budget_secs }}s. A command still running at that point is moved to the background — it is not killed and has not timed out — and you receive a task id; wait for it with ${{ tools.by_kind.background_task_action }}. If you do not receive a task id, the command was killed at timeout instead. ${{ params.execute.timeout }} is a separate kill deadline that only applies while the command is still in the foreground; once backgrounded the command runs until it exits (background cap ${{ background_cap_hours }}h). Setting ${{ params.execute.timeout }} never makes this tool wait longer than about ${{ fg_budget_secs }}s.${%- endif %} Commands launched with ${{ params.execute.is_background }}: true are not bounded by the default: with ${{ params.execute.timeout }} omitted or 0 they run until they exit or are killed; a positive ${{ params.execute.timeout }} still applies.${%- else %} If not specified, foreground commands will timeout after ${{ default_timeout_ms | default(120000) }}ms. Background tasks are not bounded by the default: with ${{ params.execute.timeout }} omitted or 0 they run until they exit or are killed; a positive ${{ params.execute.timeout }} still applies.${%- endif %}
  - Timeout enforcement: ${%- if auto_background_on_timeout %}when the timeout fires on an explicit `${{ params.execute.is_background }}: true` command, the wrapper${%- else %}when the timeout fires, the wrapper${%- endif %}${%- if is_windows %} terminates the child's Job Object, killing every descendant process immediately (no graceful-termination grace period).${%- else %} kills the child process group (SIGTERM, escalated to SIGKILL after a ~1s grace period). Descendants that did not detach via `setsid` / `nohup` will also be killed.${%- endif %} `${{ params.execute.timeout }}: 0` in `${%- if params is defined and params.execute is defined and params.execute.is_background %}${{ params.execute.is_background }}${%- else %}background${%- endif %}: true` mode disables the wrapper timeout entirely${%- if tools.by_kind.kill_task_action %}; the child's lifetime is owned by the model via ${{ tools.by_kind.kill_task_action }}${%- endif %}.
  - If the output exceeds {max_output_bytes} characters, the middle is truncated (you keep the beginning and end) and the result includes the path to a log file with the full output, which you can read or search.
  - You can use the ${{ params.execute.is_background }} parameter to run the command in the background (e.g., dev servers, long builds): it returns a task id immediately and keeps running in the background.${%- if system_reminders_enabled %} You are notified on completion, so do not poll or sleep-wait for it.${%- elif tools.by_kind.background_task_action %} Check on it later with the ${{ tools.by_kind.background_task_action }} tool.${%- endif %}${%- if has_unix_utilities %} You do not need to use '&' at the end of the command when using this parameter.${%- endif %}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1349-L1363

工具声明的通知类型（后台任务的事件面）：

```1447:1454:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
    fn emitted_notifications(&self) -> &'static [&'static str] {
        &[
            "BashExecutionBackgrounded",
            "BashExecutionComplete",
            "BashExecutionFailed",
            "BashExecutionTimeout",
            "BashOutputChunk",
            "TaskCompleted",
        ]
    }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1447-L1454

流式输出：单帧 delta 上限 16 KiB，超出部分切在 UTF-8 边界上留到下一 tick（追加无损）：

```69:75:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
/// Maximum size, in bytes, of a single emitted progress `delta`. Guards against a pathological single-tick burst (a large accumulation flushed
/// in one ~100 ms tick) flooding the harness in one frame. A delta larger than this is cut on a UTF-8 char boundary and the remainder is held
/// back for the next tick (append is lossless); `total_bytes` still reflects the true monotonic count.
const MAX_PROGRESS_DELTA_BYTES: usize = 16 * 1024;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L69-L75

任务快照的 TTL 与条数上限（避免快照表无限增长）：

```75:77:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
/// Post-exit output-file retention cap so snapshots don't materialize huge strings.
const MAX_RETAINED_OUTPUT_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// Tombstones are metadata-only, so 100 entries is ~10 KB.
const MAX_COMPLETED_TASK_SNAPSHOTS: usize = 100;
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L75-L77

后台任务跨会话恢复：`crates/codegen/xai-grok-shell-terminal/src/background_task.rs`（`BackgroundTaskRegistry` / `persist_manifest` / `format_resumed_tasks_reminder`，见 `xai-grok-shell-terminal/src/lib.rs:15-18`）。

## 4.5 输出截断与格式

- 头部保留 + 尾部滚动 + 中间标记：见 1.3.2 的 `maybe_truncate` / `FRONT_BACK_TRUNCATION_MARKER`。
- 重新拼接时的实现：

```524:531:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
    fn ring_output(&self) -> String {
        match self.front_buffer.as_ref() {
            Some(front) => format!(
                "{}{FRONT_BACK_TRUNCATION_MARKER}{}",
                String::from_utf8_lossy(front).trim_end(),
                String::from_utf8_lossy(&self.output_buffer).trim_start()
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L524-L531

- **单行**超长时不用截断而用软换行（保留全部内容，因为总体积已被 30KB 上限约束）：

```38:41:crates/codegen/xai-grok-tools/src/util/truncate.rs
/// Soft-wrap a long line by inserting newlines every `wrap_width` characters. **All content is preserved** — nothing is discarded. Returns
/// `Cow::Borrowed` if the line is already within `wrap_width` (zero-copy). This is the correct strategy for bash and task_output, where the
/// total output is already size-bounded (30KB) and the model benefits from seeing all of it.
pub fn soft_wrap_line(line: &str, wrap_width: usize) -> Cow<'_, str> {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/util/truncate.rs#L38-L41

- 相关常量：`DEFAULT_SOFT_WRAP_WIDTH = 2_000`、`PREVIEW_SIZE = 2_000`（`truncate.rs:3-7`）。
- 完成提醒的内联预览：`MAX_INLINE_COMPLETION_BYTES = 4_000`，超出则只给磁盘指针（`reminders/task_completion.rs:37-42`）。
- 函数级截断辅助：`truncate_with_preview`（带 `[Output truncated - <N> bytes total...]` 尾注，`truncate.rs:112-139`）。
- UTF-8 安全：`truncate_str` / `floor_char_boundary` / `ceil_char_boundary`（`truncate.rs:64-87, 166-192`）。

## 4.6 沙箱与危险命令防护

### 4.6.1 沙箱架构

```1:12:crates/codegen/xai-grok-sandbox/src/lib.rs
//! OS-level sandboxing for Grok Build via [nono](https://crates.io/crates/nono).
//!
//! Applied once at process startup. Covers in-process `tokio::fs` calls and child processes.
//! Network is left open at the process level (agent needs LLM API); child network is blocked per-subprocess via seccomp.
//!
//! The `enforce` feature (on by default) pulls in `nono` for kernel-enforced sandboxing (Landlock/Seatbelt).
//! When disabled, the crate still provides lightweight helpers (`log_violation`, `should_restrict_child_network`, `child_net`).
//! Those helpers compile on all targets including musl.
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sandbox/src/lib.rs#L1-L12

内建 profile（`workspace` / `devbox` / `read-only` / `strict` / `off` + 自定义）。只有 `read-only` 与 `strict` 会限制网络：

```70:86:crates/codegen/xai-grok-sandbox/src/profiles.rs
pub enum ProfileName {
    #[default]
    Workspace,
    Devbox,
    ReadOnly,
    Strict,
    Off,
    Custom(String),
}

impl ProfileName {
    pub(crate) fn restricts_network(&self) -> bool {
        matches!(self, Self::ReadOnly | Self::Strict)
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sandbox/src/profiles.rs#L70-L86

**供应链防护**：项目级 `sandbox.toml` 只能**新增** profile 名，不能重定义全局已有的名字（防止恶意仓库把用户的信任 profile 掏空）：

```124:130:crates/codegen/xai-grok-sandbox/src/profiles.rs
/// Load sandbox config from `~/.grok/sandbox.toml` and `.grok/sandbox.toml`. Project config may add new profile names
/// only. It cannot redefine a name already present in the global config. Last-write-wins would let a malicious workspace
/// hollow out a user/enterprise custom profile while keeping the trusted name.
pub fn load_sandbox_config(workspace: &Path) -> SandboxConfig {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sandbox/src/profiles.rs#L124-L130

子进程网络按 seccomp 逐进程阻断（`child_net::restrict_child_network`，在 shell state init 的 spawn 前调用：`crates/codegen/xai-grok-tools/src/computer/local/shell_state.rs:298`）。

hook 写入防护「fail closed」——无法施加保护时 shell 直接失败而不是放行：

```51:64:crates/codegen/xai-grok-sandbox/src/lib.rs
/// Whether this profile requires direct-hook write protection (non-devbox enforcing profiles).
/// Shell fails closed when protection cannot be applied.
pub fn requires_hook_write_deny(profile: &ProfileName, workspace: &Path) -> bool {
    if !profile_enforces_hook_write_deny(profile) || *profile == ProfileName::Off {
        return false;
    }
    let config = profiles::load_sandbox_config(workspace);
    match profile {
        ProfileName::Custom(name) => {
            config.profiles.get(name).and_then(|p| p.extends.as_deref()) != Some("devbox")
        }
        ProfileName::Devbox => false,
        _ => true,
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-sandbox/src/lib.rs#L51-L64

### 4.6.2 危险命令防护（工具层）

**(a) 拒绝把 `&` 当作后台操作符**（引导模型改用 `is_background: true`）：

```527:530:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
/// Decide whether a command's background-operator `&` must be rejected, folding the escape hatches over [`detect_background_op_violation`]: an explicit
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L527-L530

拒绝时给模型的文案会按「param 名已知/未知」和「legacy/新格式」区分，并且会引用真实的 `is_background` 参数名（参数可被重命名）：

```1379:1395:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
    fn background_operator_validation_message(
        is_legacy: bool,
        background_enabled: bool,
        param_name: &str,
    ) -> String {
        match (background_enabled, is_legacy) {
            (true, true) => format!(
                "Command must not end with '&'. Remove the '&' and set {}=true to run the command in the background.",
                param_name
            ),
            (true, false) => {
                format!("Remove the background '&' from your command and set {}=true instead.", param_name)
            }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1379-L1395

**(b) 拒绝会「自杀」的 `pkill -f` / `pgrep -f`**（因为 wrapper bash 的完整 argv 会匹配到自己的模式串）：

```802:805:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
/// Detect a `pkill -f <pat>` / `pgrep -f <pat>` whose literal pattern substring-matches the rest of the command (i.e. outside the pkill
/// invocation itself). `pgrep` is only flagged when the excised rest also contains a `kill` token -- a bare `pgrep -f X && echo found` does not
/// kill anything and must not be rejected. Returns `Some(_)` if a self-matching invocation is found.
fn self_matching_pkill_pattern(command: &str) -> Option<SelfMatchingPkill> {
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L802-L805

实现细节（跳过非字面量模式如 `$()`/`${}`/反引号，避免误判）：

```815:830:crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs
        // Skip non-literal patterns (command substitution / shell expansion).
        if pat_str.is_empty()
            || pat_str.len() < MIN_PKILL_PATTERN_LEN
            || pat_str.contains("$(")
            || pat_str.contains("$`")
            || pat_str.starts_with('`')
            || pat_str.contains("${")
        {
            continue;
        }
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L815-L830

**(c) 进程级资源防护**：`cgroup` 内存上限 + OOM 退出码常量：

```14:15:crates/codegen/xai-grok-tools/src/computer/local/mod.rs
pub use cgroup::{CgroupMemoryConfig, PROCESS_OOM_EXIT_CODE};
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/mod.rs#L14-L15

**(d) 进程组清理**：超时/SIGTERM 时杀整个进程组（不是单个进程），Windows 上用 Job Object；`setsid`/`nohup` 脱离的后代不会被杀。—— 见 4.4 的工具描述文本与 `crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:43`（`SIGTERM_GRACE`）。

**(e) 「find → bfs / grep → ugrep」的工具影子替换**：默认开启，用更快的实现替换 shell 里的 `find`/`grep`：

```21:34:crates/codegen/xai-grok-tools/src/computer/local/mod.rs
/// Per-backend enable state for the bash-harness `find`→`bfs` / `grep`→`ugrep` shadows. Resolved
/// once by the host (config.toml `[toolset.bash]` / env / requirements) and baked into a
/// [`LocalTerminalBackend`] at creation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchShadowConfig {
    pub find_bfs: bool,
    pub grep_ugrep: bool,
}

impl Default for SearchShadowConfig {
    fn default() -> Self {
        Self {
            find_bfs: true,
            grep_ugrep: true,
        }
    }
}
```

永久链接: https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-tools/src/computer/local/mod.rs#L21-L34

注入实现：`crates/codegen/xai-grok-tools/src/computer/local/embedded_search_tools.rs`（745 行），在 `prepare_command` 中通过 `super::embedded_search_tools::search_injection(search_shadows)` 拼接（`shell_state.rs:369`）。

---

## 附录 A：值得继续深挖但本次未完成的点（标注为「推测」）

1. **`supports_backend_search` 的消费路径**：`default_models.json` 里 grok-4.6 为 true、grok-4.5 为 false，配置项在 `crates/codegen/xai-grok-sampler/src/config.rs:103`。推测它决定 `web_search` 是走客户端工具（`WebSearchTool` + `WebSearchClient` 调 Responses API）还是走服务端 hosted tool（`ConversationItem::BackendToolCall { kind: BackendToolKind::WebSearch(..) }`，见 `conversation/responses.rs:50-54`）。未逐行确认。
2. **`use_concise` 到 `GrokBuildConcise` 命名空间的接线**：`crates/codegen/xai-grok-shell/src/agent/config.rs:3741, 3954-3955` 有字段读写，`agent_ops.rs:3973-3974` 有 `"grok-build-concise"` → `AgentDefinition::grok_build_concise()` 的分支，但「谁根据模型/设置把 `use_concise` 置真」未定位。
3. **工具排序是否影响前缀**：`prefix_stable_after_tool_schema_change` 测试证明工具集变化不移动 `input` 前缀；推测是 Responses API 把 `tools` 放在与 `input` 平行的字段。未在 `conversation/responses.rs` 的 `From` 实现里逐行核对字段顺序。
4. **`scheduler` 的 occurrence journal 语义**：文件存在（`scheduler/occurrence_journal.rs` + 测试），但未读懂其幂等/重放协议。
5. **`xai-codebase-graph` 是否直接暴露为工具**：只在 shell 的 `fs_watch.rs` 里看到索引刷新调用（`refresh_codebase_graph_after_head_change` 等），在 `xai-grok-tools` 的注册表里没有对应工具。推测它服务于 `grep`/`search` 的索引加速或仅供 IDE 侧使用，未确认。
