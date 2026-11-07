# baocode 功能与更新日志拆解

调研日期：2026-11-07。数据来源：`~/Projects/baocode`（github.com/baocode-dev/baocode，
master @ 4c5e78f1，含 v1.9.1 全部 tag）、GitHub PR 列表（472 个）、`release-notes/`。
本文是给 pi-agent-desktop 移植/对齐功能时的参照底稿；pi-agent-desktop 的 SDK 级
接入缺口另见 `docs/upstream/desktop-adaptation-audit.md`，本文补的是**功能级**地图。

**对齐基线**：功能移植与行为对齐一律以 `baocode-dev/baocode` 的**代码**为准
（本地克隆 `~/Projects/baocode`，GitHub `github.com/baocode-dev/baocode`，
Flutter 实现在 `lib/`），更新日志只用于定位"哪一版引入了什么"。移植时按行为
契约抄实现，不做目录级合并；GPL-3.0 代码的移植需保留许可证义务。

## 1. baocode 是什么

- Flutter 桌面应用（macOS arm64/x64、Windows x64/**arm64**、Linux .deb），GPL-3.0。
- 定位：**Claude Code 的桌面 UI + 自带 Fast IDE**。官方口径"no agent of its own"，
  但 1.3.0 起内置了自己的 core（`lib/kernel/`），不装 Claude Code CLI 也能跑；
  1.9.0 起内建 core 成为默认，CLI 不再推荐安装。
- 性能卖点（README）：启动 ≈0.18s、单窗口空闲 ≈120MB、Windows 安装包 ≈16MB。
- 规模：2026-09-25 首个 commit → 11-06 v1.9.1，**6 周 24 个 release、1741 commits、
  472 PRs**。提交峰值日：10-10（124）、10-26（124）、11-05（107）。
- 人员：核心基本是同一人（git author `leo`/`leokun`/`kun6687`，PR 作者 `leookun`
  占 417/472 ≈ 88%）；社区贡献 bestK(24)、clddup、cnui6、philau2512 等十余人。
- 官网 baocode.dev + `site/` 目录（含用户评价 reels）；自动更新走 dl.zkcode.dev
  同类 R2 体系（见 `docs/auto-update.md`，那是 ZKagent 侧文档，baocode 同源）。

## 2. 发版时间线（24 版）

| 版本 | 日期 | 主题 |
| --- | --- | --- |
| 1.0.0 | 10-07 | 首发：chat 折叠/Keep-Undo review//goal/富输入、多 agent、SSH 远程、Fast IDE、模型上游、扩展管理、通知、自更新 |
| 1.0.1 | 10-08 | 侧边栏面板（文件/Git/终端/后台命令）、多文件夹 workspace、@会话引用、SSH(macOS)、mermaid、plan 卡片 |
| 1.0.2 | 10-08 | 外观设置（代码字体/字号/ligatures）、长文本粘贴折叠为标签 |
| 1.0.3 | 10-09 | Windows VC++ runtime 自带、Volta 安装的 Claude Code 修复 |
| 1.0.4 | 10-09 | 大仓库 Git 性能（1 万条上限+后台 diff+LSP 监听优化）、goal 误报修复 |
| 1.0.5 | 10-09 | 网络代理设置、通知音效、字号独立缩放 |
| 1.0.6 | 10-10 | **ChatGPT/Codex 上游**（订阅额度登录、多账号轮换、配额展示）、MCP 表单/链接审批卡片 |
| 1.0.7 | 10-11 | **VS Code 主题扩展**（Open VSX .vsix 只取主题）、文件图标主题、@文件引用、会话 fork、模型测试、上下文缓存命中率 |
| 1.0.8 | 10-11 | **一键导入上游**（从支持站点）、模型 logo、**消息排队 UI**、侧栏管 SSH 主机、explorer 撤销/重做+跨应用拖拽、auto save、远端 Skills 页、MCP 连通性检查、**Claude Code 首用自动下载**、诊断日志上传 |
| 1.0.9 | 10-11 | 像素加载动画（3×3、可换样式/速度） |
| 1.1.0 | 10-12 | **手机配对预览**（局域网/E2E 直连）、**会话 minimap**、turn footer（耗时/速度/token/成本） |
| 1.2.0 | 10-16 | **Stash**（全局快捷键收集箱+AI 润色/澄清）、GitHub/GitLab 账号、**手机 app beta**、Cloudflare Tunnel 接入、branch bar、plan Start 按钮、模型分会话、自定义请求头、Customize 设置页 |
| 1.3.0 | 10-18 | **浏览器**：Chrome 扩展驱动真实浏览器+调试+历史+"Show the agent how"、**图片生成**、内建 core、聊天旁 review、live usage、长会话快开、滚轮惯性 |
| 1.4.0 | 10-18 | **Linux .deb + 自更新**、无模型时引导页 |
| 1.5.0 | 10-21 | **Easy SSH**：表单式连接（密码/私钥/jump host/自动记 host key）、SSH Servers 设置页、每主机选 core、Linux 浏览器扩展、file:line:col 打开 |
| 1.6.0 | 10-25 | **性能大版本**（Windows Skia、长会话流式、minimap、内存预算）、**Stash↔issue 双向同步**、markdown 编辑器、**SSH 断线同会话续接**、用量限额后自动继续、CLI 推荐、per-model endpoint |
| 1.7.0 | 10-27 | **JetBrains 式 Git 大视图**（log/commit panel/changelist/rebase/冲突/stash/比较/worktree/local history/blame/Ask AI）、**Windows ARM64 + WSL 项目**、CPU 大降 |
| 1.7.1 | 10-28 | macOS hang 诊断采样、聊天终端按会话隔离 |
| 1.7.2 | 10-29 | **Bots**（手机上的拟人 agent）、分屏各自侧栏+拖拽换位、Markdown diff 渲染、内建 core 对齐 CLI 2.1.293 |
| 1.7.3 | 10-29 | Bots 提速/旁白/引用会话卡片、plan 提交后 turn 即结束 |
| 1.8.0 | 11-01 | **手机连接重构**（直连/P2P/中继 E2E，iroh）、**Usage 仪表盘**、/btw 侧问、diff 侧-by-侧、分屏 panes、⌘L 引用选中代码 |
| 1.8.1 | 11-02 | Direct Only、手机 plain-text 回复、bots 无人值守工具、鼠标侧键前进后退、TeX 复制、Gitee、自建 GitLab http、按上游计价（阶梯/时段/tier） |
| 1.9.0 | 11-04 | **agents 窗口卡片化 + 四种布局**、每会话独立 Git log、**Windows 作 SSH 主机**（PowerShell）、远端 agent 可用本机工具（双向端口转发）、/fork、内建 core 默认化、历史增量读取 |
| 1.9.1 | 11-06 | 主题跟随系统 Auto、ChatGPT JSON 导入+quota 刷新、侧栏按最近活动排序、browser_act 拖拽/压感/修饰键/表单控件、扩展可读本地文件、子代理消息卡片化、**IDE workbench 服务化重构（PR #782–801 五步）**、Windows 关机崩溃修复 |

节奏特征：前 6 版（10-07~10-11）一天数版抢首发体验；中段每 1–4 天一版；
1.7.x 三连发（10-28~29）是 bots 集中迭代；1.9.x 回到每天一版。site/ 类 PR
（官网+用户评价）在 11-04/05 密集出现，配合发布造势。

## 3. 功能域拆解

按子系统汇总（括号内为首次出现的版本；代码位置相对 `~/Projects/baocode`）。

### 3.1 对话体验（`lib/chat/` 130 文件）

- 步骤折叠成单行；当前任务与进度常驻输入框上方（1.0.0，`step_folds.dart`）。
- **Keep/Undo review**：逐文件保留或撤销 agent 改动；checkpoint 存自有数据目录，
  不碰仓库 `.git`（1.0.0，`review/`、1.6.0 改为只存编辑过的文件）。
- `/goal` 目标模式：持续工作直到达成，进度卡在输入框上方（1.0.0；1.0.4 修
  "放弃/出错被误报为达成"；1.7.0 提醒 agent 更新 todo）。
- 富文本 composer：粘贴图片/拖文件、编辑器复制代码变行号引用、@ 文件/文件夹/
  会话/跨 workspace、长文本折叠为"Pasted text #1 +120 lines"标签、代码 chip
  可点击打开、IME 兼容（1.0.0/1.0.1/1.0.2/1.0.7/1.2.0/1.6.0，`composer/`）。
- 消息队列：运行中发送进队列，逐个取；可撤回编辑/Send now/删除；拖拽排序；
  Send now 在后台任务运行时也可用（1.0.8/1.6.0/1.9.1，`QueueBar` 对应物）。
- `/btw` 侧问：在旁边开一个临时会话，Esc 返回（1.8.0）。
- `/fork`：复制会话继续（1.2.0 会话 fork 菜单 + 1.9.0 /fork 命令）。
- 会话内查找 ⌘F、粘贴为纯文本 ⇧⌘V、Find in Chat（1.2.0，`chat_find.dart`）。
- turn footer：复制回复、耗时、速度、token、成本（1.1.0；1.3.0 live rolling；
  1.9.0 换行适配）。
- minimap：液态玻璃拖尾、消息刻度、点击跳转（1.1.0；1.6.0 改进吸附/预览）。
- 分屏：多 pane 各自侧栏/终端/标题卡，拖拽换位/合并，独立缩放（1.7.2/1.8.0/1.9.0）。
- 编辑已发消息、会话重命名（/rename 同步）、会话搜索（1.0.0/1.2.0/1.7.0）。
- plan 卡片 + Start 按钮（1.2.0），plan 提交后 turn 即结束（1.7.3），
  plan 待审批跨 turn 存活并有提示音（1.9.1）。
- agent 提问与用户回答留在会话里（1.9.0）；子代理消息独立卡片（1.9.1）。
- Enhance prompt/Polish：辅助模型改写输入，可撤销（1.2.0/1.3.0/1.6.0）。
- 像素加载动画：3×3、十余种样式、分 agent/subagent 配速（1.0.9）。
- 停止确认、queued 消息保留上下文注释（文件/手机来源等 system note 不可见，
  1.8.1——"不污染 prompt cache"的细节值得抄）。

### 3.2 Agent 内核（`lib/kernel/` 54 文件）

- Claude Code CLI 适配（1.0.0）；本地代理把 Anthropic/OpenAI Chat/Responses
  协议翻译成 Claude Code 能吃的形状（`lib/channel/`）。
- **内建 core**（1.3.0）：自研 agent 循环，支持 CLAUDE.md/skills/subagents/
  commands/hooks/plugins/MCP，远端主机也可跑；Settings 里 CLI/内建可切；
  1.9.0 起无 CLI 时默认内建、不再推荐安装。
- core 对齐 Claude Code CLI 版本（1.7.2 → 2.1.293）。
- subagent 模型规则对齐 CLI：inherit/force 语义（1.9.1）。
- pi-agent-desktop 对照：pi SDK 本身就是"内建 core"等价物，方向一致；
  baocode 的 `lib/kernel/` 价值在**协议翻译与会话持久化**的实现细节。

### 3.3 模型与上游（`lib/models/` 40 文件 + `lib/models/codex/`、`lib/models/proxy/`）

- 上游协议：Anthropic API、OpenAI Chat Completions、OpenAI Responses；
  本地代理翻译；key 存系统 keychain（1.0.0）。
- 分工模型：主对话/各子任务/标题/commit message 可分别选模型+上游
  （1.0.0；1.8.0 per-model endpoint；1.6.0 subagent 可用别家上游模型）。
- **ChatGPT/Codex 上游**（1.0.6）：订阅登录免 key；多账号池
  （Round Robin / Fill First / Most Remaining），额度尽自动切换；
  显示 plan/已用/重置时间；quota 可手动刷新（1.9.1）；JSON 导入凭据（1.9.1）；
  Codex 版本设置决定模型列表（1.0.7）。
- **一键上游导入**：从支持的站点一键添加（官方列表跟 baocode.dev 走，
  不发版也能更新）（1.0.8）。
- 模型 logo/图标自定义（maker logo/emoji/上传图）（1.0.8）；模型测试
  （单个/批量三并发，走真实链路）（1.0.7）；上下文长度/effort 按模型记忆（1.0.8）。
- 图像模型独立管理 + 图片生成（1.3.0；image_api.dart、image_generation_io.dart）。
- 自定义请求头，支持 `${sessionId}`/`${model}` 变量（1.2.0）。
- Anthropic-compatible 端点（DeepSeek/Zhipu/阿里）模型列表（1.0.4 修复）。
- upstream models 按名字区分同名、subagent 模型归属修复（1.9.1）。

### 3.4 IDE（`lib/ide/` 288 文件——最大子系统）

- 编辑器：语法高亮、minimap、word wrap(Alt+Z)、find/replace 跨行、
  拖拽选区、IME 修复、按块 Markdown 预览就地编辑（Typora 式，1.0.0/1.6.0）。
- 终端：每会话独立、系统 shell、字号独立（1.0.0/1.7.1）。
- LSP：VS Code/JetBrains/Sublime/Atom 键位、自定义 LSP server 配置即时生效、
  Go to Definition/References、Vue 支持（1.0.0/1.7.0/1.8.1）。
- **Git 大视图**（1.7.0 重写，`lib/ide/git/`）：JetBrains 式 log（图/分支标签/
  过滤/多选/文件历史）、Commit panel（免 staging 勾选、部分行提交、
  changelist、amend/author/sign-off/hooks、消息检查、AI 起草/AI 审查/Ask AI）、
  分支 popup（建/切/合/变基/比较/push 对话框）、交互式 rebase/cleanup/fixup、
  冲突三方合并/一键取侧/AI 合并、stash tab、remote 管理、worktree、
  文件/文件夹/行级比较、diff 折叠/忽略空白、行内 revert、blame annotate、
  **local history**（保存版本留一周）。
- VS Code 主题生态：主题+文件图标主题从 Open VSX 装 .vsix（**只取主题不执行
  扩展代码**）、主题市场页、预览切换、WOFF 字体图标（1.0.7）。
- 性能：大 diff/LSP/文件监听全部后台化；10,000 条变更上限（1.0.4）；
  同语言共享高亮 worker、布局缓存 ~32MB（1.6.0）。
- workbench 服务化重构（1.9.1，PR #782–801：服务容器/上下文键/动作注册表/
  状态栏/编辑器/资源管理器/语言服务/调试/终端/Git/导航/布局/快捷键/扩展——
  13 个 PR 分步落地，为"IDE 可扩展"铺路）。
- auto save、explorer 撤销重做、跨应用拖拽、远程剪贴板上传下载（1.0.8）。
- Markdown 编辑器：所见即所得、表格单元格编辑（1.6.0）。

### 3.5 SSH / 远程 / WSL（`lib/remote/` 21 文件）

- Remote-SSH 式项目：窗口在本机，文件/搜索/Git/终端/LSP/agent 全在远端（1.0.0）。
- Easy SSH 表单：host/port/user + 密码/私钥/Automatic，粘贴 `user@host:port`
  自动拆分，~/.ssh 密钥候选，密码进 keychain，jump host 逐级认证，
  首连自动记 host key，key 变更明确报（1.5.0）。
- SSH Servers 设置页统一管理；每主机选 core（Automatic/内建/CLI）（1.5.0）。
- Windows SSH 密码登录（OpenSSH≥8.4）；Windows 本机也能当 SSH 主机（1.9.0，
  PowerShell 终端+诊断）。
- WSL 发行版直接作为项目打开（1.7.0）。
- **断线续接**：网络抖动后回同一会话，远端终端/agent/LSP 保留（≤3h），
  30s 静默检测，输出不丢不重（1.6.0）。
- 端口转发（`port_forwards.dart`）；远端 agent 可调用本机工具（双向，1.9.0）。
- 远端 Skills/customize 管理（1.0.8）；远端文件直接打开/拖拽上传下载（1.0.8）。

### 3.6 多文件夹工作区（`lib/workspace/` 38 文件）

- 多文件夹 workspace（1.0.1）：agent 跨目录工作，嵌套 Git 仓库自动发现，
  review 聚合所有文件夹改动（1.0.7）。
- @ 引用覆盖所有成员文件夹；单文件无文件夹也能聊（1.0.7）。
- 侧栏项目排序：最近活动/拖拽自定义（1.9.1）；置顶/折叠全部/重命名（1.7.0）。
- 切工作区/成员变更只在任务空闲时（pi-agent-desktop 已有同约束——同源纪律）。

### 3.7 Stash（`lib/stash/` 25 文件）

- 全局快捷键唤全局浮动面板，随手记想法/截图/文件/链接/代码/表格/公式，
  每条带编号（1.2.0）。
- 置顶/排序/按时间项目状态过滤/合并重复；正文+图片内文字搜索；AI 语义搜索。
- Implement → 新 worktree 或当前分支；chat↔note 双向链接显示进度。
- Polish/Clarify AI 润色（1.2.0；1.6.0 markdown 编辑器）。
- **GitHub/GitLab issue 双向同步**（1.6.0）：issue→stash 行、状态/评论/checks/
  review 状态联动、改动双向推送（确认制）、issue 关闭→stash done、stash 可发布
  为 issue（脱敏本地路径/secret、图片上传）、PR 合并提示关闭。
- Settings→Accounts：GitHub/GitLab/Enterprise/自建 GitLab 登录（浏览器或 token，
  token 只存 keychain）（1.2.0）。

### 3.8 手机与 Bots（`lib/link/`、`lib/bots/`、`browser_extension` 无关）

- 手机配对（1.1.0 preview → 1.8.0 重构）：同网直连 / iroh P2P 穿透 / 中继兜底，
  E2E 加密，IP 变化可达；Settings→Mobile 选 relay 或 Direct Only（1.8.1）；
  Cloudflare Tunnel `wss://` 接入（1.2.0）；配对二维码+安全码双向确认。
- 手机上：看/操作 agent、图片/工具步骤/browser 步骤/goal/usage 展示（1.7.2）、
  文件浏览（含 gitignore 文件置灰，1.9.0）、pins 同步（1.8.1）、
  plan 审批可从手机启动（1.4.0）、手机输入时 agent 被告知切 plain text
  （system note 不可见，保 prompt cache，1.8.1）。
- **Bots**（1.7.2–1.7.3、1.8.1）：拟人 agent——名字/头像/性别/签名/语气/模型；
  能力逐项授权（看管 agent：查看/停止/重试/归档/写入/新建；用浏览器；
  agent 等待或失败时通知你）；可 web 搜索+记忆+图片生成；不读写项目文件；
  WATCH.md 规则控制何时唤醒/静默；手机上可删会话；bot 卡片引用会话可点开。
- 链路实现：`lib/link/`（chat_codec/interaction_codec/link_host…）+ iroh
  （PR #547/#562/#595/#597：relay 预编译、watch endpoint、stop 不 hang）。
- 手机 app 不在本仓库（Android/iOS，CI 出 APK 签名+TestFlight，PR #571/#610）。

### 3.9 浏览器（`lib/browser/` 17 文件 + `browser_extension/`）

- **Chrome 扩展接管真实浏览器**（1.3.0）：装扩展后 agent 可在用户自己的
  Chrome/Edge/Brave/Arc（已登录态）开页/点击/输入，按 tab 授权共享；
  侧边栏实时显示 agent 操作的页面，用户可同时操作。
- 浏览器调试全家桶：console/network、断点单步、变量（source-map 名）、
  React/Vue 组件与事件、performance/memory/unused CSS、请求拦截/mock/重写、
  设备与慢网模拟（1.3.0）。
- 调试历史自动记录（页面/请求/console 错误，点击输入不记密码，1GB 上限，
  可清理）（1.3.0）。
- "Show the agent how"：agent 请用户演示一次，步骤存项目文件复用（1.3.0）。
- browser_act 增强：拖拽、pen pressure、修饰键、hover、color/date/slider
  控件赋值、提醒 agent 关 tab（1.9.1）。
- 扩展可读本地文件（被拒时说明原因）（1.9.1）；Linux 浏览器支持（1.5.0）。
- 注意：1.9.0 **移除了侧边栏内嵌浏览器页**，统一走扩展——pi-agent-desktop
  目前是反方向（WebContentsView 内嵌预览），见 §5.3。

### 3.10 用量与计费（`lib/usage/` 25 文件）

- Usage 仪表盘（Settings）+ 每会话用量页（1.8.0）。
- live 指标：回复下滚动显示耗时/速度/token，结束显示总成本（1.3.0/1.7.0）。
- **按上游计价**：prompt 长度阶梯、时段价（DeepSeek off-peak）、service tier、
  按次/按工具调用费；进行中的调用也进列表（1.8.1）。
- prompt cache 命中率（读/写/未缓存 hover 明细，第三方不报缓存时隐藏）（1.0.7）；
  公式唯一实现 `CacheTokens.hitRate`（pi-agent-desktop 已对齐，见其 shared/cache-usage.ts）。
- plan 模式 prompt cache 修复（1.6.0）；用量限额后 Continue After Limit Reset
  （Claude 账号/ChatGPT 账号通用，1.6.0/1.7.0）。

### 3.11 外观 / 主题 / i18n（`lib/theme/`、`lib/icons/`、`lib/l10n/`）

- 主题：VS Code 主题+图标主题生态（见 3.4）；自带 Bao Dark/Light 默认；
  Auto 跟随系统（1.9.1）；删 6 个旧主题迁移默认（1.0.7）。
- 界面打磨：islands 卡片化（agents 窗口 1.9.0）、分割线、滚动 fade、
  气泡/输入统一 fill、像素 loader、圆角体系。
- 字号体系：Interface Size 总缩放 + 代码字号独立 + 终端字号独立 +
  ligatures + ⌘=/- 2% 步进 + ⌘0 重置（1.0.2/1.0.5/1.2.0/1.7.0）。
- i18n：英文+中文（README 另有日/法/西）；界面文案全走 l10n（`lib/l10n/`）。

### 3.12 系统集成（`lib/notifications/`、`lib/update/`、`lib/network/`、`lib/diagnostics/`、`lib/debug/`、`lib/telemetry/`）

- 通知+声音+图标 badge；关窗后 agent 继续跑（macOS menu bar / Windows tray）（1.0.0）。
- **自动更新**：后台检查（启动 10s 后+每 5min）、下载校验、重启安装、
  失败留日志与下次启动提示（1.0.0/1.0.8/1.0.1–1.0.3 三连修更新链路）。
- 网络代理：system/manual/direct + 多站点测速（1.0.5）；NO_PROXY/Tailscale
  支持并透传给 agent（1.3.0）。
- 诊断：macOS hang 4s 采样线程栈（1.7.1）、crash/hang/高 CPU 报告收集、
  窗口/视图/theme event log、Settings→Updates 手动上传日志拿 report ID（1.0.8）。
- telemetry：每日匿名 ping（install ID+版本+OS+CPU），可关（1.3.0）。
- Linux 通知/声音（1.7.0）；Windows 托盘 Quit 修复（1.9.1）。

### 3.13 性能工程（贯穿全程）

- 渲染：Windows 从 Impeller 换 Skia（帧耗时减半、内存减半）（1.6.0/1.7.2）；
  工作时窗口 ≤30fps（1.8.0）；macOS CPU 大降（1.7.0）。
- 长会话：从尾部读入、分页加载、增量读增长文件、JSON 解析移出 UI 线程（1.9.0）；
  虚拟化长回复/思考（出视口只留高度）（1.6.0）。
- 内存：Skia texture cache 32MB、解码图 48MB、释放回系统（1.6.0）；
  checkpoint 只存编辑文件（1.3.0）。
- Git/checkpoint 后台化；无变化检查 13→3 条 git 命令（1.7.0）。
- 滚轮物理滚动（glide/ease，高刷屏适配）（1.3.0）。

### 3.14 发布与官网工程（`site/`、`site-worker/`、`tool/`、`browser_extension/`）

- 官网 baocode.dev：下载页、changelog、用户评价 reels、上游导入列表
  （远端可更新）（site/ + 13 个 site PR + wrangler/Cloudflare）。
- CI：Android APK 签名校验、iOS TestFlight、remote server 交叉编译、
  iroh 预编译分发（PR #571/#595/#597/#610 等 9 个 ci PR）。
- 版本发布：release-notes 双语、`chore: release x.y.z` + `Release x.y.z` PR 惯例。

## 4. PR 分析（472 个）

- 状态：绝大多数 MERGED，少量 OPEN/CLOSED（社区 PR 也有被关的）。
- 类型分布（按标题前缀粗分）：fix 127、feat 95、site 13、Islands 12、
  perf 11、Bots 11、ci 9、Chat 9、chore 7、Windows 6、IDE workbench 6、
  Diff 6、test 4、docs 4、Side panel 4、refactor 2、iroh 2、Stash 2，其余长尾。
- 主题命中（标题关键词，非互斥）：IDE/editor/diff/lsp/markdown 134、
  window/sidebar/pane/split/layout 98、phone/bot/iroh/relay 64、
  update/release/ci/site 49、perf/memory/cpu/scroll/stream 35、
  model/upstream/codex/chatgpt/quota 34、git 33、plan/goal/queue/composer 25、
  ssh/remote/wsl 23、usage/cost/token 17、theme/icon 15、terminal/pty 13、
  search/find 11、browser/chrome 11、skill/rule/mcp/plugin/extension 14、
  stash 16、notif/sound/badge 6、image 8。
- 作者：leookun 417（88%）、bestK 24、philau2512/cniu6/clddup/Hr-byte-art 各 5、
  calonye 3，其余零星。**事实上的单人高速项目+社区 PR 评审合并**。
- 节奏：PR #1–#831 覆盖 6 周；编号到 831 但合并 472（其余为 issue/重复/关闭）。

## 5. pi-agent-desktop 对照

### 5.1 已有（不需要从 baocode 搬的）

- pi SDK 会话全链路：流式 chat、thinking、tool cards、审批、队列、
  子代理/agent team（`subagent-tools-extension`、AgentFleetPanel）、
  plan mode（`plan-state.ts`+PlanPanel）、design mode（BrowserHost
  capturePage + DesignPickBar）、@mentions、命令面板。
- models.json/渠道管理（`model-config.ts` 唯一写入点）、MCP 管理视图、
  plugins/rules/customize 视图、web_search/web_fetch（Tavily 免 key/DDG/
  SearXNG，TTL+LRU+并发合并）、PTY 终端、文件浏览/查看、Changes panel、
  usage 仪表盘+图表+cache ring（`CacheTokens.hitRate` 已是唯一公式）、
  i18n 中文默认、音效/toast、内嵌浏览器预览（每 workspace 一个
  WebContentsView）。
- SSH：真实 SSH 工作区（ssh2+系统 ssh），多文件夹工作区，远端文件/shell/
  git 覆盖，密钥不落盘——`docs/ssh-workspaces.md`。
- 工具输出预算与缓存纪律已写进 README（20/24/16 KiB）。

### 5.2 缺口（baocode 有、pi-agent-desktop 无）——按价值排序

| 缺口 | baocode 参照 | 量级 |
| --- | --- | --- |
| **完整 Git 视图**（log/commit/changelist/rebase/冲突/stash/比较/worktree/blame/local history/Ask AI） | `lib/ide/git/` + 1.7.0 | 大。现仅 `git.ts` 轻量 status/branches + ChangesPanel |
| **编辑器**（Monaco 级：高亮/minimap/find/LSP/就地 markdown 编辑） | `lib/ide/` 288 文件 | 很大。现无代码编辑器，FileViewer 是查看器 |
| **Stash**（收集箱+issue 双向同步） | `lib/stash/` 25 文件 | 中。issue 同步依赖 Git 账号体系，可后置 |
| **手机 app / link / bots** | `lib/link/`+`lib/bots/`+iroh | 很大，独立产品线，暂不建议 |
| **真实浏览器接管**（Chrome 扩展+调试+历史） | `lib/browser/`+`browser_extension/` | 中大。与现有内嵌预览定位不同，见 5.3 |
| **图片生成** | `lib/models/image_*` + 1.3.0 | 中。SDK 缺口清单里已有"图像生成模型管理"条目 |
| **ChatGPT/Codex 账号池**（订阅额度+轮换+quota） | `lib/models/codex/` | 中。pi 生态对应物待确认（pi models.json 的 provider 体系） |
| **上游一键导入/官网清单** | `featured_upstreams*.dart` + site | 小。pi-agent-desktop 的渠道管理已是自有体系 |
| **自动更新** | `lib/update/` | 中。electron-builder 有打包，无 updater 依赖 |
| **诊断/hang 上报** | `lib/diagnostics/`+`lib/debug/` | 小中 |
| **VS Code 主题/图标主题生态** | theme extensions（.vsix 只取主题） | 中 |
| **分屏/multi-window、minimap、/btw、/fork、会话内查找** | `lib/chat/` | 中 |
| **WSL、Windows SSH host、Linux 构建** | remote/platform | 中。出货目标当前是 Windows NSIS |
| **goal 模式**（/goal） | chat 内核侧 | 小（pi agent 侧能力，桌面只需透传） |
| **local history、worktree、branch bar** | `lib/ide/git/` | 中，依赖 Git 视图 |

### 5.3 方向性差异（看过 baocode 后值得重新想的）

- **浏览器**：baocode 1.9.0 移除了内嵌浏览器页，统一走"接管用户真实
  Chrome"的扩展路线（带登录态、调试、历史）。pi-agent-desktop 的
  WebContentsView 内嵌预览服务于 design mode 截图，两者可并存但值得
  评估：agent 浏览网页需求用扩展方案更强（登录态+真实环境），预览需求
  保留内嵌。baocode `browser_extension/` 只有 background.js+manifest，
  桥接协议在 `lib/browser/browser_bridge.dart`/`browser_actions.dart`。
- **内建 core vs 外部 CLI**：baocode 走"自研 core+协议翻译"，
  pi-agent-desktop 走"pi SDK 本体"。后者少一层翻译，但 baocode 的
  `lib/channel/`（上游协议互转）若未来要接 Claude/GPT 原生协议仍有参考价值。
- **workbench 服务化**（1.9.1 五步 PR）：baocode 把 IDE 重构成
  service/registry/contribution 模式，为扩展性铺路。pi-agent-desktop 的
  Electron 主进程分层（main/preload/shared）已类似，可在加 Git 视图/
  编辑器时直接采用 contribution 模式，避免再重构。
- **prompt cache 纪律**：baocode 多处体现"system note 不可见、不污染
  cache"（手机输入提示、上下文目录字节稳定）。pi-agent-desktop 的
  `docs/pi-optimizations.md`（ZKagent 侧）与 `shared/cache-usage.ts`
  已有同类契约，新增"环境注入 prompt"功能时沿用。

## 6. 移植优先级建议（草案，供讨论）

1. **Git 视图**：收益最直接——agent 改动审查是桌面壳核心场景，
   baocode `lib/ide/git/` 的交互（changelist/逐行提交/Ask AI）可拆成
   渐进式里程碑：先 log+diff+commit panel，再 rebase/冲突/worktree。
   注意 baocode 是 Flutter 自绘，**移植行为契约而非代码**（同 ZKagent
   AGENTS.md 的纪律）。
2. **编辑器**：评估 Monaco（VS Code 同款，LSP 生态最全）vs CodeMirror。
   baocode 是自绘引擎，无法直接搬；工作量最大，建议在 Git 视图之后。
3. **会话体验补齐**：/fork、/btw、会话内查找、minimap——小而美，
   `lib/chat/` 可对照行为。
4. **自动更新+诊断上报**：发布前必须项，baocode `lib/update/` 的
   状态机（检查/下载/校验/重启/失败恢复）可作契约。
5. **模型层**：确认 pi SDK 对自定义 provider/额度类上游的支持边界，
   再决定是否需要 baocode `lib/models/codex/` 式账号池。
6. **Stash / 浏览器接管 / 手机 bots**：各自是独立产品线，建议单独立项
   再动，不并入桌面壳主线。

## 附：本地副本位置

- `~/Projects/baocode` — github.com/baocode-dev/baocode @ master(4c5e78f1)
- `~/Projects/pi-agent-desktop` — gitee.com/Wwc1122121/pi-agent-desktop @ master(92ef1b6)
- baocode PR 全量标题：`/tmp/baocode_prs.tsv`（临时文件，重启会丢；
  需要可用 `gh pr list -R baocode-dev/baocode --state all --limit 1000` 重拉）
