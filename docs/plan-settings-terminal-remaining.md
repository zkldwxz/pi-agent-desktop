# 剩余工作执行计划：设置页（代码主题 + 终端 Shell）

> 交接文档。接手者按任务 A→G 顺序执行即可，每个任务给出精确文件与可直接粘贴的代码。
> 项目根：`F:\Projects\pi-agent-desktop`。所有相对路径基于根。
> 完成后运行 `npm run typecheck` 必须零错误。

## 背景：这次改动要达成什么

用户对设置 UI 提出三点：
1. 整体排版不舒服（间距/比例/文字）——已打磨。
2. 主题区新增"代码显示风格"：可切换的代码配色主题，下方放两个预览（code 样式 + diff 样式）——后端与设置 UI 已完成，剩 i18n。
3. 终端 Shell 切换参考 pi：不做强制默认，内置快速切换（WSL、Git Bash、cmd、PowerShell、自定义地址）——主进程已完成，剩 preload + 设置 UI + 终端面板菜单 + i18n。

## 已完成（不要重做）

| 内容 | 文件 |
|---|---|
| Row/Select 排版打磨（hint 换行不截断、行距、控件最小宽） | `src/renderer/src/components/panel/SettingsParts.tsx` |
| 设置内容列节奏（gap-8、px-8、max-w-720） | `src/renderer/src/views/SettingsView.tsx` |
| hljs 主题 CSS 变量化（GitHub/One/Dracula，各含明暗） | `src/renderer/src/styles/hljs-themes.css`（`hljs-github.css` 已删除，`index.css` 已改引用） |
| 代码主题状态（localStorage + `<html data-code-theme>`） | `src/renderer/src/lib/code-theme.ts` |
| AppearanceSection 的 Code style 区（选择器 + Code/Diff 双预览，diff 行级 tint） | `src/renderer/src/components/panel/AppearanceSection.tsx` |
| SettingsView 的 codeTheme state 并传入 AppearanceSection | `src/renderer/src/views/SettingsView.tsx` |
| 启动时应用持久化主题 | `src/renderer/src/main.tsx` |
| Shell 探测与解析（WSL 发行版 UTF-16 处理、Git Bash、PowerShell、cmd、custom） | `src/main/shells.ts` |
| `TerminalShell` 共享类型 | `src/shared/terminal.ts` |
| desktop.json 的 `terminal` 配置块（preferred/customPath）读写 | `src/main/install.ts` |
| `DesktopConfig.terminal` / `RuntimeSettings.terminal` 类型 | `src/shared/types.ts` |
| pi-host 镜像 terminal 设置 + updateSettings 处理 patch | `src/main/pi-host.ts` |
| pty.spawn 接受 `{path, args, name}` | `src/main/pty.ts` |
| IPC：`shells:list`、`pty:spawn(cwd, shellId?)` | `src/main/index.ts` |

---

## 任务 A：index.ts 补 import（必须先做，否则编译失败）

`src/main/index.ts` 顶部 import 区（第 11 行 `import { applyCatalog, ... } from "./install";` 附近）加：

```ts
import { discoverTerminalShells, resolveTerminalShell } from "./shells";
```

（第 447 行附近的新 handler 已引用这两个函数，只缺 import。）

## 任务 B：preload 暴露新 API

文件：`src/preload/index.ts`

1. 类型声明区（`PiBridge` 接口内，找到现有 `spawnPty` 声明）改为：

```ts
  /** list the shells this machine offers + which id the preference resolves to */
  listShells: () => Promise<{ shells: TerminalShell[]; resolvedId: string | null }>;
  /** open a terminal; shellId omitted = the preference chain, "custom" = the custom path */
  spawnPty: (cwd: string, shellId?: string) => Promise<PtySession | { error: string }>;
```

2. 文件顶部已有 `import type { PtySession } from "@shared/terminal";`——在同一行加 `TerminalShell`：

```ts
import type { PtySession, TerminalShell } from "@shared/terminal";
```

3. `api` 对象实现区，把现有 `spawnPty: (cwd) => ipcRenderer.invoke("pty:spawn", cwd),` 替换为：

```ts
  listShells: () => ipcRenderer.invoke("shells:list"),
  spawnPty: (cwd, shellId) => ipcRenderer.invoke("pty:spawn", cwd, shellId),
```

## 任务 C：SettingsView 终端区重做

