import { useMemo, useState } from "react";
import type { HostState, RuntimeSettings, UsageStats } from "@shared/types";
import { cn } from "../lib/cn";
import {
  ArrowLeftIcon,
  BrainIcon,
  CheckCircleIcon,
  DatabaseIcon,
  FilePenIcon,
  GaugeIcon,
  GlobeIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
  XIcon,
} from "../components/icons";
import { Card, Chip, ViewHeader } from "../components/ui";
import { GlideList } from "../components/motion";
import { NavRow } from "../components/NavRow";
import { TextRow } from "../components/beautiful/atoms/TextRow";
import { AppearanceSection } from "../components/panel/AppearanceSection";
import type { ColorMode } from "../lib/theme";
import FineTuneCard from "../components/beautiful/primitives/FineTuneCard";
import { UsageView } from "./UsageView";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Card with a glide highlight that travels between its rows. */
function Section({
  title,
  index,
  children,
}: {
  title: string;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <Card index={index}>
      <div className="border-b border-line px-3 py-2 text-[12.5px] font-medium text-ink">{title}</div>
      <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
        {children}
      </GlideList>
    </Card>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-row
      className="relative z-10 flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">{title}</div>
        {hint ? <div className="truncate text-[10.5px] text-ink-3">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("pressable relative h-[18px] w-8 rounded-full", on ? "bg-green" : "bg-line-strong")}
      style={{ transition: "background-color 200ms ease-out" }}
    >
      <span
        className="absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow"
        style={{
          transform: on ? "translateX(14px)" : "translateX(0)",
          transition: "transform 240ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />
    </button>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 rounded-control bg-field px-2 text-[11.5px] text-ink outline-none transition-shadow duration-150 focus:shadow-[0_0_0_3px_var(--accent-tint)]"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

type SettingsCategory = "appearance" | "general" | "models" | "terminal" | "browser" | "tasks" | "data" | "usage";

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
    ],
  },
  {
    label: "Agent",
    items: [
      { key: "models", label: "Models & thinking", icon: <BrainIcon size={14} /> },
      { key: "tasks", label: "Tasks", icon: <CheckCircleIcon size={14} /> },
      { key: "terminal", label: "Terminal", icon: <TerminalIcon size={14} /> },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "browser", label: "Browser & network", icon: <GlobeIcon size={14} /> },
      { key: "data", label: "Data", icon: <DatabaseIcon size={14} /> },
      { key: "usage", label: "Usage & cache", icon: <GaugeIcon size={14} /> },
    ],
  },
];

const ALL_ROWS = GROUPS.flatMap((group) => group.items);

