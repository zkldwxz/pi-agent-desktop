# Pi Agent Desktop — 工程约定

给在这个仓库里干活的编码 agent（和人）看的。改代码前先读这里；本文件描述的是**当前仓库真实存在**的东西，不写愿望。

## 命令

从仓库根执行。包管理是 **npm**（只有 `package-lock.json`，没有 pnpm/yarn 锁文件）。Node ≥ 24（原生 TS 类型擦除，测试不需要构建）。

| 用途 | 命令 |
| --- | --- |
| 开发（Electron + vite） | `npm run dev` |
| 类型检查 | `npm run typecheck` |
| 模型管理回归 | `npm run test:models` |
| 工具策略 + 缓存用量回归 | `npm run test:tools` |
| Web 工具链回归 | `npm run test:web` |
| 图表几何回归 | `npm run test:charts` |
| Agent 团队回归 | `npm run test:agent-team` |
| 网络冒烟（真实外网请求） | `npm run smoke:web` |
| 打包当前平台安装包 | `npm run pack` |

**没有 lint、没有格式化器、没有 git hook。** 别假设 `pnpm lint` 存在。

## 分层

```
src/main/       Electron 主进程：窗口、pi runtime、pty、fs、git、web、usage
src/preload/    唯一的 IPC 桥（PiBridge 接口 = 两进程的唯一契约）
src/renderer/   React 19 + Tailwind v4
src/shared/     跨层复用的类型与纯函数
```

- 渲染进程**只**通过 `window.pi`（`src/preload/index.ts` 的 `PiBridge`）访问能力，不 require 主进程模块。`vite-env.d.ts` 里的类型导入是例外。
- 主进程不碰渲染层任何东西。
- 只有被纯 node 加载器直接 import 的模块（如 `src/main/model-config.ts`、`serialize.ts`）里，从 `src/shared` 引**值**必须用相对路径带扩展名：`from "../shared/channel.ts"`。`@shared/*` 别名只有 vite 认识，`scripts/*-regression.mjs` 用 `await import()` / jiti 加载时会 `ERR_MODULE_NOT_FOUND`。纯 `import type` 不受影响（会被擦除）。
- 渠道身份（`${api}|${baseUrl}`）的唯一归属是 `src/shared/channel.ts`。写入方、`pi-host` 的分组、浏览器预览 mock 三处都调它，不要再抄第四份公式。

## 平台

开发机是 macOS arm64，出货目标是 Windows NSIS。**平台差异一律分支，不做替换。**

- 分支条件：主进程用 `process.platform === "darwin"`；渲染进程用 `src/renderer/src/lib/platform.ts` 的 `IS_MAC` / `IS_WINDOWS`（`keybindings.ts` 也走 `navigator.platform`，别另起一套判断）。
- 窗口：macOS 保留原生红绿灯（`titleBarStyle: "hidden"` + `trafficLightPosition`），渲染层不画标题栏、`TitleBar` 直接 `return null`，拖拽区交给顶部工作条；Windows/Linux 用 `frame: false` + 自绘三个按钮。
- 默认工作目录按平台探测（macOS `~/Projects`，Windows `F:/Projects`），谁的存在用谁。
- 新增 OS 相关行为时，两条路径都要想过；`shells.ts`、`pty.ts`、`openers.ts` 是现成范例。

## 界面

- 字号只能用 `text-ui-*` 八档（`src/renderer/src/index.css` 的 `@theme inline`，全部由 `--ui-font-size` 推导）。**不要写 `text-[13px]`** —— 历史上那 691 处刚清完。
- 圆角用 `rounded-tiny|chip|control|card|window`。仅两类例外允许任意值：自身尺寸 ≤12px 的元素（热力图小格、状态点）按自身比例取；composer 主壳与流程图节点这类 hero 形状。
- 动效曲线用 `var(--ease-out-strong-css)` / `--ease-link-css` / `--ease-in-out-strong-css`，不要在 TSX 里内联 `cubic-bezier(...)` 字面量。
- 界面文案默认中文：英文源串走 `t()` / `tf()`，新串**必须同时补 `src/renderer/src/lib/i18n.ts` 的词典**，否则中英混排。
- 图标是 codicon 字体字形（`src/renderer/src/components/icons.tsx` 的 `make(name)`）。用名字前先确认 `@vscode/codicons` 里有——`sun`/`moon` 没有，所以 `SunIcon`/`MoonIcon` 目前同为 `color-mode`。缺图标就画原创 SVG 或换名字，不要拿别的字形凑。

## models.json 与密钥

- 路径 `~/.pi/agent/models.json`，Pi CLI 读同一份；写入统一走 `src/main/model-config.ts`，写前留 `.bak`。
- pi 每个 provider 只能有一把 key，所以「一个渠道多把 key」= 多个共享 `api`+`baseUrl` 的 provider 条目。模型属于端点：`writeModelEdit` / `removeModelFromFile` 会向该渠道**所有成员扇出**。
- 表单里留空读回是 `0`，`0` 表示「没人说过」，不是「设成 0」——`contextWindow` / `maxTokens` 为 0 时不覆盖已存值。
- `apiKey` 只在主进程存在，`sanitizeProvider` 负责剥掉，任何 IPC 载荷和日志都不带凭据。

## 注释与验证

- 注释解释**为什么**：隐藏约束、微妙的不变量、某个 bug 的绕法。代码本身说清楚「是什么」。不写引用当前任务或 PR 的注释。
- 修 bug 时在改动处说明成因和依据（本仓库现有注释基本都是这个写法，英文）。
- 有行为改动就补/跑对应回归脚本；交互改动用浏览器预览桥（`src/renderer/src/lib/preview-bridge.ts`，`http://localhost:<vite 端口>`）在真实 Chromium 里验证。
- 必须实际执行 `npm run typecheck` 和相关 `test:*` 并**报告真实结果**；没跑成的、环境受限的，如实说明，不把已有失败写成通过。
- 验证脚本放 `.qa/`（已 gitignore），别污染仓库根。

## 已知缺口

没有 lint / 格式化 / CI / git hook；没有 `DESIGN.md`（设计 token 目前只散在 `index.css` 的注释里）；Tavily key 只从 `process.env` 读，打包后从 Dock/开始菜单启动会读不到。