文件：`src/renderer/src/views/SettingsView.tsx`

### C1. 顶部补 import

```ts
import type { TerminalShell } from "@shared/terminal";
```

### C2. 组件内加状态（放在现有 `budgetDraft` state 附近）

```tsx
  /* the terminal pane's shell choices, probed once when this view mounts */
  const [shellChoices, setShellChoices] = useState<TerminalShell[] | null>(null);
  const [resolvedShellId, setResolvedShellId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.pi
      .listShells()
      .then((result) => {
        if (cancelled) return;
        setShellChoices(result.shells);
        setResolvedShellId(result.resolvedId);
      })
      .catch(() => setShellChoices([]));
    return () => {
      cancelled = true;
    };
  }, []);
```

选择处理（放在上面 state 之后）：

```tsx
  const terminal = settings.terminal;
  const pickShell = (preferred: string) => {
    void window.pi.updateSettings({ terminal: { preferred, customPath: terminal?.customPath } }).catch(() => undefined);
  };
  const setCustomShellPath = (customPath: string) => {
    const trimmed = customPath.trim();
    void window.pi
      .updateSettings({
        terminal: {
          preferred: trimmed ? "custom" : (terminal?.preferred === "custom" ? "auto" : (terminal?.preferred ?? "auto")),
          customPath: trimmed || undefined,
        },
      })
      .catch(() => undefined);
  };
```

### C3. 替换整个 `{category === "terminal" ? (...) : null}` 块

现状是一个 `<Section title={t("Shell")}>` 包含 4 行（Shell path / Command prefix / npm command / Panel）。替换为两个 Section（保留后 4 行原文搬进第二个）：

```tsx
          {category === "terminal" ? (
          <>
          <Section
            title={t("Default shell")}
            index={0}
            actions={
              resolvedShellId ? (
                <span className="font-mono text-[10.5px] text-ink-3">
                  {shellChoices?.find((shell) => shell.id === resolvedShellId)?.name ?? resolvedShellId}
                </span>
              ) : undefined
            }
          >
            <div className="border-b border-line bg-canvas/40 px-4 py-1.5 text-[10.5px] tracking-[0.4px] text-ink-3 uppercase">
              {t("Discovered on this machine — the + button opens the default")}
            </div>
            {/* Auto row */}
            <div data-row className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
              <ShellRadio active={!terminal?.customPath && (terminal?.preferred ?? "auto") === "auto"} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-snug text-ink">{t("Auto")}</div>
                <div className="mt-1 text-[11px] leading-snug text-ink-3">{t("the first shell this machine offers")}</div>
              </div>
              <button
                type="button"
                onClick={() => pickShell("auto")}
                className="pressable h-7 rounded-control bg-field px-2.5 text-[11.5px] text-ink-2 hover:text-ink"
              >
                {t("Use")}
              </button>
            </div>
            {(shellChoices ?? []).map((shell) => {
              const active = !terminal?.customPath && terminal?.preferred === shell.id;
              return (
                <div key={shell.id} data-row className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
                  <ShellRadio active={active} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] leading-snug text-ink">{shell.name}</span>
                      {shell.id === resolvedShellId && !terminal?.customPath ? (
                        <span className="text-[10px] uppercase tracking-wide text-accent">{t("current")}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] leading-snug text-ink-3">
                      {shell.args.length ? `${shell.path} ${shell.args.join(" ")}` : shell.path}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => pickShell(shell.id)}
                    className="pressable h-7 rounded-control bg-field px-2.5 text-[11.5px] text-ink-2 hover:text-ink"
                  >
                    {t("Use")}
                  </button>
                </div>
              );
            })}
            {/* Custom row */}
            <div data-row className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <ShellRadio active={Boolean(terminal?.customPath)} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-snug text-ink">{t("Custom path")}</div>
                <div className="mt-1 text-[11px] leading-snug text-ink-3">{t("an absolute path to any shell executable")}</div>
              </div>
              <input
                defaultValue={terminal?.customPath ?? ""}
                onBlur={(event) => setCustomShellPath(event.target.value)}
                placeholder="D:/Git/bin/bash.exe"
                className="h-7 w-56 rounded-control bg-field px-2 font-mono text-[11px] text-ink outline-none"
              />
            </div>
          </Section>

          <Section title={t("Agent shell")} index={1}>
            <Row title={t("Agent shell path")} hint={t("the bash the agent's own commands run in — must be bash-compatible; the terminal pane's choice above is separate")}>
              <input
                defaultValue={settings.shellPath ?? ""}
                onBlur={(event) => onUpdate({ shellPath: event.target.value.trim() })}
                placeholder="D:/Git/bin/bash.exe"
                className="h-7 w-56 rounded-control bg-field px-2 font-mono text-[11px] text-ink outline-none"
              />
            </Row>
            {/* ↓ 下面三行从原 Section 原样搬过来，不改 */}
            <Row title={t("Command prefix")} hint={t("prepended to every command the agent runs")}>
              ...原内容...
            </Row>
            <Row title={t("npm command")} hint={t("argv used for package lookups; comma separated")}>
              ...原内容...
            </Row>
            <Row title={t("Panel")} hint={t("the Shell panel runs through the agent's bash tool, so output joins the conversation")}>
              <span className="font-mono text-[11px] text-ink-3">session.executeBash</span>
            </Row>
          </Section>
          </>
          ) : null}
```