export function SettingsView({
  state,
  colorMode,
  onColorMode,
  onUpdate,
  onReload,
  onBack,
  dockToggle,
  usage,
  usageLoading,
  usageRange,
  onUsageRange,
  onUsageRefresh,
}: {
  state: HostState;
  colorMode: ColorMode;
  onColorMode: (mode: ColorMode) => void;
  onUpdate: (patch: Partial<RuntimeSettings>) => void;
  onReload: () => void;
  /** leave settings and return to the conversation */
  onBack: () => void;
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
  const [budgetDraft, setBudgetDraft] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [query, setQuery] = useState("");

  const modelKeys = state.models.map((model) => `${model.provider}/${model.id}`);

  /* searching filters the rail; empty groups drop out entirely */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const sessionFile = state.snapshot?.sessionFile;
  /* named `contextUsage` so it does not collide with the `usage` prop, which is
     the token ledger rather than the current window's fill */
  const contextUsage = state.snapshot?.stats?.contextUsage;
  const tokens = state.snapshot?.stats?.tokens;

  return (
    <div className="flex min-h-0 flex-1">
      {/* category rail — the reference layout: a search field, then grouped
          rows with an icon each and a rule between groups. It runs the full
          height of the window because settings *is* this rail: the session
          pane stands down for this view rather than the app opening a small
          settings panel inside the agent shell. */}
      <nav className="flex w-[232px] shrink-0 flex-col border-r border-line bg-canvas">
        {/* Back: settings is a place you enter from the shell, so the first thing
            in the rail is the way out of it rather than a category. */}
        <div className="shrink-0 px-2 pt-2">
          <NavRow
            icon={<ArrowLeftIcon size={15} />}
            label="Back"
            onClick={onBack}
            className="text-ink-2"
            data-nav-back
          />
        </div>
        <div className="shrink-0 p-2">
          <label className="flex h-8 items-center gap-1.5 rounded-[7px] bg-surface px-2 shadow-hairline transition-shadow duration-150 focus-within:shadow-btn">
            <SearchIcon size={13} className="shrink-0 text-ink-3" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="pressable flex size-4 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:text-ink"
              >
                  <XIcon size={11} />
                </button>
              ) : null}
            </label>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {groups.map((group, groupIndex) => (
              <div key={group.label ?? "top"}>
                {group.label ? (
                  <div className="px-2 pt-3 pb-1 text-[10.5px] tracking-[0.4px] text-ink-3">{group.label}</div>
                ) : (
                  groupIndex > 0 && <div className="pt-1" />
                )}
                <GlideList rowSelector="[data-cat]" highlightClassName="bg-hover-2" radius={7}>
                  {group.items.map((entry) => {
                    const active = category === entry.key;
                    return (
                      <NavRow
                        key={entry.key}
                        data-cat="row"
                        raised
                        active={active}
                        icon={entry.icon}
                        label={entry.label}
                        onClick={() => setCategory(entry.key)}
                      />
                    );
                  })}
                </GlideList>
                {groupIndex < groups.length - 1 ? <div className="my-1.5 h-px bg-line" /> : null}
              </div>
            ))}
            {!groups.length ? (
              <div className="px-2 py-3 text-[11.5px] text-ink-3">
                Nothing matches “{query}”. The list has {ALL_ROWS.length} sections.
              </div>
            ) : null}

            {/* the reference's trailing external row: jump to the files behind
                these settings */}
            <div className="my-1.5 h-px bg-line" />
            <NavRow
              icon={<FilePenIcon size={13} />}
              label="Transcript"
              disabled={!sessionFile}
              title={sessionFile ?? "No session file yet"}
              onClick={() => sessionFile && void window.pi.showItem(sessionFile)}
              trailing={
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              }
            />
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <ViewHeader
            title="Settings"
            subtitle="Written to ~/.pi/agent/settings.json — the Pi CLI reads the same file"
            actions={
              <div className="flex items-center gap-1.5">
                <Chip onClick={onReload}>
                  <RefreshIcon size={12} />
                  Reload session
                </Chip>
                {dockToggle}
              </div>
            }
          />
          <div key={category} className="view-enter scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {/* the usage dashboards own the full width — charts and tables do not
              read well squeezed into the settings column */}
          <div className={cn("mx-auto flex w-full flex-col gap-3 p-4", category === "usage" ? "max-w-[1100px]" : "max-w-[720px]")}>
          {category === "appearance" ? (
          <div className="flex flex-col gap-5">
            <AppearanceSection mode={colorMode} onMode={onColorMode} />

            {/* reserved: accent themes are not built yet */}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2 px-0.5">
                <h2 className="text-[12.5px] font-medium text-ink">Theme</h2>
                <span className="text-[11px] text-ink-3">accent palette — coming later</span>
              </div>
              <div className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-[12px] text-ink-3">
                No themes yet. The choice is stored, so whatever ships next will be picked up automatically.
              </div>
            </section>
          </div>
          ) : null}

          {category === "models" ? (
          <Section title="Model &amp; thinking" index={0}>
            <Row title="Startup thinking level" hint="used when a session starts without a saved level">
              <Select
                value={settings.defaultThinkingLevel ?? "medium"}
                options={LEVELS}
                onChange={(value) => onUpdate({ defaultThinkingLevel: value })}
              />
            </Row>
            {modelKeys.map((key) => (
              <Row key={key} title={`Default level · ${key}`} hint="per-model override">
                <Select
                  value={settings.modelThinkingLevels[key] ?? "inherit"}
                  options={["inherit", ...LEVELS]}
                  onChange={(value) => {
                    const next = { ...settings.modelThinkingLevels };
                    if (value === "inherit") delete next[key];
                    else next[key] = value;
                    onUpdate({ modelThinkingLevels: next });
                  }}
                />
              </Row>
            ))}
            <Row title="Thinking token budgets" hint="applies to providers that accept explicit budgets">
              <div className="flex items-center gap-1.5">
                {(["minimal", "low", "medium", "high"] as const).map((level) => (
                  <label key={level} className="flex items-center gap-1">
                    <span className="font-mono text-[10.5px] text-ink-3">{level.slice(0, 3)}</span>
                    <input
                      type="number"
                      step={512}
                      value={budgetDraft[level] ?? settings.thinkingBudgets?.[level] ?? 0}
                      onChange={(event) => setBudgetDraft({ ...budgetDraft, [level]: Number(event.target.value) || 0 })}
                      className="h-7 w-20 rounded-control bg-field px-2 font-mono text-[11px] text-ink tabular-nums outline-none"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => onUpdate({ thinkingBudgets: budgetDraft as Record<string, number> })}
                  className="pressable-soft pressable h-7 rounded-control bg-surface px-2 text-[11.5px] text-ink shadow-btn hover:bg-inset"
                >
                  Apply
                </button>
              </div>
            </Row>
          </Section>
          ) : null}

          {category === "models" ? (
          <FineTuneCard
            labels={{ title: "Thinking budget", layout: "Budgets by level", type: "Default level", placeholder: "Select a level", adjust: "Apply", edited: "Pending" }}
            fields={[
              { key: "minimal", label: "Min", value: settings.thinkingBudgets?.minimal ?? 1024, min: 0, max: 65536, step: 256 },
              { key: "low", label: "Low", value: settings.thinkingBudgets?.low ?? 4096, min: 0, max: 65536, step: 256 },
              { key: "medium", label: "Med", value: settings.thinkingBudgets?.medium ?? 10240, min: 0, max: 131072, step: 512 },
              { key: "high", label: "High", value: settings.thinkingBudgets?.high ?? 32768, min: 0, max: 131072, step: 512 },
            ]}
            options={LEVELS}
            onChange={(next) => onUpdate({ thinkingBudgets: next.values as Record<string, number> })}
          />
          ) : null}

          {category === "general" ? (
          <>
          <Section title="Images &amp; output" index={1}>
            <Row title="Block image input" hint="stops attachments and screenshots from reaching the model">
              <Switch on={settings.blockImages} onClick={() => onUpdate({ blockImages: !settings.blockImages })} />
            </Row>
            <Row title="Auto-resize images" hint="downscale to 2000×2000 before sending">
              <Switch on={settings.imageAutoResize} onClick={() => onUpdate({ imageAutoResize: !settings.imageAutoResize })} />
            </Row>
            <Row title="Hide thinking blocks" hint="only affects rendering inside the Pi TUI">
              <Switch on={settings.hideThinkingBlock} onClick={() => onUpdate({ hideThinkingBlock: !settings.hideThinkingBlock })} />
            </Row>
            <Row title="Show cache-miss notices" hint="flag significant prompt-cache misses in the transcript">
              <Switch
                on={settings.showCacheMissNotices}
                onClick={() => onUpdate({ showCacheMissNotices: !settings.showCacheMissNotices })}
              />
            </Row>
          </Section>

          <Section title="Context &amp; retry" index={2}>
            <Row title="Auto compaction" hint={`keep ${settings.compaction.keepRecentTokens.toLocaleString()} recent tokens`}>
              <Switch on={settings.compaction.enabled} onClick={() => onUpdate({ compaction: { ...settings.compaction, enabled: !settings.compaction.enabled } })} />
            </Row>
            <Row title="Auto retry" hint={`up to ${settings.retry.maxRetries} attempts, base ${settings.retry.baseDelayMs} ms`}>
              <Switch on={settings.retry.enabled} onClick={() => onUpdate({ retry: { ...settings.retry, enabled: !settings.retry.enabled } })} />
            </Row>
          </Section>
          </>
          ) : null}

          {category === "terminal" ? (
          <Section title="Shell" index={0}>
            <Row title="Shell path" hint="empty uses the system default">
              <input
                defaultValue={settings.shellPath ?? ""}
                onBlur={(event) => onUpdate({ shellPath: event.target.value.trim() })}
                placeholder="D:/Git/bin/bash.exe"
                className="h-7 w-56 rounded-control bg-field px-2 font-mono text-[11px] text-ink outline-none"
              />
            </Row>
            <Row title="Command prefix" hint="prepended to every command the agent runs">
              <input
                defaultValue={settings.shellCommandPrefix ?? ""}
                onBlur={(event) => onUpdate({ shellCommandPrefix: event.target.value.trim() })}
                placeholder="shopt -s expand_aliases"
                className="h-7 w-56 rounded-control bg-field px-2 font-mono text-[11px] text-ink outline-none"
              />
            </Row>
            <Row title="npm command" hint="argv used for package lookups; comma separated">
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
                className="h-7 w-56 rounded-control bg-field px-2 font-mono text-[11px] text-ink outline-none"
              />
            </Row>
            <Row title="Panel" hint="the Shell panel runs through the agent's bash tool, so output joins the conversation">
              <span className="font-mono text-[11px] text-ink-3">session.executeBash</span>
            </Row>
          </Section>
          ) : null}

          {category === "browser" ? (
          <Section title="Browser" index={0}>
            <Row title="Embedded browser" hint="an isolated Chromium session — site logins persist between runs">
              <span className="font-mono text-[11px] text-ink-3">persist:pi-browser</span>
            </Row>
            <Row title="Design mode" hint="Shift+Ctrl+D in the browser panel, or the pencil in its top bar">
              <span className="font-mono text-[11px] text-ink-3">click to select · drag to draw</span>
            </Row>
            <Row title="DevTools" hint="the terminal button in the browser bar docks them on the right">
              <span className="font-mono text-[11px] text-ink-3">openDevTools(right)</span>
            </Row>
            <Row title="Agent tools" hint="registered as a pi extension — seven tools, no MCP layer">
              <span className="font-mono text-[11px] text-ink-3">browser_*</span>
            </Row>
          </Section>
          ) : null}

          {category === "tasks" ? (
          <Section title="Tasks" index={0}>
            <Row title="Agent task list" hint="the agent keeps it current through todo_write">
              <span className="font-mono text-[11px] text-ink-3">{state.todos.length} item(s)</span>
            </Row>
            <Row title="Persistence" hint="written into the session file, so it survives a restart and travels with the session">
              <span className="font-mono text-[11px] text-ink-3">pi.appendEntry</span>
            </Row>
          </Section>
          ) : null}

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
          <Section title="Data" index={3}>
            <div className="px-4 py-1">
              <div className="border-b border-line">
                <TextRow label="Sessions" value={state.sessions.length} meta="this project" />
              </div>
              <div className="border-b border-line">
                <TextRow label="Models" value={state.models.length} meta={`${state.providers.length} channels`} />
              </div>
              <div className="border-b border-line">
                <TextRow label="Task list" value={state.todos.length} meta="items" />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label="Active session"
                  value={state.snapshot?.sessionId?.slice(0, 8) ?? "—"}
                  meta={state.snapshot?.sessionFile ? "persisted" : "not persisted"}
                />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label="Context window"
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
                  label="Session tokens"
                  value={tokens ? tokens.total.toLocaleString() : "—"}
                  meta={tokens ? `${tokens.cacheRead.toLocaleString()} cached` : undefined}
                />
              </div>
              <div className="border-b border-line">
                <TextRow
                  label="Cost"
                  value={state.snapshot?.stats ? `$${state.snapshot.stats.cost.toFixed(4)}` : "—"}
                  meta="this session"
                />
              </div>
              <TextRow label="Directory" value={<span className="font-mono text-[11px]">{state.cwd}</span>} meta="sessions" />
            </div>
          </Section>
          ) : null}
          </div>
          </div>
        </div>
    </div>
  );
}
