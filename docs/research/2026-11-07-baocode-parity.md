# baocode ↔ pi-agent-desktop 功能对齐矩阵

调研日期：2026-11-07。**对齐基线是 baocode-dev/baocode 的代码**（本地
`~/Projects/baocode`，Flutter，GPL-3.0），不是发布说明——移植时按 `lib/`
里的行为契约抄实现。pi-agent-desktop 侧路径均为本仓库当前真实文件。

功能版图的版本来源拆解见同目录 `2026-11-07-baocode-feature-map.md`；
pi 上游 SDK 能力缺口见 `docs/upstream/desktop-adaptation-audit.md`。

图例：✅ 已有且可用 · 🟡 部分覆盖/形态不同 · ❌ 没有 · 🚧 全新方向（baocode
独有，无对应物可"补齐"，只能新建）

## 1. 对话与会话体验

| 功能点 | baocode（`lib/chat/` 等） | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 消息折叠/长文本折叠为标签 | ✅ | 🟡 长 prompt 在气泡内 clamp（commit b7d2ba2） | 粘贴内容折叠标签未做 |
| 会话 fork / 分支 | ✅ `/fork` | ✅ rewind/fork（`pi-host` + 回归覆盖） | 行为细节待逐条对 |
| `/btw` 旁路提问 | ✅ | ❌ | 候选移植 |
| 会话 minimap | ✅ 1.1.0 | 🟡 `SessionOutline` 是大纲不是缩略图 | 形态不同 |
| turn footer（耗时/token/成本/速度） | ✅ 1.1.0 | 🟡 usage 统计在 `usage.ts`/`UsageView`，逐 turn footer 未见 | 需确认 transcript 行是否带成本 |
| 消息排队 UI | ✅ 1.0.8 | 🟡 `pendingMessageCount` 已在 snapshot 里 | 队列 UI 完整度待查 |
| plan 跨 turn / Start 按钮 / review 卡片 | ✅ | 🟡 plan-mode 插件 + `PlanPanel` + `plan-state.ts` | 流程大体对齐，卡片形态不同 |
| `/goal` 目标命令 | ✅ | ❌ | 候选移植 |
| 长会话快开 / 滚轮惯性 / branch bar | ✅ | ❌/🟡 | 体验打磨项 |

## 2. Agent 内核与扩展

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 内建 agent core（不装 CLI 也能跑） | ✅ 1.3.0 `lib/kernel/` | ✅ pi SDK 直接内嵌（`@earendil-works/pi-coding-agent`） | 已对齐，形态更彻底 |
| 子智能体 | ✅ 多 agent | ✅ `resources/extensions/agent-team`（spawn/wait/list/interrupt）+ `AgentFleetPanel` | 已对齐 |
| hooks / skills / commands / rules 管理 | ✅ | ✅ `PluginsView`/`RulesView`/`McpView`/`HooksSection`/`ExtensionFlow` | 已对齐 |
| MCP | ✅ 表单/链接审批卡片/连通性检查 | ✅ `McpView` + `src/main/mcp.ts`（exposure/启停/OAuth 入口） | 缺连通性检查、审批卡片细节 |
| 内建扩展开关管理 | ✅ disable 全套配置 | 🟡 codemode 工具开关（defaultTools） | 缺内建扩展 disable UI |

## 3. 模型与上游

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 渠道/多 key/key 扇出 | ✅ | ✅ `model-config.ts`（api+baseUrl 共享 = 一渠道多 key） | 已对齐 |
| ChatGPT/Codex 订阅登录、账号池轮换、配额 | ✅ 1.0.6 | ❌ | 大缺口，候选立项 |
| 一键导入上游配置 | ✅ 1.0.8 | ❌ | 候选移植 |
| 模型 logo / 分会话选模型 / 自定义请求头 / 测试按钮 | ✅ | ❌/🟡 | 零散项 |
| 上下文缓存命中率 | ✅ 1.0.7 | ✅ `cache-usage.ts` + `cache-usage-regression` | 已对齐 |
| thinking 深度控制 | —（走 core） | ✅ `ThinkingTrack`/`ModelThinkingControl`（Ultra 已于本次移除） | 桌面独有，保留 |

## 4. IDE / 编辑器 —— 最大缺口

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 代码编辑器 | ✅ 完整 IDE（288 文件 `lib/ide/`） | ❌ 只有 `FileBrowser` + `FileViewer`（只读） | **头号缺口** |
| LSP | ✅ | ❌ | 依赖编辑器 |
| `file:line:col` 定位打开 | ✅ | ❌ | 编辑器前置 |
| auto save / explorer 撤销重做 / 跨应用拖拽 | ✅ | ❌ | 编辑器前置 |
| mermaid / 代码高亮 | ✅ | 🟡 `lib/highlight` 有高亮，mermaid 未见 | 小项 |