注意：`...原内容...` 处保留现有 JSX 原文（npm command 那行的 input 有逗号切分逻辑，照搬）。

### C4. 单选圆点小组件

放在 SettingsView 文件底部（组件函数外）：

```tsx
/** The settings' own radio mark — a ring with a dot, matching the Switch's weight. */
function ShellRadio({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={
        "flex size-3.5 shrink-0 items-center justify-center rounded-full border " +
        (active ? "border-accent" : "border-line-strong")
      }
    >
      {active ? <span className="size-1.5 rounded-full bg-accent" /> : null}
    </span>
  );
}
```

## 任务 D：TerminalPanel 快速切换菜单

文件：`src/renderer/src/components/panel/TerminalPanel.tsx`

### D1. imports

`import { Popover } from "../motion";`（该文件尚未引 Popover）；`ChevronDownIcon` 加入现有 icons import（文件已从 `"../icons"` 引入一组）。

### D2. 状态与打开逻辑

`TerminalPanel` 组件内，现有 `open` useCallback 改造 + 新增：

```tsx
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [shellChoices, setShellChoices] = useState<TerminalShell[] | null>(null);

  const open = useCallback(async (shellId?: string) => {
    const result = await window.pi.spawnPty(cwdRef.current, shellId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setSessions((current) => [...current, result]);
    setActiveId(result.id);
  }, []);

  const toggleShellMenu = () => {
    const next = !shellMenuOpen;
    setShellMenuOpen(next);
    if (next && !shellChoices) {
      void window.pi
        .listShells()
        .then((result) => setShellChoices(result.shells))
        .catch(() => setShellChoices([]));
    }
  };
```

类型 import：文件顶部 `import type { PtySession } from "@shared/terminal";` 改为 `import type { PtySession, TerminalShell } from "@shared/terminal";`

所有现有 `void open()` 调用保持不变（不传参 = 默认 shell）。

### D3. 替换 "+" 按钮

现状（sessions.map 之后）：

```tsx
          <button
            type="button"
            onClick={() => void open()}
            aria-label={t("New terminal")}
            title={t("New terminal in this folder")}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <PlusIcon size={12} />
          </button>
```

替换为（+ 保留直接开默认；chevron 打开菜单）：

```tsx
          <div className="relative flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => void open()}
              aria-label={t("New terminal")}
              title={t("New terminal in this folder")}
              className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <PlusIcon size={12} />
            </button>
            <button
              type="button"
              data-popover-trigger
              onClick={toggleShellMenu}
              aria-label={t("New terminal in a specific shell")}
              title={t("Pick a shell for the new terminal")}
              className="pressable flex size-4 items-center justify-center rounded-[4px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <ChevronDownIcon size={9} />
            </button>
            <Popover open={shellMenuOpen} onClose={() => setShellMenuOpen(false)} anchor="bottom-right" className="z-40 w-64 rounded-card border border-line bg-surface shadow-card">
              <div className="flex flex-col gap-0.5 p-1">
                {(shellChoices ?? []).map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    onClick={() => {
                      setShellMenuOpen(false);
                      void open(shell.id);
                    }}
                    className="pressable flex flex-col gap-0.5 rounded-[6px] px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="text-[12px] text-ink">{shell.name}</span>
                    <span className="truncate font-mono text-[10px] text-ink-3">
                      {shell.args.length ? `${shell.path} ${shell.args.join(" ")}` : shell.path}
                    </span>
                  </button>
                ))}
                {!shellChoices ? (
                  <span className="px-2 py-2 text-[11.5px] text-ink-3">{t("Detecting shells…")}</span>
                ) : null}
              </div>
            </Popover>
          </div>
```

