import { useEffect, useMemo, useState } from "react";
import type { ChannelEdit, HostState, ModelEdit, RuntimeSettings, UsageStats } from "@shared/types";
import { cn } from "../lib/cn";
import { getCodeTheme, setCodeTheme, type CodeTheme } from "../lib/code-theme";
import { setSoundsEnabled, soundsEnabled } from "../lib/sound";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BrainIcon,
  CheckCircleIcon,
  DatabaseIcon,
  FilePenIcon,
  GaugeIcon,
  GlobeIcon,
  HookIcon,
  KeyboardIcon,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
  XIcon,
} from "../components/icons";
import { Chip } from "../components/ui";
import { WindowControls } from "../components/TitleBar";
import { GlideList } from "../components/motion";
import { NavRow } from "../components/NavRow";
import { TextRow } from "../components/beautiful/atoms/TextRow";
import { AppearanceSection } from "../components/panel/AppearanceSection";
import { HooksSection } from "../components/panel/HooksSection";
import { SshServersSection } from "./SshServersSection";
import { ModelManagerSection, SMART_KEY } from "../components/panel/ModelManager";
import type { QueueBehavior } from "../components/agent/QueueBar";
import { ShortcutsSection } from "../components/panel/ShortcutsSection";
import { Row, Section, Select, Switch } from "../components/panel/SettingsParts";
import { getLocale, setLocale, t, tf, type Locale } from "../lib/i18n";
import { loadSidebarPrefs, saveSidebarPrefs, SIDEBAR_PREFS_DEFAULT } from "../lib/sidebar-prefs";
import type { WorkspacePrefs } from "../components/agent/WorkspaceList";
import { formatChord, useShortcuts } from "../lib/keybindings";
import { IS_MAC, IS_WINDOWS } from "../lib/platform";
import type { ColorMode } from "../lib/theme";
import { THINKING_LEVELS } from "@shared/thinking";

import { UsageView } from "./UsageView";


/** A shell path the reader can actually go and find on this machine — the
 *  placeholder is an example to copy, and a Git Bash drive letter is not one. */
const SHELL_EXAMPLE = IS_WINDOWS ? "D:/Git/bin/bash.exe" : IS_MAC ? "/bin/zsh" : "/bin/bash";

export type SettingsCategory = "appearance" | "general" | "models" | "agent" | "browser" | "remote" | "tasks" | "hooks" | "keyboard" | "data" | "usage";

type SettingsRow = { key: SettingsCategory; label: string; icon: React.ReactNode };

/**
 * The category rail, grouped the way the reference is: a set of top-level rows
 * first, then labelled groups with a rule between them, an icon on every row, and
 * the active row on its own raised surface. The rows themselves are the same
 * `NavRow` the session pane uses.
 */
const GROUPS: Array<{ label?: string; items: SettingsRow[] }> = [
  {
    items: [
      { key: "general", label: "General", icon: <SettingsIcon size={14} /> },
      { key: "appearance", label: "Appearance", icon: <SunIcon size={14} /> },
      { key: "keyboard", label: "Keyboard shortcuts", icon: <KeyboardIcon size={14} /> },
    ],
  },
  {
    label: "Agent",
    items: [
      { key: "agent", label: "Agent", icon: <SparkIcon size={14} /> },
      { key: "models", label: "Models & thinking", icon: <BrainIcon size={14} /> },
      { key: "tasks", label: "Tasks", icon: <CheckCircleIcon size={14} /> },
      { key: "hooks", label: "Hooks", icon: <HookIcon size={14} /> },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "browser", label: "Browser & network", icon: <GlobeIcon size={14} /> },
      { key: "remote", label: "SSH servers", icon: <TerminalIcon size={14} /> },
      { key: "data", label: "Data", icon: <DatabaseIcon size={14} /> },
      { key: "usage", label: "Usage & cache", icon: <GaugeIcon size={14} /> },
    ],
  },
];

const ALL_ROWS = GROUPS.flatMap((group) => group.items);

