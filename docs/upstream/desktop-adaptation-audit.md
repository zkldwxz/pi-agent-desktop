# pi 1.0.0 桌面端接入核对（2026-10-02）

当前依赖是 `@earendil-works/pi-coding-agent@1.0.0`，npm 查询最新也是 1.0.0。远端应用仓库已 fetch，master 与 origin/master 均是 d6627fe；后续修改保留在工作区，尚未提交。

上游 changelog、40 篇文档与从 npm sourcemap 恢复的 TS 源码位于 `docs/upstream/pi-coding-agent-1.0.0`。Zcode 官方完整源码快照位于 `docs/upstream/zcode/source.tar.gz`，提交与更新时间记录在 manifest；通过 `npm run vendor:zcode` 更新。

## 已接入并验证

- Rules：创建、读取、编辑、保存、删除到回收目录。保存后重载资源，避免 prompt template 仍使用旧内容；限制管理目录和编辑大小，拒绝越界与管理根目录操作。
- 模型：新增、编辑、自定义模型删除、渠道/Key 管理已有；内建模型通过启停控制可见性。设置页顶部搜索模型名/ID/provider/渠道，默认平铺、自定义优先（显式选择的渠道分组会保留），列表 52vh 限高滚动。自定义空渠道可搜索。
- MCP：主会话显式注入 MCP、codemode、tool_search 工厂；管理 stdio/HTTP server，增删改、启停、exposure、login/logout/reconnect，工具开关通过 defaultTools 的增量配置。配置损坏时拒绝覆盖，并校验 namespace 冲突。
- MCP 聊天：服务器/工具名称、参数、JSON、文本、图片、资源、错误与复制；二层详情只有一个滚动边界。MCP 内容块在主进程转成有界 IPC 展示数据，实时输出上限由 400 字符提高到 128KiB。
- pi 1.0 中 codemode 描述瘦身、MCP 懒连接、OAuth issuer 校验与 scope 合并、工具搜索恢复、模型查找性能等，由升级的 SDK 实现提供；桌面未重新实现这些逻辑。
- Web 搜索：免 key Tavily、DuckDuckGo 回退、自托管 SearXNG；直接抓取网页正文。保留缓存 TTL/内存预算、并发合并、快照分页、取消隔离和静态工具描述。
- 真实 SSH 与多文件夹工作区：见 `docs/ssh-workspaces.md`。本机 SDK 操作远端文件与 shell，不部署远端 pi 服务。

## 仍没有完整桌面管理界面的新版能力

- MCP 的 `oauth.clientName`、`oauth.authServerMetadataUrl`、`auth.provider`、`toolExposure`、stdio `cwd` 等完整高级字段；已有文件的额外配置应保留，通过 mcp.json 设置。
- 项目 MCP 信任管理。SDK 按 trust 决定是否加载项目配置，列表中出现一项不代表已获信任或已连接。
- MCP 独立连接状态事件与 OAuth 进度/取消 UI。当前管理页通过已注册 namespace 判断工具可用；无工具服务器和掉线服务器不能靠它精确判断连接。
- Radius 一键登录并生成 MCP 配置、Anthropic copy-code 专属登录页。底层 SDK 支持，但桌面没有完整引导。
- 图像生成模型/分类模型独立管理，以及 virtual model 路由后的模型与成本展示。当前模型管理依旧针对 chat 模型。
- codemode 的模型调用成本、持久化 nestedCalls 的完整树状详情。普通 MCP 调用卡片可展示，嵌套模型调用还需专门设计。
- 内建扩展 disable 的全套配置管理、llama.cpp 下载/加载/自动 preset 管理。现有 codemode/tool_search 开关只控制工具启停。
- 新版图像输入限制、模型 operation 类型、context editing 等高级配置的专用表单。

这些是接入缺口；SDK 支持与桌面有可用入口是两件分别验证的事。纯 TUI 的 fullscreen、终端主题/quietStartup/鼠标滚轮配置不对应 Electron 界面，不需要迁移。

## 验证

已实际执行类型检查与模型（17）、MCP（24）、Web（19）、工具策略（26）/缓存用量（8）、工作区（28）、团队（53+27）、图表（12）回归，全部通过。浏览器检验模型列表 52vh 限高、平铺自定义优先、搜索空态/Escape 清空、Rules 新建后编辑保存重读删除、MCP 二层 JSON/图片/资源/错误以及工作区/SSH 表单。工作区切换菜单的 DOM 嵌套错误已修复。开发 Electron 已重启加载新的主进程与 preload。

独立复核补修了远端工作区删除后掉回本机、切换目录静默中止任务、连接进度串号、本机打开入口指向远端会话锚点、计划面板读取位置错误，以及删除连接导致旧会话无法恢复的问题。远端 metadata 缺失和仍被使用的连接删除现在明确失败。真实 SSH 测试使用本地临时 SSH 服务和真实 pi SDK，协议通道是真实连接，服务器文件/命令回复使用受控 fixture；用户服务器、私钥认证/SSH agent、真实远端 Git、OAuth 与自托管 SearXNG 尚无凭据环境，不能声称已经外部端到端验证。