## 任务 E：appearance 分类的占位区删除

`src/renderer/src/views/SettingsView.tsx` 中，`category === "appearance"` 块内删除：

```tsx
            {/* reserved: accent themes are not built yet */}
            <section className="flex flex-col gap-2">
              ...（"accent palette — coming later" 整段）...
            </section>
```

（Code style 已是该分类的实际内容，占位不再需要。）

## 任务 F：i18n 词条

文件：`src/renderer/src/lib/i18n.ts` 的 zh 词典。

**先 grep 防重复**：`"Terminal"`、`"Code"`、`"Shell"`、`"Use"`、`"current"`、`"Auto"` 可能已存在——已存在的键不要重复声明（对象字面量重复键会报错或被覆盖）。缺的才补：

```ts
  /* ── appearance: code style ── */
  "Code style": "代码风格",
  "the palette of code blocks; follows light and dark": "代码块的配色，跟随窗口明暗模式",
  "Diff": "差异",

  /* ── terminal shells ── */
  "Default shell": "默认 Shell",
  "Discovered on this machine — the + button opens the default": "在本机探测到的 Shell —— + 按钮打开默认项",
  "Auto": "自动",
  "the first shell this machine offers": "本机探测到的第一个 Shell",
  "Custom path": "自定义路径",
  "an absolute path to any shell executable": "任意 Shell 可执行文件的绝对路径",
  "Use": "使用",
  "current": "当前",
  "Agent shell": "Agent Shell",
  "Agent shell path": "Agent Shell 路径",
  "the bash the agent's own commands run in — must be bash-compatible; the terminal pane's choice above is separate":
    "Agent 自身命令运行的 bash，必须 bash 兼容；与上面终端面板的选择相互独立",
  "New terminal in a specific shell": "在指定 Shell 中新建终端",
  "Pick a shell for the new terminal": "为新终端选择 Shell",
  "Detecting shells…": "正在探测 Shell…",
```

注意 `"Code"`：设置里代码预览标题用 `t("Code")`。若已存在则跳过；不存在补 `"Code": "代码",`。

## 任务 G：验证

1. `npm run typecheck` 零错误（tsconfig.node.json + tsconfig.web.json 两端）。
2. 逻辑自查（读代码即可，不必跑 app）：
   - `pty:spawn` 不传 shellId 时走 `resolveTerminalShell(preferred, customPath, shells)`；
   - 传 `shellId` 时按 id 找；找不到（如已卸载）返回 undefined → pty 回退 defaultShell()，不崩；
   - `updateSettings({terminal})` 写 desktop.json 后无需 reload（每次 spawn 都重新 readConfig）。
3. 手动验证清单（可选，需要跑 `npm run dev`）：
   - 设置 ▸ 外观：Code style 三选 + Code/Diff 双预览实时换色；切明暗模式预览跟随；
   - 设置 ▸ 终端：列表显示本机 WSL 发行版/Git Bash/PowerShell/cmd + Auto + Custom 输入；
   - 终端面板：+ 开默认；chevron 菜单列出 shells，选 WSL 开出 WSL 标签（title 显示 "WSL · 发行版名"）；
   - Agent shell 路径输入仍写 pi 的 shellPath（bash 兼容，供 agent bash 工具）。

## 已知边界（不要"修复"）

- pty 的 `defaultShell()` 保留 PowerShell→cmd 兜底：这是"configured/explicit 都没有时"的最后防线，探测链在 `shells.ts` 的 `resolveTerminalShell`（custom → preferred → 第一个可用）。pi 自己的 bash 工具仍用 `settings.shellPath`（bash 兼容语义），两者故意分开。
- `RuntimeSettings.terminal` 是 desktop.json 的镜像（pi-host 的 runtimeSettings() 提供），设置 UI 直接经 `updateSettings` 写回。
- Dracula 的 light 配色是派生的（官方只有 dark），在 `hljs-themes.css` 注释里已声明。