## 5. Git / SCM —— 第二缺口

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| SCM 大视图（changelist、逐行提交、diff 编辑） | ✅ 1.7.0 重写，JetBrains 式 | 🟡 `git.ts`/`remote-git.ts`：status/branches/checkout/create/delete/commit/push；`ChangesPanel` 只展示**会话改动**不是仓库 SCM | **结构性缺口**：无 staging、无 diff 视图、无提交 UI |
| 大仓库性能（1 万条上限+后台 diff） | ✅ 1.0.4 | ❌ 未做 | 随 SCM 视图一起做 |
| GitHub/GitLab 账号、issue 双向同步 | ✅（走 Stash） | ❌ | 依赖 Stash 立项 |

## 6. SSH / 远程工作区

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 远程文件/shell 覆盖（agent 侧） | ✅ | ✅ `remote-ssh.ts` + `workspace-tools.ts` + `workspaces.ts`（POSIX 远端） | 已对齐，且不部署远端服务 |
| Easy SSH 表单（密码/私钥/jump host/自动记 host key） | ✅ | 🟡 `remote-ssh.ts` 能力在，表单式连接 UI 未见 | UI 缺口 |
| SSH Servers 设置页 / 每主机选 core / 远端 Skills 页 | ✅ | ❌/🟡 | 管理面缺口 |
| WSL | ✅ | ❌ | 平台项 |

## 7. Stash（收集箱）—— baocode 独有 🚧

全局快捷键收集 → AI 润色/澄清 → GitHub issue 双向同步（1.2.0 起）。
pi-agent-desktop 无对应物，属新功能而非对齐项，建议独立立项。

## 8. 手机 / 远程接入 —— baocode 独有 🚧

手机配对预览（局域网/E2E）、手机 app beta、iroh P2P、Cloudflare Tunnel、bots。
pi-agent-desktop 无对应物。同样建议独立立项，体量大。

## 9. 浏览器

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 浏览器能力 | ✅ Chrome 扩展**接管真实浏览器**（调试/历史/"Show the agent how"）；1.9.0 移除内嵌浏览器 | 🟡 `browser.ts`/`browser-extension.ts`：WebContentsView 内嵌预览 + design mode | **方向相反**：baocode 走真实浏览器接管，我们走内嵌预览——可并存，定位需想清楚 |
| web 搜索/抓取 | ✅ | ✅ `src/main/web/`（Tavily keyless/DDG/SearXNG + 正文抓取） | 已对齐 |
| 图片生成 | ✅ 1.3.0 | ❌ | 候选 |

## 10. 用量 / 主题 / 更新 / 诊断

| 功能点 | baocode | pi-agent-desktop | 差距 |
| --- | --- | --- | --- |
| 用量统计/成本 | ✅ live usage + 配额 | ✅ `UsageView`/`usage-insights`/`usage.ts` | 已对齐 |
| VS Code 主题扩展 / 文件图标主题 | ✅ 1.0.7（Open VSX .vsix） | ❌ 只有 light/dark + `code-theme` | 主题生态缺口 |
| 代码字体/字号/ligatures/缩放 | ✅ | 🟡 `AppearanceSection` 有缩放档 | 部分 |
| 自动更新状态机 / Linux .deb | ✅ | ❌（只有 `npm run pack`） | 缺口 |
| 诊断日志上传 | ✅ | ❌ | 缺口 |
| 通知/音效 | ✅ | 🟡 `sound.ts` + notify 开关 | 基本对齐 |

## 11. 移植优先级建议（修订版）

按"agent 桌面壳的核心场景"排序，承接 feature-map §6：

1. **Git SCM 视图**——changelist + staging + diff + 逐行/逐文件提交，
   对照 `lib/ide/git/` 的交互契约；顺带解决大仓库性能上限。
2. **代码编辑器**——先只读→可编辑→`file:line:col` 打开，LSP 后置。
3. **会话体验补齐**——`/btw`、`/goal`、turn footer、排队 UI、minimap 评估。
4. **模型层**——订阅登录/账号池/配额、一键导入、logo；体量最大，单独立项。
5. **SSH 管理面**——Easy SSH 表单、SSH Servers 页、每主机 core。
6. **更新 + 诊断**——自更新状态机、日志导出/上传。
7. **独立立项**：Stash、手机接入/bots、真实浏览器接管、主题生态、图片生成。

注意：baocode 是 GPL-3.0，`lib/` 代码移植须保留许可证义务；本仓库
已同样采用 GPL-3.0（见 `LICENSE`），同许可证内移植无额外障碍。
