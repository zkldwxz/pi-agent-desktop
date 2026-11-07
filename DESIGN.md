# DESIGN — 界面设计约定

`AGENTS.md` 的工程规则在这里落成具体的视觉契约。新组件先查这份；改动
token 只动 `src/renderer/src/index.css`，不要在组件里发明新值。

## 尺寸：字号

只允许 `text-ui-*` 八档，全部由 `--ui-font-size`（默认 14px）推导：

| token | 相对基准 | 用途 |
| --- | --- | --- |
| `text-ui-display` | +7px | 首页问候语、大标题 |
| `text-ui-xl` / `text-ui-stat` | +4px | 区块标题、统计数字 |
| `text-ui-lg` | +2px | 弹窗/页面标题 |
| `text-ui-base` | 0 | 正文、dock 面板主字号 |
| `text-ui-caption` | −1px | 行内标题、按钮、表单标签 |
| `text-ui-sm` | −2px | 次要说明、文件列表 |
| `text-ui-xs` | −4px | 元信息、徽标、状态字 |
| `text-ui-2xs` | −5px | 最小标注（少用） |

**禁止** `text-[13px]` 之类的任意字号——历史上 691 处已清完。px 值
仅用于几何（高度、间距、圆角），不用于文字。

## 形状：圆角

`rounded-tiny | chip | control | card | window`（小→大）。例外仅两类：
自身尺寸 ≤12px 的元素按自身比例取（状态点、热力格）；composer 主壳
与流程图节点这类 hero 形状。

## 色彩

全部走 CSS 变量对应的 Tailwind 色名，不写字面量：

- **墨水**：`text-ink`（最强）、`ink-2`、`ink-3`、`ink-4`（最弱）
- **面**：`bg-page`（窗口底）、`bg-canvas`（面板底）、`bg-surface`（卡片）、`bg-field`（输入/嵌套底）
- **线**：`border-line`、`border-line-strong`、`shadow-hairline`（卡片描边阴影）、`shadow-card`、`shadow-overlay`
- **交互**：`bg-hover`（悬停）、`bg-hover-2`（悬停上的悬停）
- **语义**：`text-accent`/`bg-accent`/`bg-accent-tint`/`text-on-accent`，`text-green`/`bg-green-tint`，`text-red`/`bg-red-tint`，`text-orange`/`bg-orange-tint`
- **Max 思考深度高亮**：`--hot*` 色板（原 Ultra 色板改名）

## 动效

曲线只用三条：`var(--ease-out-strong-css)`（进入）、
`var(--ease-in-out-strong-css)`（对称变换）、`var(--ease-link-css)`
（首页长 reveal）。`ease-out-strong` / `ease-in-out-strong` /
`ease-link` 工具类已存在；**不在 TSX 里内联 cubic-bezier 字面量**。

命名动画（index.css 里）：`fade-in`、`fade-up`、`pop-in`、
`view-enter`、`row-enter`（列表错峰进入，按 `index * 25-35ms` 延迟）、
`slide-down`、`slide-in-right`、`home-reveal`、`step-settle`、
`chart-draw`、`picked-wash`。

新面板/卡片进入动效用 `view-enter` 或 `row-enter`；右侧面板滑入用
`animate-slide-in-right`；删除/危险确认一律"两次点击武装"（arm 一
次再点一次执行），不用原生确认框。

## 排版细节

- 数字用 `font-mono tabular-nums`（token 数、时间、成本、分支统计）。
- 路径、命令、分支名、模型 key 用 `font-mono`。
- 截断一律 `truncate`/`line-clamp-*` + `title` 提示全文；设置行 hint
  允许换行（`leading-snug`），说明文字不截断。
- 图标用 `components/icons.tsx` 的 `wrap(lucide)` 导出 + `size` prop；
  新图标进 icons.tsx 集中导出，不散落 svg（原创小图除外）。

## 窗口骨架

- **一行 header**（`App.tsx` 顶部 `<header>`，`h-10`）同时是标题栏和工具条：
  macOS 红绿灯留位（`TRAFFIC_LIGHTS_WIDTH`）→ 侧栏开关 → 当前会话标题 →
  工具按钮 → 非 macOS 的窗口按钮（`WindowControls`）。不要再在它下面加第二条
  工具条，新的全局按钮放进这一行或收进菜单。
- **右栏默认关闭**，任何状态变化（子智能体、计划待审）都不自动打开它；入口是
  header 的 dock 开关和输入框里的徽章。
- 侧栏顶部是"新对话"主按钮（`bg-surface shadow-hairline`），其余入口是普通行。

## 字体

UI 用系统字体（`--font-inter`：SF Pro / Segoe UI Variable / system-ui，
后接 `--font-cjk`），不再打包 Geist 正文字体；代码用打包的 Geist Mono，
用户可在 设置 ▸ 外观 ▸ 代码字体 覆盖（`--font-mono-face`）。

## 面板规范

- dock 面板 header：`h-[40px] border-b border-line px-[12px]`，标题
  `text-ui-base`，计数 `font-mono`。
- 行容器：`rounded-chip`，hover `bg-hover`，选中 `bg-surface
  shadow-hairline` 或 `bg-accent-tint`。
- 区块标题：`SectionLabel` 模式——`text-ui-sm tracking-[0.3px]
  text-ink-3 mt-4 mb-1.5`。
- 空态两行：`text-ui-sm text-ink-3` 主句 + 更弱一行解释。
- 滚动条：`scrollbar-thin`（内容区）、`scrollbar-pill`（主 transcript）。

## 文案

英文源串进 `t()`/`tf()`，中文译文同步加到
`src/renderer/src/lib/i18n.ts`。复数/数量用 `tf("{count} ...")`。
新增串必须先查词典里是否已有同义 key（`Connected`、`Done`、`Failed`
这类已存在）。
