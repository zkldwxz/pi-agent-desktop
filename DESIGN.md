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
| `text-ui-step` | −0.5px | 13 | 步骤行（思考、读取、运行）、工作中短语 |
| `text-ui-caption` | −1px | 12.5 | 侧栏行、行内代码、卡片标题 |
| `text-ui-meta` | −1.5px | 12 | 输入框药丸、回合页脚、代码块 |
| `text-ui-sm` | −2px | 11.5 | 分组标题、次要说明 |
| `text-ui-xs` | −2.5px | 11 | 时间、计数 |
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

## 窗口骨架（baocode 岛屿布局）

- 窗口底色 `bg-canvas`；侧栏直接贴在底色上，没有描边。
- 对话区和右栏各是一张"岛屿"卡片：`rounded-window`（12）、1px `border-line`、
  `bg-page`，到窗口边缘和彼此之间都是 6px。
- 卡片头部 30px：标题 `caption` 中等字重 `ink-2`，标题和操作按钮对齐对话列
  （chat 视图）；侧栏收起时左侧放红绿灯留位和展开按钮；非 macOS 的窗口按钮放在
  最右边那张卡片的头部末尾。macOS 红绿灯 `y: 15`（卡片头中线 21）。
- 侧栏顶部 36px（6 + 30），折叠按钮在右端；收起即整个隐藏。
- **右栏默认关闭**，任何状态变化都不自动打开它。

**间距单位固定 4px**（`--spacing: 4px`），不随根字号缩放：`p-1.5` 就是 6px，
数值直接对应 baocode 源码。

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

- 对话列最宽 720px，滚动区两侧 24px，顶部 12px（带 12px 渐隐），底部 24px。
- 用户卡片和输入框横跨整列、边缘重合；其余所有行内缩 8px。
- 间距：用户消息之前 32px，之后 14px，其余 10px。
- 用户卡片：`bg-field` + `border-line-strong`，圆角 8，内边距 12/10/12/11，吸顶；
  超过 4 行折叠成 3 行，底部 44px 渐隐，中间一个 18px 下箭头。
- 步骤行（思考、工具、过程摘要）：13px `ink-2`，上下 3px；16px 右箭头放在文字后面，
  悬停或展开时出现，展开转 90°。思考展开正文 13px / 1.6 `ink-2`，无竖线。
- 过程摘要："读取 **2** 个文件，运行 **1** 条命令 · 思考 3 秒"。
- 回合页脚**常显**：复制按钮 + 时长 / 速度 / 费用 / tokens，lucide 12 + 12px `ink-4`，间距 12。
- 工作中：赤陶色 ✻ 火花（`text-spark`，每 120ms 换形、12 秒转一圈）+ 13px 短语。
- Markdown：段落 13.5 / 1.6，块间 8px，h1–h3 前 12px；列表标记列 18 / 24；
  表格贴合内容宽度、内外 1px `code-border`、表头 `bg-canvas` 半粗体；
  引用是卡片（`bg-code-block`，12/8/36/8）；代码块有语言时带标题栏（折叠、语言名、复制）。
- 输入框：编辑区 12/10/12/2、最小 48px；工具栏 6/4/6/6；上下文环 13px（底圈 `ink-4`、
  弧 `ink-2`）；发送键 24px 琥珀圆。没有听写按钮。
- **工具栏控件一律用 `ComposerPill`**（`components/agent/ComposerPill.tsx`）：22px、全圆角、
  左 6 右 3、图标 13、`text-ui-meta` `ink-2`、有菜单时 15px `ink-4` 下拉箭头；悬停 `bg-hover`，
  打开 `bg-hover-2`。顺序：`+` → 模式（`emphasized`，`--pill-emphasis` 底色 + 1px 线，
  常驻"智能体 / 计划 · 状态"）→ 模型（厂商 logo + "模型 · 强度"；只有别的上游也有同名模型
  时才在前面加上游名，与 baocode `SessionModelPicker._label` 一致）。
  风险项用 `caution`（`text-orange`）。不要在工具栏里另做彩色徽章。
- 药丸弹出的菜单用 `PickerMenu`：药丸上方 6px，`bg-surface` + `shadow-overlay`，圆角 8，
  内边距 4；有描述的行 40px、否则 30px，圆角 5，图标 15、间距 10、标签 12.5、描述 11；
  选中打勾；140ms 从 0.96 放大进入。
