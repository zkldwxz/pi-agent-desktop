# Pi Agent Desktop

A desktop shell for the Pi coding agent **already installed on this machine**.

It does not create a new agent and does not ship its own model loop. It attaches to the
same runtime, credentials, models, and session files that the `pi` CLI uses:

| What | Where |
| --- | --- |
| Config / auth | `~/.pi/agent/settings.json`, `auth.json`, `models.json` |
| Sessions | `~/.pi/agent/sessions/<encoded-cwd>/` |
| Extensions | `~/.pi/agent/extensions/`, `<cwd>/.pi/extensions/` |
| Skills / prompts / themes | `~/.pi/agent/{skills,prompts,themes}/` |

Stack: **TypeScript + Electron 38 + electron-vite + React 19 + Tailwind v4**.
Visual language follows the SuperPi skeleton and the
[Beautiful UI](https://github.com/slev12397/beautiful-ui) primitives (MIT).

## Run

```bash
cd F:/Projects/pi-agent-desktop
npm install
npm run dev        # dev with HMR
npm run build      # production bundles into out/
npm run typecheck  # node + web projects
```

Optional: `PI_DESKTOP_CWD=F:/Projects` sets the initial project folder. Otherwise it opens
`F:/Projects` when present, then `process.cwd()`.

## Beautiful UI components

All 26 primitives from the [Beautiful UI registry](https://www.beautifului.dev/r/registry.json)
are vendored into `src/renderer/src/components/beautiful/` (MIT) and driven by real
agent data — not demos.

```bash
# what the registry publishes; vendored here so the desktop controls placement
curl https://www.beautifului.dev/r/registry.json
curl https://www.beautifului.dev/r/loading-state.json
curl https://www.beautifului.dev/r/thinking-state.json
```

`npx shadcn add <url>` was not used: the CLI assumes a `components.json` project, would
install the paid `@central-icons-react` set, and rewrites files we then have to adapt
anyway. The registry JSON carries the full source, so it is extracted directly
(`.registry/*.json` → `components/beautiful/{atoms,primitives}/`).

### What is wired to what

| Component | Fed by |
| --- | --- |
| `LoadingState` | the pixel-grid working indicator, rotating its label on long runs |
| `ThinkingState` | the reasoning trace only — one row per thinking paragraph, open while the agent reasons and collapsed ("Thought") once it settles |
| `ToolChips` | one summary row per kind of work: "Explored · 12 files, ran 3 commands", "Edited app.tsx ×3 +74 −41". Expanding it lists the individual calls; expanding a call shows what it did; edit groups carry the file-diff chips and their hover preview |
| `CodeBlock` | fenced code in answers, and unified diffs parsed from the edit tool's patch (multi-hunk, real line numbers) |
| `StreamingText` | settled answers that cite web sources — source chips, action row, expandable source list |
| `StreamText` (atom) + a backlog-aware override | 吐字 while tokens arrive |
| `PromptBar` | the composer: real models, real `/` commands, `@` mentions of files the session touched, the model/thinking cluster left of dictation, the cache and context rings under it, stop control while running |
| `SearchList` | the Ctrl K command palette (commands, sessions, models, views, actions) |
| `GlideMenu` | the shared gliding highlight inside `SearchList`, the workspace filter menu, and the vendored record/approval cards |

The left pane is **app-owned, not a primitive** (`components/agent/AgentSidebar.tsx`, styles in
`index.css`): the vendored `SidebarNav` brought the registry's demo furniture with it — its own
"Chats" search, a workspace menu offering "New workspace / Invite team members / Sign out", a second
set of navigation rows duplicating the icon rail, and a recents list the app never fed. It was
discarded along with `styles/sidebar-nav.css` and `atoms/central-icons.tsx` (its only consumer).
What is left is the 224↔52px pane: project switcher, "New chat", the workspace tree, account row.

All of `ApprovalCard`, `ContextCards`, `TaskRows`, `RecordsTable`,
`FilterTable`, `RecommendationCard`, `InsightCards`, `ChatComposer`, `FineTuneCard`,
`SelectionActions`, `Flowchart` and the `atoms/` are vendored and compiling, ready to
attach to the surfaces that need them. `DiffTable` alone is unused: it is a scripted
demo (hard-coded Flavor / Category / Supplier columns, a staged reveal that blocks
interaction), and the Changes panel renders the session's real diffs instead.

### Local adaptations (marked in-file)

Vendored components ship with scripted demo timelines and demo catalogues. Each
adaptation is additive and commented:

- `ThinkingState` / `ToolChips` / `StreamingText` gained `instant` (and `ThinkingState`
  gained `working`) so a real run renders immediately instead of replaying a timeline.
- `ToolChips` was re-aligned to the trace above it: header glyph in a 16px box, rows in the
  trace's `5px + 14px` gutter, detail lines on the row label's x. The registry version mixed
  `-mx-1` / `-mx-[3px]` paddings, which left the header, the rows and the diff strip 2px apart.
- `PromptBar` gained `models` / `modelKey` / `onSelectModel`, `commands`, `sources`,
  `streaming` / `onAbort`, and `prefill` — its send control becomes a stop control.
- `PromptBar` gained `controls` / `footer` host slots. In the registry's wide layout the
  controls, dictation and send were all placed in the same grid cell, so the model trigger
  landed on top of the send button and read as "top right"; the controls now hold column 3 of
  the bottom row, and `footer` is the row under them (where the cache and context rings go).
  Its measurement effect also keyed off its own model trigger, which the host does not render —
  it returned early, so the textarea never grew past one line. It measures the host slot now, and
  drops the composer's `overflow-hidden` when host slots are present, because the registry keeps
  its own pickers outside that clip box and a host cluster inside it would have its popovers cut off.
- `SearchList` gained `entries` (grouped rows with hints), `onSelect`, `autoFocus`,
  arrow-key traversal and Escape. Arrow keys move DOM focus, which is exactly what makes
  `GlideMenu`'s `onFocusCapture` glide the highlight for the keyboard too.
- `atoms/glimm.ts` reimplements the rainbow sweep on canvas 2D instead of pulling a
  WebGL shader dependency; same public surface (`createShader` / `playSweep`).
- `ContextBadge` opens upward: it moved from the header into the prompt bar's footer.

### Two upstream defects

Both published registry files are malformed and had to be repaired to parse:

1. `r/records-table.json` → `records-table.css` is truncated by one byte, leaving the
   final `@media (max-width: 640px)` block unclosed.
2. `r/foundation.json` → `foundation.css` contains a truncated `@media` block: an
   orphaned `.records-footer-hint` rule plus a stray `}`.

Both are annotated in place with a `NOTE:` comment.

## Motion

The motion layer is ported from the Beautiful UI source (`app/globals.css`,
`components/primitives/*`, `components/site/Grid.tsx`), not approximated.

**Curves** — `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` is the workhorse,
`--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1)` for repositioning,
`--ease-link: cubic-bezier(0.16, 1, 0.3, 1)` for the sidebar and underlines.

**Split transitions.** Interactive surfaces never run one duration for everything:
opacity gets 120ms `ease-out` while transform gets 140ms of the strong curve. That
split is what keeps press feedback crisp instead of floaty. See `.pressable`.

**Grammar** (all in `src/renderer/src/index.css`)

| Class | What it does |
| --- | --- |
| `.pressable` | press grammar — `scale(0.96)` on `:active`, split timing |
| `.stagger` / `.stagger-pop` | `fade-up` / `pop-in` with `--i` capped at 4 × 45ms |
| `.row-enter` | list rows: fade + rise + 1px blur clear |
| `.view-enter` | view switch on a keyed wrapper |
| `.collapse-grid` | `grid-template-rows: 0fr → 1fr` expand/collapse |
| `.glide-layer` | one hover surface that travels between rows |
| `.stream-caret` / `.stream-tail` | solid caret while streaming, blink when settled; masked blur on the newest words |
| `.shimmer-text` | busy labels sweep instead of pulsing |
| `.pulse-dot` | the only infinite loop, for live status |
| `.theme-switching` | freezes transitions for two frames so a theme flip is one repaint |

**Choreography**

- Rail: a single pill slides between nav items (`SlidingGroup`) instead of each item
  toggling its own background.
- Sidebar: hover highlight glides between sessions (`GlideList`); group collapse uses
  `0fr → 1fr`; the 224↔52px collapse fades the copy out before the rows narrow.
- Thread: thinking traces expand while running and settle closed so the answer leads;
  tool calls collapse into one summary row per kind of work (`buildToolGroups`), open while a
  call is pending and shut the moment its result lands; assistant text uses the masked-blur
  tail with **no word-reveal timer** — live token streams must not be re-animated.
- Composer: pickers are anchored popovers that scale from their anchor corner; the
  focus ring is its own layer animating opacity only; the queue card and the prompt bar
  share one 720px column so they read as a stack.
- Usage: hour bars animate `scaleY` from the baseline (no height layout animation);
  heatmap selection uses a scale + ring; drill slices pop in.

`prefers-reduced-motion` collapses every animation and transition globally.

## Views

The left icon rail switches between five views.

### Chat
- Session list for the current project in the left pane, grouped by workspace / date / status, with
  live status (running / failed) and unread marks read from the session tree. A collapsed workspace
  renders nothing at all.
- Streaming assistant output with the work collapsed: thinking on its own row, then one row per
  kind of work ("Explored · 12 files, ran 3 commands", "Edited app.tsx ×3 +74 −41"), each one
  click from the individual calls and their details. Anything else the agent did — compaction,
  branch markers, bash output — renders from the agent's event stream.
- Composer with slash-command autocomplete, `@` mentions, thinking-depth picker, stop button,
  dictation, the model and thinking cluster on the bottom row immediately right of the attach
  button, and the cache and context rings under it. Clicking the model opens the models, the
  thinking track, and the context ledger — system prompt, tool definitions and skills, with the
  token size each one costs. Messages sent while the agent runs land in the queue card above it,
  split into steering (interrupts at the next turn boundary) and follow-up (waits for the run to
  stop), each with pi's own delivery mode as a control.
- Header shows the session title and run status only — the model and the context ring moved into the
  composer, where you are looking when you decide to change them.
- The right dock is opened and closed by the button at the top right of the current view, in the spot
  the decorative ellipsis used to occupy. With the panel open that button sits against the panel's
  left edge, so the control that opened it is the control that closes it. **Changes** lists every file
  the session wrote to and expands in place to that file's real diff, numbered from the patch itself;
  clicking through opens it in the main column with the diff above the whole file, and the viewer's
  **Open with** list is read from the operating system — file manager, default application, and every
  editor registered for that extension.
- Settings leads with a **Back** row and uses the same navigation rows as the session pane.
- Answers render as GFM markdown: headings, ordered and nested lists, task lists, tables with column
  alignment, strikethrough, autolinks and footnotes. Fenced code goes to `CodeBlock`; inline HTML is
  escaped, because that is what the parser does with it.

### Usage
Reads every `sessions/**/*.jsonl` and rebuilds a local usage ledger — no data leaves the machine.

- **Overview** — KPIs (sessions, messages, total tokens, active days, current/longest streak, peak
  hour, favorite model), a GitHub-style activity heatmap, and a 24-hour histogram.
- **Drill-down** — click any day cell or hour bar to scope every number on the page to that slice,
  then click again (or the chip) to clear. The accent bar shows calls, tokens, cache hit rate,
  in/out split, cache read, and cost for the selection.
- **Models** — per-model token/cache table (in, out, cache read, cache write, hit rate, total).
- **Cache** — hit rate, cache read/write, fresh input, plus a **cache-by-channel** table that counts
  every `provider × model` pair separately.
- Range filter: All / 30d / 7d.

### Plugins
- Lists extensions (global + project, enabled and disabled), configured paths and packages from
  `settings.json`, skills, prompts, and themes, with size and errors.
- Enable / disable toggle moves the file to `extensions.disabled/` beside its folder, so the Pi CLI
  sees exactly the same state. Deleting moves it to `~/.pi/agent/trash/<timestamp>-<name>`.
- Reveal-in-explorer and keyword/category filtering.

### Models
- Cards for every authenticated model with reasoning / vision / override badges, context window, max
  output, and available thinking levels.
- Inspector panel edits **display name, reasoning, image input, context window, max output, and the
  full thinking-level map** (each level can be mapped to a provider value or marked unsupported).
- Actions: use in this session, set as startup default, save to `models.json`, remove override.
- Channel table shows API kind, model count, auth status, and whether it is built-in or file-defined.

### Settings
- A searchable rail: top-level rows, then labelled groups (Agent, Workspace) with a rule between
  them, an icon on every row, and the active row on its own raised surface.
- **Data** — the runtime numbers, read here rather than in the sidebar: sessions, models, task list,
  active session, context window, session tokens and cache read, cost, and the session directory.
  The rail's trailing row reveals the current transcript in the file manager.
- General: startup thinking level and per-model defaults, thinking token budgets, image handling,
  cache-miss notices, auto compaction and auto retry, shell path and command prefix.
- Everything is written through `SettingsManager` into `~/.pi/agent/settings.json`.

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ K` | Focus session search (jumps to Chat) |
| `Ctrl/⌘ N` | New session |
| `Ctrl/⌘ U` | Toggle Usage view |
| `Enter` / `Shift+Enter` | Send / newline |
| `Esc` (while streaming) | Abort the run |

## Diagnostics

```bash
PI_DESKTOP_USAGE_PROBE=1 npx electron .   # scan last day, print totals, exit
PI_DESKTOP_USAGE_PROBE=0 npx electron .   # scan everything
```

Startup also logs
`[pi-desktop] connected cwd=… sessions=… models=… providers=… plugins=…`.

## Architecture

```
src/
  main/
    index.ts        Electron window, IPC surface, startup probe
    pi-host.ts      Owns AgentSessionRuntime; sessions, models, settings, events
    serialize.ts    pi messages/models → renderer-safe shapes
    usage.ts        Session JSONL scanner → usage/cache ledger
    plugins.ts      Extension/skill/prompt discovery, enable-disable-delete
    model-config.ts models.json read/write (never leaks apiKey to the renderer)
  preload/index.ts  contextBridge surface (`window.pi`)
  shared/types.ts   IPC contract shared by both sides
  renderer/src/
    App.tsx         View routing + host state
    components/     TitleBar, NavRail, MessageThread, ui kit
    components/agent/   AgentSidebar, AgentComposer, AgentTrace, AgentToolRun, AgentAnswer, QueueBar
    components/panel/   ToolDock, ContextBadge, ModelControl, FileBrowser, FileViewer, TerminalPanel
    views/          UsageView, PluginsView, ModelsView, SettingsView
```

Session replacement (`newSession`, `switchSession`) goes through `AgentSessionRuntime`, and
subscriptions are re-bound to the new `AgentSession` each time.

## Notes

- Provider API keys stay in the main process; `models.json` writes preserve existing secrets.
- Local models with no cost configured show `$0` — cost figures come from the provider usage payload.
- Reasoning tokens are reported separately from output where the provider supplies them.
