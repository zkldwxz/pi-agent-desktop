# DESIGN — 界面设计约定

`AGENTS.md` 的工程规则在这里落成具体的视觉契约。新组件先查这份；改动
token 只动 `src/renderer/src/styles/foundation-body.css`（颜色、圆角、阴影）
和 `src/renderer/src/index.css`（字号、字体、图表色），不要在组件里发明新值。

**基准是 baocode 的 Bao Light / Bao Dark 主题与组件度量**（来源：
`packages/bao_editor/.../theme-bao/*.json`、`lib/theme/app_theme.dart`、
`lib/chat/`）。数值有出入时以 baocode 为准，只在"呼吸感"上放宽（如会话行
28px，baocode 22px）。

## 尺寸：字号

只允许 `text-ui-*` 八档，全部由 `--ui-font-size`（默认 13.5px，baocode
的聊天正文字号）推导：

| token | 相对基准 | 默认 | 用途 |
| --- | --- | --- | --- |
| `text-ui-display` | +7px | 20.5 | 首页问候语、大标题 |
| `text-ui-xl` / `text-ui-stat` | +4px | 17.5 | Markdown h1、统计数字 |
| `text-ui-lg` | +2px | 15.5 | Markdown h2、弹窗/页面标题 |
| `text-ui-base` | 0 | 13.5 | 对话正文、用户卡片、输入框 |
| `text-ui-caption` | −1px | 12.5 | 侧栏行、行内代码、按钮、表单标签 |
| `text-ui-sm` | −2px | 11.5 | 输入框药丸、次要说明、代码块 |
| `text-ui-xs` | −3px | 10.5 | 时间、计数、元信息 |
| `text-ui-2xs` | −4px | 9.5 | 最小标注（少用） |

行高：对话正文与列表 1.6，用户卡片与输入框 1.5，标题 1.4。

字体：界面用系统字体（SF Pro / Segoe UI，后接中文栈）；代码用
`JetBrains Mono → Fira Code → Menlo → Consolas → Cascadia Mono`，
最后兜底打包的 Geist Mono。

**禁止** `text-[13px]` 之类的任意字号——历史上 691 处已清完。px 值
仅用于几何（高度、间距、圆角），不用于文字。

## 形状：圆角

`rounded-tiny | chip | control | card | window`（小→大），对应 baocode：

| token | 值 | 用途 |
| --- | --- | --- |
| `rounded-tiny` | 4 | kbd、小徽标 |
| `rounded-chip` | 6 | 列表行、图标按钮、菜单行 |
| `rounded-control` | 8 | 按钮、"新对话"、输入控件 |
| `rounded-card` | 8 | 用户卡片、代码块、表格、菜单、卡片 |
| `rounded-window` | 12 | 输入框外壳、大面板 |
| `rounded-full` | — | 输入框药丸（22px 高）、发送键（24px 圆） |

行内代码 3px。自身 ≤12px 的元素按自身比例取（状态点、热力格）。

## 色彩

全部走 CSS 变量对应的 Tailwind 色名，不写字面量：

- **墨水**：`text-ink`（foreground）、`ink-2`（description）、`ink-3`（占位）、`ink-4`（disabled）
- **面**：`bg-page`（正文区，editor.background）、`bg-canvas`（侧栏/标题栏，sideBar.background）、
  `bg-surface`（浮层卡片）、`bg-field`（用户卡片、输入框、药丸，agentsChatInput）
- **线**：`border-line`（1px 分隔）、`border-line-strong`（用户卡片/输入框边框，bubbleBorder）
- **代码**：`bg-code-block` + `border-code-border`（代码块）、`bg-code-inline`（行内代码）
- **交互**：`bg-hover`、`bg-hover-2`（半透明暖灰，叠在任何面上）
- **强调**：琥珀色。`bg-accent`/`text-accent`（状态点、进度）、`bg-button` + `text-on-accent`
  （主按钮、发送键）、`bg-accent-strong`（按钮悬停）、`text-accent-ink`（链接）、`bg-accent-tint`（选中行）
- **语义**：`green`/`red`/`orange`（git 增删、警告）及其 `-tint`
- **Max 思考深度高亮**：`--hot*` 色板
- **图表**：`--chart-1` 是强调色，热力图色阶从强调色派生

**描边不用阴影**：卡片、用户卡片、输入框一律 1px 线；只有浮层（菜单、弹出层）
用 `shadow-overlay`（1px 线 + `0 0 12px` 柔光）。

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

- 数字用 `tabular-nums`；只有代码、路径、命令才用 `font-mono`（时间、计数不再用等宽）。
- 路径、命令、分支名、模型 key 用 `font-mono`。
- 截断一律 `truncate`/`line-clamp-*` + `title` 提示全文；设置行 hint
  允许换行（`leading-snug`），说明文字不截断。
- 图标用 `components/icons.tsx` 的 `wrap(lucide)` 导出 + `size` prop；
  新图标进 icons.tsx 集中导出，不散落 svg（原创小图除外）。

## 窗口骨架

- **一行 header**（`App.tsx` 顶部 `<header>`，`h-8` 即 32px，macOS 红绿灯 `y: 10`）同时是标题栏和工具条：
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

## 对话流（baocode 度量）

- 对话列居中，最宽 752px（含两侧 16px 内边距）；用户卡片和输入框外壳左右边缘重合，
  卡片内文字、输入框文字、回答正文从同一条线开始（脚本实测误差 ≤1px）。
- 间距：用户消息之前 32px，之后 14px，过程行/回答之间 10px。
- 用户卡片：`bg-field` + `border-line-strong`，圆角 8，内边距 12/10/12/11，
  吸顶，超过 3 行折叠。
- 过程摘要一句话："读取 **2** 个文件，运行 **1** 条命令 · 思考 3 秒"，数字加粗，思考时长用 `ink-4`。
- 回合页脚（时长、tokens、缓存命中）悬停才显示，浮在下一回合的间距里，不占高度。
- 输入框：`bg-field`、1px `line-strong` 边框、圆角 12，无阴影；聚焦时边框向强调色偏 25%。
  工具栏药丸 22px 高、全圆角、`text-ui-sm` `ink-2`；发送键 24px 琥珀圆，停止为 8px 方块。
- 用量指示（`UsageIndicator`）：上下文、缓存命中、套餐额度合在一个药丸里；
  套餐额度已用 ≥70% 橙、≥90% 红。

## 侧栏（baocode 度量）

- 左边线：图标 x=14，文字 x=34；右侧时间/计数距右边 14.5px（脚本实测）。
- "新对话"：30px 高、`rounded-control`、`bg-page` + 1px `line`。
- 导航行 30px、工作区行 30px（名称 `caption` 中等字重）、会话行 28px（`caption`，未读加粗）。
- 计数只在工作区收起时显示；悬停操作浮在行上，不占宽度。
- 选中会话用 `bg-accent-tint`。