/** what each page says under its title (SettingsPage.description) */
const PAGE_NOTE: Partial<Record<SettingsCategory, string>> = {
  general: "Written to ~/.pi/agent/settings.json — the Pi CLI reads the same file",
  keyboard: "Click a shortcut, then press the combination you want",
  hooks: "Extensions subscribe to the agent's event stream with pi.on(event, handler)",
};

export function SettingsView({
  initialCategory,
  state,
  colorMode,
  onColorMode,
  zoomFactor,
  onZoomFactor,
  onUpdate,
  onReload,
  onBack,
  onSaveModel,
  onDeleteModel,
  onCreateChannel,
  onRemoveChannel,
  onAddChannelKey,
  onRemoveChannelKey,
  onSetEnabledModels,
  queueBehavior,
  onQueueBehavior,
  dockToggle,
  usage,
  usageLoading,
  usageRange,
  onUsageRange,
  onUsageRefresh,
}: {
  /** the category to open on (the model menu's "Manage Models…" opens Models) */
  initialCategory?: SettingsCategory;
  state: HostState;
  colorMode: ColorMode;
  onColorMode: (mode: ColorMode) => void;
  zoomFactor?: number;
  onZoomFactor?: (factor: number) => void;
  onUpdate: (patch: Partial<RuntimeSettings>) => void;
  onReload: () => void;
  /** leave settings and return to the conversation */
  onBack: () => void;
  /* models.json, from the settings page: the writes report back through the
     shell's notice stack, so the caller owns the error handling */
  onSaveModel: (edit: ModelEdit) => Promise<void>;
  onDeleteModel: (provider: string, modelId: string) => Promise<void>;
  /* channels are endpoints with keys on them; creating one answers with the
     provider ids it wrote, which is what the model that came with it needs */
  onCreateChannel: (edit: ChannelEdit) => Promise<string[]>;
  onRemoveChannel: (channelId: string) => Promise<void>;
  onAddChannelKey: (channelId: string, key: string) => Promise<void>;
  onRemoveChannelKey: (providerId: string) => Promise<void>;
  /** the whole enabled-model whitelist, replacing `enabledModels` */
  onSetEnabledModels: (keys: string[]) => Promise<void>;
  /** what a send does while the agent is working — a queue-behaviour setting */
  queueBehavior: QueueBehavior;
  onQueueBehavior: (behavior: QueueBehavior) => void;
  /** the right panel's trigger, positioned by the shell */
  dockToggle?: React.ReactNode;
  /* the usage dashboards used to be their own view; they are a section here */
  usage: UsageStats | null;
  usageLoading: boolean;
  usageRange: 0 | 7 | 30;
  onUsageRange: (range: 0 | 7 | 30) => void;
  onUsageRefresh: () => void;
}) {
  const settings = state.settings;
  const chords = useShortcuts();
  const [budgetDraft, setBudgetDraft] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<SettingsCategory>(initialCategory ?? "general");
  const [locale, setLocaleState] = useState<Locale>(getLocale);
  const onLocale = (next: Locale) => {
    setLocale(next);
    setLocaleState(next);
  };
  /* a window-level preference, not a pi setting: it lives beside the colour
     mode and never touches settings.json */
  const [codeTheme, setCodeThemeState] = useState<CodeTheme>(getCodeTheme);
  const onCodeTheme = (next: CodeTheme) => {
    setCodeTheme(next);
    setCodeThemeState(next);
  };

  const terminal = settings.terminal;
  const setCustomShellPath = (customPath: string) => {
    const trimmed = customPath.trim();
    void window.pi
      .updateSettings({
        terminal: {
          preferred: trimmed ? "custom" : terminal?.preferred === "custom" ? "auto" : (terminal?.preferred ?? "auto"),
          customPath: trimmed || undefined,
        },
      })
      .catch(() => undefined);
  };
  const [query, setQuery] = useState("");

  /* desktop-only preferences live in localStorage rather than the pi settings
   * file — they are about this shell, not about the agent */
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("pi-sound-done") !== "off");
  /* the click layer keeps its own key inside lib/sound, which is also the only
     place that reads it at click time — the switch must not invent a second one */
  const [clickOn, setClickOn] = useState(soundsEnabled);
  const [notifyOn, setNotifyOn] = useState(() => localStorage.getItem("pi-notify-done") !== "off");
  const [sidebarGroup, setSidebarGroup] = useState(() => loadSidebarPrefs(SIDEBAR_PREFS_DEFAULT).group);
  /* the id reader is the same kind of habit: some people want a form that fills
     itself in, some want one that never guesses on their behalf */
  const [smartMatch, setSmartMatch] = useState(() => localStorage.getItem(SMART_KEY) !== "off");
  const toggleSound = (next: boolean) => {
    setSoundOn(next);
    localStorage.setItem("pi-sound-done", next ? "on" : "off");
  };
  const toggleClick = (next: boolean) => {
    setClickOn(next);
    setSoundsEnabled(next);
  };
  const toggleNotify = (next: boolean) => {
    setNotifyOn(next);
    localStorage.setItem("pi-notify-done", next ? "on" : "off");
  };
  const toggleSmartMatch = (next: boolean) => {
    setSmartMatch(next);
    localStorage.setItem(SMART_KEY, next ? "on" : "off");
  };

  const modelRows = state.models.map((model) => ({ key: `${model.provider}/${model.id}`, model }));

  /* searching filters the rail; empty groups drop out entirely */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      /* the rail is Chinese but the search matches both languages, so "终端"
         and "terminal" both find the same row */
      items: group.items.filter((item) => `${item.label} ${t(item.label)}`.toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const sessionFile = state.snapshot?.sessionFile;
  /* named `contextUsage` so it does not collide with the `usage` prop, which is
     the token ledger rather than the current window's fill */
  const contextUsage = state.snapshot?.stats?.contextUsage;
  const tokens = state.snapshot?.stats?.tokens;

  return (
    <div className="flex min-h-0 flex-1 bg-page">
      {/* category rail — the reference layout: a search field, then grouped
          rows with an icon each and a rule between groups. It runs the full
          height of the window because settings *is* this rail: the session
          pane stands down for this view rather than the app opening a small
          settings panel inside the agent shell. */}
      {/* baocode's settings rail (settings_dialog.dart): 240 wide on the
          window's colour where the sidebar is — under the traffic lights'
          row, the way back, a 28px search, then 30px rows (icon 15, label 13,
          radius 6, the 6% ink fill for the one shown and the hovered); groups
          14px apart, no group labels */}
      <nav className="flex w-[240px] shrink-0 flex-col bg-canvas">
        <div className="titlebar-drag h-9 shrink-0" />
        <div className="shrink-0 px-2 pt-1.5">
          <button
            type="button"
            data-nav-back
            onClick={onBack}
            className="pressable flex h-7 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-ui-step text-settings-muted transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"
          >
            <ArrowLeftIcon size={15} className="shrink-0" />
            {t("Back")}
          </button>
        </div>
        <div className="shrink-0 px-2 pt-1.5 pb-2.5">
          <label className="flex h-7 items-center gap-1.5 rounded-[6px] border border-input-line bg-page px-2 transition-colors duration-150 focus-within:border-accent">
            <SearchIcon size={15} className="shrink-0 text-settings-icon" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={t("Search settings")}
              aria-label={t("Search settings")}
              className="min-w-0 flex-1 bg-transparent text-ui-caption text-ink outline-none placeholder:text-ink-4"
            />
            {query ? (
              <button
                type="button"
                aria-label={t("Clear search")}
                onClick={() => setQuery("")}
                className="pressable flex size-4 shrink-0 items-center justify-center rounded-tiny text-ink-3 hover:text-ink"
              >
                <XIcon size={11} />
              </button>
            ) : null}
          </label>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((group, groupIndex) => (
            <div key={group.label ?? "top"} className={groupIndex > 0 ? "mt-3.5" : undefined}>
              {group.items.map((entry) => {
                const active = category === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setCategory(entry.key)}
                    className={cn(
                      "pressable mb-px flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-ui-step transition-colors duration-100",
                      active
                        ? "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-ink"
                        : "text-settings-muted hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]",
                    )}
                  >
                    <span className={cn("flex size-[15px] shrink-0 items-center justify-center", active ? "text-ink" : "text-settings-icon")}>
                      {entry.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {!groups.length ? (
            <div className="px-2.5 py-3 text-ui-sm text-ink-3">
              {tf("Nothing matches “{query}”. The list has {count} sections.", { query, count: ALL_ROWS.length })}
            </div>
          ) : null}

          {/* the files behind these settings: the session transcript */}
          <div className="mt-3.5">
            <button
              type="button"
              disabled={!sessionFile}
              title={sessionFile ?? t("No session file yet")}
              onClick={() => sessionFile && void window.pi.showItem(sessionFile)}
              className="pressable flex h-[30px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-ui-step text-settings-muted transition-colors duration-100 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] disabled:opacity-40"
            >
              <FilePenIcon size={15} className="shrink-0 text-settings-icon" />
              <span className="min-w-0 flex-1 truncate">{t("Transcript")}</span>
              <ArrowUpRightIcon size={13} className="shrink-0 text-ink-4" />
            </button>
          </div>
        </div>
      </nav>

        {/* the page, as baocode's settings window has it: not an island — the
            page colour to the window's edges, a 1px line between it and the
            rail (the IDE's side bar beside its editor); a drag row over it the
            traffic lights' height (the window buttons off macOS), then the
            page's own title */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-line bg-page">
          <div className="titlebar-drag flex h-9 shrink-0 items-center justify-end pr-1.5">
            <WindowControls />
          </div>
          <div key={category} className="view-enter scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {/* the usage dashboards own the full width — charts and tables do not
              read well squeezed into the settings column */}
          {/* SettingsPage: 32 in, as wide as the conversation (720), 16 under
              the drag row; groups 20 apart; the title 8 in, with the groups'
              headings */}
          <div className={cn("mx-auto flex w-full flex-col gap-5 px-8 pt-2 pb-12", category === "usage" ? "max-w-[1100px]" : "max-w-[784px]")}>
          <div className="flex items-start gap-3 px-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-ui-xl font-semibold text-ink">{t(ALL_ROWS.find((row) => row.key === category)?.label ?? "Settings")}</h1>
              {PAGE_NOTE[category] ? <p className="mt-1 text-ui-meta leading-[1.5] text-settings-muted">{t(PAGE_NOTE[category]!)}</p> : null}
            </div>
            {category === "general" ? (
              <button
                type="button"
                onClick={onReload}
                className="pressable flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] border border-line-strong px-2 text-ui-meta text-ink transition-colors duration-100 hover:bg-hover"
              >
                <RefreshIcon size={12} />
                {t("Reload session")}
              </button>
            ) : null}
          </div>
          {category === "appearance" ? (
          <div className="flex flex-col gap-6">
            <AppearanceSection
              mode={colorMode}
              onMode={onColorMode}
              zoomFactor={zoomFactor}
              onZoomFactor={onZoomFactor}
              locale={locale}
              onLocale={onLocale}
              codeTheme={codeTheme}
              onCodeTheme={onCodeTheme}
            />
          </div>
          ) : null}

          {category === "models" ? (
          <>
          {/* The catalogue comes first: everything below it configures a model
              that has to exist first — depth overrides, budgets, delegation. */}
          <ModelManagerSection
            models={state.allModels ?? state.models}
            channels={state.channels}
            enabledKeys={state.models.map((model) => `${model.provider}/${model.id}`)}
            currentKey={
              state.snapshot?.model ? `${state.snapshot.model.provider}/${state.snapshot.model.id}` : null
            }
            onSave={onSaveModel}
            onDelete={onDeleteModel}
            onCreateChannel={onCreateChannel}
            onRemoveChannel={onRemoveChannel}
            onAddKey={onAddChannelKey}
            onRemoveKey={onRemoveChannelKey}
            onSetEnabled={onSetEnabledModels}
          />
          <Section title={t("Models & thinking")} index={1}>
            {/* the same switch the add-model dialog carries, so the default can be
                set once instead of per form */}
            <Row title={t("Smart model matching")} hint={t("read the context size and vision support from the model id")}>
              <Switch on={smartMatch} onClick={() => toggleSmartMatch(!smartMatch)} />
            </Row>
            <Row title={t("Startup thinking level")} hint={t("used when a session starts without a saved level")}>
              <Select
                value={settings.defaultThinkingLevel ?? "medium"}
                options={THINKING_LEVELS}
                onChange={(value) => onUpdate({ defaultThinkingLevel: value })}
              />
            </Row>
            {/* the per-model rows read as a catalogue: the key is the row, the
                section label carries the explanation — eighteen repetitions of
                "Default level ·" and "per-model override" said nothing */}
            <div data-row className="relative px-3.5 pt-3 pb-1 text-ui-meta text-ink-2">
              {t("Per-model overrides · inherit follows the startup level")}
            </div>
            {modelRows.map(({ key, model }) => (
              <Row key={key} title={key} mono>
                <Select
                  mono
                  value={settings.modelThinkingLevels[key] ?? "inherit"}
                  options={["inherit", ...model.thinkingLevels]}
                  onChange={(value) => {
                    const next = { ...settings.modelThinkingLevels };
                    if (value === "inherit") delete next[key];
                    else next[key] = value;
                    onUpdate({ modelThinkingLevels: next });
                  }}
                />
              </Row>
            ))}
            <Row title={t("Thinking token budgets")} hint={t("applies to providers that accept explicit budgets")}>
              <div className="flex items-center gap-1.5">
                {(["minimal", "low", "medium", "high"] as const).map((level) => (
                  <label key={level} className="flex items-center gap-1">
                    <span className="font-mono text-ui-xs text-ink-3">{level.slice(0, 3)}</span>
                    <input
                      type="number"
                      step={512}
                      value={budgetDraft[level] ?? settings.thinkingBudgets?.[level] ?? 0}
                      onChange={(event) => setBudgetDraft({ ...budgetDraft, [level]: Number(event.target.value) || 0 })}
                      className="h-[26px] w-20 rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink tabular-nums outline-none focus:border-accent"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => onUpdate({ thinkingBudgets: budgetDraft as Record<string, number> })}
                  className="pressable-soft pressable h-7 rounded-control bg-surface px-2 text-ui-sm text-ink shadow-btn hover:bg-inset"
                >
                  {t("Apply")}
                </button>
              </div>
            </Row>
          </Section>

          {/* Delegation lives under Models & thinking: the slots bound the
              fleet a turn can spend, and the wake switch is what brings a
              finished sub-agent's result back into the conversation */}
          <Section title={t("Delegation")} index={2}>
            {!state.tools.includes("spawn_agent") ? (
              <div className="border-b border-line bg-orange-tint px-4 py-2 text-ui-sm leading-relaxed text-ink-2">
                {t("Agent team is not loaded. Install and enable the extension to get the sub-agent tools.")}
              </div>
            ) : null}
            <Row title={t("Sub-agent slots")} hint={t("how many sub-agents may run at once")}>
              <Select
                mono
                value={String(settings.agents?.maxConcurrent ?? 3)}
                options={["1", "2", "3", "4", "5", "6", "7", "8"]}
                onChange={(value) =>
                  onUpdate({
                    agents: {
                      maxConcurrent: Number(value),
                      wakeOnCompletion: settings.agents?.wakeOnCompletion ?? true,
                    },
                  })
                }
              />
            </Row>
            <Row title={t("Wake when agents finish")} hint={t("a finished sub-agent starts a new turn when the parent is idle")}>
              <Switch
                on={settings.agents?.wakeOnCompletion ?? true}
                onClick={() =>
                  onUpdate({
                    agents: {
                      maxConcurrent: settings.agents?.maxConcurrent ?? 3,
                      wakeOnCompletion: !(settings.agents?.wakeOnCompletion ?? true),
                    },
                  })
                }
              />
            </Row>
            {(settings.agents?.maxConcurrent ?? 3) >= 8 ? (
              <div className="flex items-start gap-2 border-b border-line bg-hot-tint px-4 py-2 text-ui-sm leading-snug text-ink-2">
                <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-hot" />
                <span>{t("Eight or more concurrent sub-agents can increase usage quickly. Codex warns at this threshold too.")}</span>
              </div>
            ) : null}
          </Section>
          </>
          ) : null}

          {category === "general" ? (
          <>
          <Section title={t("Desktop")} index={0}>
            <Row title={t("Completion sound")} hint={t("a short chime when a run finishes")}>
              <Switch on={soundOn} onClick={() => toggleSound(!soundOn)} />
            </Row>
            <Row title={t("Interface sounds")} hint={t("a quiet click on what you press, pitched to what it does")}>
              <Switch on={clickOn} onClick={() => toggleClick(!clickOn)} />
            </Row>
            <Row title={t("Windows notification")} hint={t("a toast when the run finishes while the window is in the background")}>
              <Switch on={notifyOn} onClick={() => toggleNotify(!notifyOn)} />
            </Row>
            <Row title={t("Sidebar grouping")} hint={t("workspaces follow folders; task groups lay every chat out flat")}>
              <Select
                value={sidebarGroup}
                options={["workspace", "date", "status", "groups"]}
                onChange={(value) => {
                  const group = value as WorkspacePrefs["group"];
                  setSidebarGroup(group);
                  saveSidebarPrefs({ ...loadSidebarPrefs(SIDEBAR_PREFS_DEFAULT), group });
                }}
              />
            </Row>
          </Section>

          <Section title={t("Images & output")} index={1}>
            <Row title={t("Block image input")} hint={t("stops attachments and screenshots from reaching the model")}>
              <Switch on={settings.blockImages} onClick={() => onUpdate({ blockImages: !settings.blockImages })} />
            </Row>
            <Row title={t("Auto-resize images")} hint={t("downscale to 2000×2000 before sending")}>
              <Switch on={settings.imageAutoResize} onClick={() => onUpdate({ imageAutoResize: !settings.imageAutoResize })} />
            </Row>
            <Row title={t("Hide thinking blocks")} hint={t("only affects rendering inside the Pi TUI")}>
              <Switch on={settings.hideThinkingBlock} onClick={() => onUpdate({ hideThinkingBlock: !settings.hideThinkingBlock })} />
            </Row>
            <Row title={t("Show cache-miss notices")} hint={t("flag significant prompt-cache misses in the transcript")}>
              <Switch
                on={settings.showCacheMissNotices}
                onClick={() => onUpdate({ showCacheMissNotices: !settings.showCacheMissNotices })}
              />
            </Row>
          </Section>

          <Section title={t("Context & retry")} index={2}>
            <Row title={t("Auto compaction")} hint={tf("keep {tokens} recent tokens", { tokens: settings.compaction.keepRecentTokens.toLocaleString() })}>
              <Switch on={settings.compaction.enabled} onClick={() => onUpdate({ compaction: { ...settings.compaction, enabled: !settings.compaction.enabled } })} />
            </Row>
            <Row title={t("Auto retry")} hint={tf("up to {n} attempts, base {ms} ms", { n: settings.retry.maxRetries, ms: settings.retry.baseDelayMs })}>
              <Switch on={settings.retry.enabled} onClick={() => onUpdate({ retry: { ...settings.retry, enabled: !settings.retry.enabled } })} />
            </Row>
          </Section>
          </>
          ) : null}

          {category === "agent" ? (
          <>
          <Section title={t("Conversation flow")} index={0}>
            <Row title={t("Message delivery")} hint={t("what happens to a message sent while the agent is working")}>
              <Select
                value={queueBehavior}
                options={["steer", "followUp"]}
                onChange={(value) => onQueueBehavior(value as QueueBehavior)}
              />
            </Row>
          </Section>

          <Section title={t("Terminal")} index={1}>
            <Row title={t("Terminal shell")} hint={t("what the terminal pane and the agent's commands start in")}>
              <Select
                value={terminal?.customPath ? "custom" : (terminal?.preferred ?? "auto")}
                options={IS_WINDOWS
                  ? ["auto", "powershell", "gitbash", "cmd"]
                  : ["auto", "path:/bin/zsh", "path:/bin/bash"]}
                onChange={(value) => {
                  if (value === "custom") return;
                  void window.pi
                    .updateSettings({ terminal: { preferred: value, customPath: undefined } })
                    .catch(() => undefined);
                }}
              />
            </Row>
            <Row title={t("Custom path")} hint={t("an absolute path to any shell executable")}>
              <input
                defaultValue={terminal?.customPath ?? ""}
                onBlur={(event) => setCustomShellPath(event.target.value)}
                placeholder={SHELL_EXAMPLE}
                className="h-[26px] w-56 rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink outline-none placeholder:text-ink-4 focus:border-accent"
              />
            </Row>
          </Section>

          <Section title={t("Agent shell")} index={2}>
            <Row
              title={t("Agent shell path")}
              hint={t("the bash the agent's own commands run in — must be bash-compatible; the terminal pane's choice above is separate")}
            >
              <input
                defaultValue={settings.shellPath ?? ""}
                onBlur={(event) => onUpdate({ shellPath: event.target.value.trim() })}
                placeholder={SHELL_EXAMPLE}
                className="h-[26px] w-56 rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink outline-none placeholder:text-ink-4 focus:border-accent"
              />
            </Row>
            <Row title={t("Command prefix")} hint={t("prepended to every command the agent runs")}>
              <input
                defaultValue={settings.shellCommandPrefix ?? ""}
                onBlur={(event) => onUpdate({ shellCommandPrefix: event.target.value.trim() })}
                placeholder="shopt -s expand_aliases"
                className="h-[26px] w-56 rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink outline-none placeholder:text-ink-4 focus:border-accent"
              />
            </Row>
            <Row title={t("npm command")} hint={t("argv used for package lookups; comma separated")}>
              <input
                defaultValue={(settings.npmCommand ?? []).join(", ")}
                onBlur={(event) =>
                  onUpdate({
                    npmCommand: event.target.value
                      .split(",")
                      .map((part) => part.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="npm"
                className="h-[26px] w-56 rounded-[5px] border border-input-line bg-page px-2 font-mono text-ui-meta text-ink outline-none placeholder:text-ink-4 focus:border-accent"
              />
            </Row>
          </Section>
          </>
          ) : null}

          {category === "remote" ? <SshServersSection /> : null}
          {category === "browser" ? (
          <Section title={t("Browser")} index={0}>
            <Row title={t("Embedded browser")} hint={t("an isolated Chromium session — site logins persist between runs")}>
            </Row>
            <Row title={t("Design mode")} hint={tf("Press {chord} in the browser panel, or the pencil in its top bar", { chord: chords.designMode ? formatChord(chords.designMode) : t("Unassigned") })}>
            </Row>
            <Row title={t("DevTools")} hint={t("the terminal button in the browser bar docks them on the right")}>
            </Row>
            <Row title={t("Agent tools")} hint={t("registered as a pi extension — seven tools, no MCP layer")}>
            </Row>
            <ExternalBrowserRow />
          </Section>
          ) : null}

          {category === "tasks" ? (
          <Section title={t("Task list")} index={0}>
            <Row title={t("Agent task list")} hint={t("the agent keeps it current through todo_write")}>
              <span className="text-ui-meta text-ink-2 tabular-nums">{state.todos.length} {t("items")}</span>
            </Row>
            <Row title={t("Persistence")} hint={t("written into the session file, so it survives a restart and travels with the session")}>
            </Row>
          </Section>
          ) : null}

          {category === "keyboard" ? <ShortcutsSection /> : null}

          {category === "hooks" ? <HooksSection /> : null}

          {category === "usage" ? (
            /* The usage dashboards, verbatim — they were a top-level view, and
               the data they show belongs with the rest of the read-only numbers
               rather than behind its own icon. */
            <UsageView
              embedded
              stats={usage}
              loading={usageLoading}
              range={usageRange}
              onRange={onUsageRange}
              onRefresh={onUsageRefresh}
            />
          ) : null}

          {category === "data" ? (
          <>
          <Section title={t("Data")} index={3}>
            <div className="px-4 py-1">
              <div className="border-b border-line">
                <TextRow label={t("Sessions")} value={state.sessions.length} meta={t("this project")} />
              </div>
              <div className="border-b border-line">
                <TextRow label={t("Model count")} value={state.models.length} meta={tf("{count} channels", { count: state.providers.length })} />
              </div>
              <div className="border-b border-line">
                <TextRow label={t("Task list")} value={state.todos.length} meta={t("items")} />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label={t("Active session")}
                  value={state.snapshot?.sessionId?.slice(0, 8) ?? "—"}
                  meta={state.snapshot?.sessionFile ? t("persisted") : t("not persisted")}
                />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label={t("Context window")}
                  value={
                    contextUsage
                      ? `${contextUsage.tokens != null ? contextUsage.tokens.toLocaleString() : "—"} / ${contextUsage.contextWindow.toLocaleString()}`
                      : "—"
                  }
                  meta={contextUsage?.percent != null ? `${Math.round(contextUsage.percent)}%` : undefined}
                />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label={t("Session tokens")}
                  value={tokens ? tokens.total.toLocaleString() : "—"}
                  meta={tokens ? tf("{cached} cached", { cached: tokens.cacheRead.toLocaleString() }) : undefined}
                />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label={t("Cost")}
                  value={state.snapshot?.stats ? `$${state.snapshot.stats.cost.toFixed(4)}` : "—"}
                  meta={t("this session")}
                />
              </div>
              <TextRow label={t("Directory")} value={<span className="font-mono text-ui-sm">{state.cwd}</span>} meta={t("sessions")} />
            </div>
          </Section>
          <Section title={t("About")} index={4}>
            <AboutRows />
          </Section>
          </>
          ) : null}
          </div>
          </div>
        </div>
    </div>
  );
}

/** The settings' own radio mark — a ring with a dot, matching the Switch's weight. */

/** Version + update check + diagnostics export — the support surface. */
function AboutRows() {
  const [check, setCheck] = useState<{ latest?: string; newer?: string | null; error?: string } | null>(null);
  const [exportPath, setExportPath] = useState("");
  return (
    <div className="px-4 py-1">
      <TextRow label={t("Version")} value="0.1.0" meta="Electron" />
      <div className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
        <div className="min-w-0 flex-1 text-ui-caption text-ink">{t("Updates")}</div>
        <button
          type="button"
          onClick={() => void window.pi.updateCheck().then((result) => setCheck(result))}
          className="pressable rounded-control border border-line px-3 py-1.5 text-ui-caption text-ink hover:bg-hover"
        >
          {t("Check for updates")}
        </button>
      </div>
      {check ? (
        <div className="pb-2 text-ui-xs text-ink-3">
          {check.error ? (
            <span className="text-red">{check.error}</span>
          ) : check.newer ? (
            <span className="text-orange">{tf("Version {version} is available on GitHub.", { version: check.newer })}</span>
          ) : (
            <span className="text-green">{t("Up to date")}</span>
          )}
        </div>
      ) : null}
      <div className="flex items-center gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-ui-caption text-ink">{t("Diagnostics")}</div>
          <div className="mt-0.5 text-ui-xs text-ink-3">{t("versions, settings and server names — no keys")}</div>
        </div>
        <button
          type="button"
          onClick={() =>
            void window.pi.exportDiagnostics().then((result) => setExportPath(result.ok ? result.output ?? "" : result.error ?? t("Failed")))
          }
          className="pressable rounded-control border border-line px-3 py-1.5 text-ui-caption text-ink hover:bg-hover"
        >
          {t("Export diagnostics")}
        </button>
      </div>
      {exportPath ? <div className="pb-2 break-all font-mono text-ui-xs text-ink-3">{exportPath}</div> : null}
    </div>
  );
}

/** "drive the real Chrome" — the CDP takeover switch and its status line. */
function ExternalBrowserRow() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Row title={t("External browser")} hint={t("drive the real Chrome over CDP — launches with a debug port, no extension needed")}>
      {status ? <span className="mr-1 text-ui-xs text-ink-3">{status}</span> : null}
      <button
        type="button"
        onClick={() =>
          void window.pi.externalBrowserLaunch().then((result) =>
            setStatus(result.ok ? t("Running") : (result.error ?? t("Failed"))),
          )
        }
        className="pressable rounded-control border border-line px-3 py-1.5 text-ui-caption text-ink hover:bg-hover"
      >
        {t("Launch with takeover")}
      </button>
    </Row>
  );
}
