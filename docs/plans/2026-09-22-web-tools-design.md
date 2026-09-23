# 网页与工具缓存实施记录

范围仅为 `F:/Projects/pi-agent-desktop`。沿用已确认的 Tavily 方案，主会话和子代理接入同一套工具。E 盘插件不修改。

## 结构与责任

```text
src/main/
├── web/                    # 独立于 Electron 的网页能力
│   ├── extension.ts        # 稳定的 web_search/web_fetch 定义与结果格式
│   ├── service.ts          # 搜索清理、正文检查、版本和分页
│   ├── tavily.ts           # keyless/API key、超时、响应上限与错误
│   └── cache.ts            # TTL/LRU/字节上限、并发合并与取消
├── agent-tools/            # Pi 本地工具的输出预算与执行策略
├── pi-host.ts              # 主会话注册与子代理能力提供
├── subagent-tools-extension.ts # 通过会话事件总线传递允许的工具工厂
└── usage.ts                # 汇总模型 token、费用和缓存统计
resources/extensions/agent-team/
├── index.ts                # 从宿主接收允许的工具工厂
└── runtime.ts              # 为各子会话构建独立扩展实例
scripts/
├── web-regression.mjs      # 离线缓存/传输/分页回归
└── web-smoke.mjs           # 显式联网验证与冷/热耗时
```

新增网页模块，不迁移或删除现有目录。复用 Pi SDK 的本地工具、取消与执行能力；不维护第二套 shell/read/grep 执行器。

## 数据流与生命周期

```text
主会话 / 子会话
  → web_search(query) / web_fetch(url, snapshot?, offset?)
  → 进程内 WebService（仅共享网页数据；按凭据隔离）
  → TTL/LRU 缓存 ──命中──→ 结果/正文分页
      └─未命中/刷新→ 同键进行中请求合并
                       → Tavily HTTPS → 校验成功内容 → 写入缓存 → 各等待者
```

- 查询和 URL 会发送给 Tavily。未设置 `TAVILY_API_KEY` 时使用官方 keyless 接口；设置时使用 Bearer 认证。缓存键只包含凭据摘要，不保存明文 key。
- 搜索保持服务排序，只合并去掉 fragment 后完全相同的 URL，不合并路径尾斜杠、查询参数、HTTP/HTTPS 或 www。
- 搜索 TTL 5 分钟、64 项/4 MiB；正文 TTL 15 分钟、32 项/16 MiB。正文保存在进程内存，应用退出后消失。HTTP 响应限制 5 MiB，35 秒总超时。
- 默认返回 5 条搜索结果和 12,000 字符正文；分别可请求至 10 条和 24,000 字符。
- 首次读取返回内容哈希 `snapshot`、实际 `next_offset`。续读以 UTF-16 偏移定位，不切开代理对；只有实际输出结束才报告到达末尾。版本失效必须重读，不能拼接新旧文档。
- 同键刷新进行时的新请求加入刷新。各等待者有自己的取消信号；最后一个等待者取消才中止网络请求。失败不缓存，不自动重试计费请求。
- 挑战页、过短内容、原始 HTML、HTTP/单 URL 提取失败都报告错误。正文质量取决于服务返回内容；需要页面交互时使用已有浏览器工具。
- 本地文件读取和 grep 不做结果缓存。bash 不缓存执行结果。模型缓存继续由 Pi/provider 配置管理。

## 实测（2026-09-22，本机 keyless）

`node --test scripts/web-regression.mjs`：10 项通过，覆盖 TTL/LRU/容量、失败重试、共享取消、刷新、凭据隔离、保序去重、版本分页、Unicode、超长响应和工具格式。

`node scripts/web-smoke.mjs`：三个公开查询及首条正文均成功；每项先冷请求再同参数热请求。

- `tokio task spawn_blocking site:docs.rs`：搜索 2482 ms，缓存 0.03 ms；首条 Tokio task 模块。正文 1001 ms，缓存 0.06 ms，12,879 字符。
- `React server components site:react.dev`：搜索 1678 ms，缓存 0.03 ms；首条 Server Components 文档。正文 290 ms，缓存 0.06 ms，9,583 字符。
- `TypeScript satisfies operator site:typescriptlang.org`：搜索 1805 ms，缓存 0.02 ms；首条 TypeScript 4.9 发布说明。正文 517 ms，缓存 0.04 ms，22,377 字符。

Tokio、TypeScript 返回代码围栏和绝对 Markdown 链接。React 返回标题结构，但检测未找到代码围栏或绝对 Markdown 链接；额外试验 advanced extraction 返回相同 9,583 字符，未改善这两个指标，所以保持 basic。缓存完整保留服务返回的文本，并不保证服务已提取网页全部内容。

这些是三个定向查询的一次测量，不是广泛相关性评测，也没有与旧搜索进行 A/B 对比。不据此宣称普遍质量提升或模型账单节省。

## 工具输出与请求前缀的最终实现

- bash 模型输出上限 20 KiB，正常超限保留 6 KiB 头和 14 KiB 尾。Pi 已截断为尾部时继续保留尾部，不能把尾部冒充完整日志头部。超限成功/失败输出都有全文路径，保存失败则保留可用原文。
- read 上限 24 KiB，用实际返回行数生成下一 offset；超长单行给出经过 shell quoting 的定向读取提示；图片保持 SDK 路径。grep 上限 16 KiB，保留原有匹配数量、行截断提示和上下文。
- read/grep 声明 parallel，bash 声明 sequential；所有信号传给 Pi。工具实例按 cwd 缓存 SettingsManager，保留 shellPath、shellCommandPrefix、imageAutoResize；命令与文件结果不缓存。
- `src/shared/cache-usage.ts` 统一 `cacheRead / (input + cacheRead + cacheWrite)`；扫描器、Usage 页面、缓存环、消息页脚采用同一函数，消息序列化补齐 cacheWrite。
- Plan 模式不再增删活动工具，通过既有 tool_call hook 拒绝写工具；系统提示和工具目录保持稳定。模式提醒仍按阶段清理；模型/推理设置变化及历史变换仍可能产生缓存失效，因此不声称完整请求永远只追加。
- Ultra 在相同状态下提示字节稳定，维持原有授权/撤销行为；没有按模型名注入任何缓存字段。

## 最终验证与启用

- `npm run typecheck`：通过。
- `npm run build`：通过，主进程/preload/renderer 均构建成功。
- `npm run test:web`：10 项通过。
- `npm run test:tools`：工具执行 23 项、缓存统计与前缀 8 项通过。
- `node scripts/plan-mode-smoke.mjs`：70 项通过，包含计划/审批阶段拒写和执行阶段放行。
- `node scripts/agent-team-regression.mjs`：53 项通过。
- `node scripts/agent-team-integration.mjs`：27 项通过，真实 SDK 会话/绑定/隔离，无模型联网调用。
- `npx electron scripts/desktop-regression.mjs`：17 项通过，退出码 0。退出期间 node-pty 子进程仍打印 `AttachConsole failed`；这一终端清理异常未纳入本次功能修正。
- 仓库全量 `git diff --check` 发现既有 `ModelThinkingControl.tsx` 文件尾空行；该文件不属于本轮改动。

应用重启后主会话工具生效。已经安装的 **Agent team** 和 **Plan mode** 是复制到用户目录的插件，需要通过桌面资源安装器重新安装以取得新代码；构建不会自动覆盖用户插件。本轮仅修改目标仓库，没有改用户目录、API key 或另一项目，也没有提交 Git。