- 模型菜单（`ModelThinkingControl`）：宽 260；≥10 个模型时顶部搜索；按上游分组，组标题 11px
  `ink-4`、吸顶、除第一组外上方 1px 线；行 30px = logo 15 + 名称 12.5，当前项打勾，有强度的行带 ›，
  悬停在右侧弹出"强度"二级菜单（28px 行）；底部"管理模型…"打开 设置 ▸ 模型。空上游不显示。
- 厂商 logo：`components/BrandLogo.tsx` + `lib/model-brand.ts`（移植 baocode `model_brand.dart`：
  先按模型名关键词，再按 API 域名，再按 pi 的 provider id）；图标在 `assets/model-icons/`，单色跟随文字。
- 运行中的命令不做药丸，放在输入框上方的**活动条**（`ActivityStrip`，baocode activity_strip）：
  左右缩进 10、`bg-field` + 1px `line-strong`、圆角 10；28px 行 = 终端图标 14 `ink-4` + 等宽命令
  `text-ui-sm` + "运行中 · Ns" `ink-2` + 停止；≥4 条折叠；最多 4 行可见。pi 只能停整轮，停止按钮如实写"停止本轮运行"。

## 侧栏（baocode 度量）

- "新对话"：30px、`rounded-control`、`bg-page` + 1px `line`，图标 16、文字 12.5。
- 导航行（搜索、扩展管理）：22px、圆角 5、codicon 15 `ink-2`、间距 8、文字 12.5；不显示快捷键。
- 分组标题："工作区" 11.5 中等字重 `ink-4`，左 14px。
- 项目行：上间距 6 + 26px，chevron 15（收起 0°、展开 90°），名称 12.5 中等字重；收起时显示计数 11px。
- 会话行：22px、左右 4px 外边距、左 8 右 4 内边距、状态位 14 + 6；标题 12.5，未读加粗；
  时间 11px `ink-4` 最小宽 26 右对齐；选中 `bg-accent-tint`。
- 底部：无分隔线，26px 一行，只有设置齿轮（无头像、无用户名）。
- 实测：导航与会话文字 x=38，右侧时间距右边 14。

## 设置页（baocode settings_dialog / settings_widgets）

- 骨架：导航 240px 用侧栏底色（顶部 36px 留给红绿灯），页面用正文底色铺满到窗口边缘，
  两者之间一条 1px `line`——**设置页不是岛屿卡片**（baocode settings_dialog: 侧栏旁的编辑器）；
  没有"设置 · 写入 …"之类的全局标题行，每页内容顶部是自己的标题（`text-ui-xl` 半粗体）
  和一行说明（`PAGE_NOTE`）。内容最宽 720 + 两侧 32。
- 导航：返回 + 28px 搜索（6% 底、8% 线、圆角 6）；导航项 30px、圆角 6、图标 15、文字 13；
  选中和悬停都用 6% 前景色；分组之间留 14px，**不写分组小标题**。
- 分组 `Section`：标题 12.5 中等字重 `ink-2` 放在卡片**外面**上方（左 8px）；组间 20px。
- 卡片 `SettingsCard` / `Card`：圆角 12，无边框，`bg-settings-card`（正文底叠 4% 前景色）；
  行间 1px 4% 前景色、左右缩进 12px。
- 行 `Row`：内边距 14/12；标签 13 / 1.4 `ink`，说明 12 / 1.5 `ink-2`；控件在右，间距 20；
  需要预览时用 `below`。
- 控件：`Switch` 28×16 琥珀（关时淡灰）；`Select` 26px、圆角 6、`bg-page` + 1px `line-strong`
  （dropdown.background / dropdown.border，卡片上读作白底）；输入框 26px、圆角 5、`bg-page` + 1px
  `input-line`、等宽 12、聚焦变强调色；按钮 24px、圆角 4。
- 文字灰阶用 baocode 的 SettingsColors：说明、分组标题、导航未选中 `text-settings-muted`（74%），
  分组说明 `text-settings-faint`（60%），未选中图标 `text-settings-icon`（52%）。
- 值列不显示内部标识（函数名、分区名、API 名），下拉选项必须有人话标签。
