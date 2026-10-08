import { useEffect, useMemo, useState } from "react";
import type { HostState, ModelEdit, ModelInfo } from "@shared/types";
import { formatContext } from "../lib/format";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import { buildCatalogue, customFirst, filterCatalogue, isCustomModel, providerIdsCustomFirst } from "../lib/model-list";
import { BrainIcon, CheckIcon, ImageIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon, XIcon } from "../components/icons";
import { Card, Chip, EmptyState, Skeleton, ViewHeader } from "../components/ui";
import { stagger } from "../components/motion";
import { THINKING_LEVELS } from "@shared/thinking";


/** the sentinel `selectedKey` for a model that does not exist yet */
const NEW_KEY = "__new__";

/** One round million, the number every "1M context" model actually declares. */
const ONE_MILLION = 1_000_000;

function draftFrom(model: ModelInfo): ModelEdit {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.supportsImages ? ["text", "image"] : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    thinkingLevelMap: model.thinkingLevelMap,
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ui-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-ui-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={0}
      step={1000}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
      className="h-7 w-full rounded-control bg-field px-2 font-mono text-ui-caption text-ink tabular-nums outline-none"
    />
  );
}

/**
 * A checkbox, and the reason it is not a switch.
 *
 * Switches are for a state that stays switched on; these two answers — "does
 * this model read images", "is the window a round million" — are facts about a
 * record that is about to be written to models.json, so they read as boxes you
 * tick. Ticking one fills the field it belongs to (`input`, `contextWindow`)
 * rather than asking the user to type the same fact twice.
 */
function Check({
  checked,
  onChange,
  label,
  hint,
  compact = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        title={hint ?? label}
        className="pressable flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-field px-2 text-ui-sm text-ink-2 hover:bg-hover-2"
      >
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-tiny border",
            checked ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface",
          )}
        >
          {checked ? <CheckIcon size={10} strokeWidth={3.2} /> : null}
        </span>
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="pressable-soft pressable flex w-full items-center gap-2.5 rounded-control bg-surface px-2.5 py-2 text-left shadow-hairline hover:bg-inset"
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-chip border",
          checked ? "border-ink bg-ink text-canvas" : "border-line-strong bg-field",
        )}
      >
        {checked ? <CheckIcon size={11} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui-caption text-ink">{label}</span>
        {hint ? <span className="block text-ui-xs text-ink-3">{hint}</span> : null}
      </span>
    </button>
  );
}

export function ModelsView({
  state,
  onRefresh,
  onUseModel,
  onSave,
  onDeleteOverride,
  onSetDefault,
}: {
  state: HostState;
  onRefresh: () => void;
  onUseModel: (provider: string, modelId: string) => void;
  onSave: (edit: ModelEdit) => void;
  onDeleteOverride: (provider: string, modelId: string) => void;
  onSetDefault: (provider: string, modelId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelEdit | null>(null);
  const isNew = selectedKey === NEW_KEY;

  const models = state.models;
  const channels = state.channels;

  /* The catalogue is indexed once per host update — the filter then walks a
     prebuilt lowercased haystack rather than rebuilding one per keystroke. */
  const catalogue = useMemo(() => buildCatalogue(models, channels), [models, channels]);

  const filtered = useMemo(() => {
    const matched = filterCatalogue(catalogue, query);
    const forProvider =
      provider === "all" ? matched : matched.filter((entry) => entry.model.provider === provider);
    /* the models the user can edit come before the ones pi ships */
    return customFirst(
      forProvider.map((entry) => entry.model),
      isCustomModel,
    );
  }, [catalogue, query, provider]);

  const current = state.snapshot?.model;

  useEffect(() => {
    if (!selectedKey || selectedKey === NEW_KEY) {
      if (!selectedKey) setDraft(null);
      return;
    }
    const model = models.find((item) => `${item.provider}/${item.id}` === selectedKey);
    setDraft(model ? draftFrom(model) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, models.length]);

  const providerIds = useMemo(() => providerIdsCustomFirst(models, channels), [models, channels]);

  /* the table below the grid reads provider rows, so its own custom-first order
     comes from `editable` — the provider-row spelling of models.json-owned */
  const providerRows = useMemo(() => customFirst(state.providers, (row) => row.editable), [state.providers]);

  /** A new record: seeded with the channel you are already filtering by, and a
   *  1M window because that is the answer for every current frontier model. */
  const startNewModel = () => {
    const first = provider !== "all" ? provider : providerIds[0] ?? state.providers[0]?.id ?? "";
    setSelectedKey(NEW_KEY);
    setDraft({
      provider: first,
      id: "",
      name: "",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 64_000,
    });
  };

  return (
    <>
      <ViewHeader
        title={t("Models")}
        subtitle={tf("{count} authenticated models across {channels} channels", {
          count: models.length,
          channels: state.providers.length,
        })}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="flex h-6 items-center gap-1.5 rounded-chip bg-field px-2">
              <SearchIcon size={12} className="shrink-0 text-ink-3" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  /* a filter box, not an overlay: Escape empties it, the gesture
                     the settings rail's own search already uses */
                  if (event.key === "Escape") setQuery("");
                }}
                placeholder={t("Filter")}
                aria-label={t("Filter")}
                className="w-24 bg-transparent text-ui-sm text-ink outline-none placeholder:text-ink-4"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t("Clear search")}
                  onClick={() => setQuery("")}
                  className="pressable flex size-4 shrink-0 items-center justify-center rounded-tiny text-ink-3 hover:text-ink"
                >
                  <XIcon size={10} />
                </button>
              ) : null}
            </div>
            <Chip onClick={onRefresh} title={t("Reload models.json")}>
              <RefreshIcon size={12} />
              {t("Reload")}
            </Chip>
            <Chip onClick={startNewModel} title={t("Add a model to models.json")}>
              <PlusIcon size={12} />
              {t("Add")}
            </Chip>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
            <Chip active={provider === "all"} onClick={() => setProvider("all")} index={0}>
              {t("All channels")}
            </Chip>
            {providerIds.map((id, index) => (
              <Chip key={id} active={provider === id} onClick={() => setProvider(id)} index={index + 1}>
                {id}
              </Chip>
            ))}
          </div>

          {models.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t("No authenticated models")}
                body={t("Run `pi login` (or add a provider to ~/.pi/agent/models.json) and reload.")}
              />
            </div>
          ) : (
            /* the grid is the tallest block on this view; capping it keeps the
               channel table below within reach instead of behind the rows */
            <div className="scrollbar-thin max-h-[52vh] overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2.5">
                {filtered.map((model, index) => {
                const key = `${model.provider}/${model.id}`;
                const active = selectedKey === key;
                const inUse = current?.provider === model.provider && current?.id === model.id;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(active ? null : key)}
                    style={stagger(index)}
                    className={cn(
                      "stagger pressable-soft pressable flex flex-col gap-2 rounded-card p-3 text-left shadow-card",
                      active ? "bg-accent-tint" : "bg-surface hover:bg-hover",
                    )}
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-ui-caption font-medium text-ink">{model.name}</span>
                      {inUse ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-green-tint px-1.5 text-ui-xs text-green">
                          <CheckIcon size={10} />
                          {t("in use")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-ui-xs text-ink-2">
                        {model.provider}
                      </span>
                      {model.reasoning ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-field px-1.5 text-ui-xs text-ink-2">
                          <BrainIcon size={10} />
                          {t("reasoning")}
                        </span>
                      ) : null}
                      {model.supportsImages ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-field px-1.5 text-ui-xs text-ink-2">
                          <ImageIcon size={10} />
                          {t("vision")}
                        </span>
                      ) : null}
                      {model.source === "models.json" ? (
                        <span className="inline-flex h-5 items-center rounded-chip bg-orange-tint px-1.5 text-ui-xs text-orange">
                          {t("overridden")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-ui-xs text-ink-3 tabular-nums">
                      <span>ctx {formatContext(model.contextWindow)}</span>
                      <span>max {formatContext(model.maxTokens)}</span>
                      <span>
                        {/* Ultra is the desktop's overlay on Max, not a depth the
                            channel serves, so it is not counted here */}
                        {model.thinkingLevels.filter((level) => level !== "off" && level !== "ultra").length}{" "}
                        {t("levels")}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <div className="col-span-2">
                  <EmptyState title={t("No models match")} body={t("Clear the search or switch channel.")} />
                </div>
              ) : null}
              </div>
            </div>
          )}

          {providerRows.length ? (
            <div className="px-4 pb-4">
              <Card index={2} className="overflow-hidden">
                <div className="border-b border-line px-3 py-2 text-ui-caption font-medium text-ink">{t("Channels")}</div>
                <table className="w-full border-collapse text-ui-caption">
                  <thead>
                    <tr className="border-b border-line text-left text-ui-sm text-ink-3">
                      <th className="px-3 py-2 font-medium">{t("Provider")}</th>
                      <th className="px-3 py-2 font-medium">{t("API")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Models")}</th>
                      <th className="px-3 py-2 font-medium">{t("Auth")}</th>
                      <th className="px-3 py-2 font-medium">{t("Source")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerRows.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-0 hover:bg-hover">
                        <td className="px-3 py-2 text-ink">
                          {row.name}
                          <span className="ml-1.5 font-mono text-ui-xs text-ink-3">{row.id}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-ui-sm text-ink-3">{row.api}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.modelCount}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded-chip px-1.5 text-ui-xs",
                              row.hasAuth ? "bg-green-tint text-green" : "bg-red-tint text-red",
                            )}
                          >
                            {row.hasAuth ? t("configured") : t("missing")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ui-sm text-ink-3">
                          {row.editable ? "models.json" : t("built-in")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ) : null}
        </div>

        {draft ? (
          <aside
            key={selectedKey ?? "inspector"}
            className="animate-slide-in-right scrollbar-thin w-[320px] shrink-0 overflow-y-auto border-l border-line bg-canvas p-3"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-caption font-medium text-ink">
                  {isNew ? t("New model") : draft.id}
                </div>
                <div className="font-mono text-ui-xs text-ink-3">
                  {isNew ? t("written to models.json") : draft.provider}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="pressable rounded-chip px-1.5 py-0.5 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink"
              >
                {t("Close")}
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {isNew ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("Provider")} hint={t("an id from models.json")}>
                    <input
                      list="pi-provider-ids"
                      value={draft.provider}
                      onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
                      placeholder="anthropic"
                      className="h-7 w-full rounded-control bg-field px-2 font-mono text-ui-caption text-ink outline-none"
                    />
                  </Field>
                  <Field label={t("Model id")} hint={t("as the provider spells it")}>
                    <input
                      value={draft.id}
                      onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                      placeholder="claude-sonnet-4-5"
                      className="h-7 w-full rounded-control bg-field px-2 font-mono text-ui-caption text-ink outline-none"
                    />
                  </Field>
                  <datalist id="pi-provider-ids">
                    {providerIds.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              <Field label={t("Display name")}>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="h-7 w-full rounded-control bg-field px-2 text-ui-caption text-ink outline-none"
                />
              </Field>

              <div className="flex items-center justify-between rounded-control bg-surface px-2.5 py-2 shadow-hairline">
                <div>
                  <div className="text-ui-caption text-ink">{t("Reasoning model")}</div>
                  <div className="text-ui-xs text-ink-3">{t("enables thinking levels")}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, reasoning: !draft.reasoning })}
                  className={cn("pressable relative h-[18px] w-8 rounded-full", draft.reasoning ? "bg-green" : "bg-line-strong")}
                  style={{ transition: "background-color 200ms ease-out" }}
                >
                  <span
                    className="absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow"
                    style={{
                      transform: draft.reasoning ? "translateX(14px)" : "translateX(0)",
                      transition: "transform 240ms var(--ease-out-strong-css)",
                    }}
                  />
                </button>
              </div>

              {/* Ticking this writes the field it stands for: the provider's
                  `input` array is derived, never typed by hand. */}
              <Check
                checked={draft.input.includes("image")}
                onChange={(next) => setDraft({ ...draft, input: next ? ["text", "image"] : ["text"] })}
                label={t("Image input")}
                hint={t('supports screenshots & photos — writes input: ["text", "image"]')}
              />

              <div className="grid grid-cols-2 gap-2">
                <Field label={t("Context window")} hint={formatContext(draft.contextWindow)}>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={draft.contextWindow}
                      onChange={(value) => setDraft({ ...draft, contextWindow: value })}
                    />
                    <Check
                      compact
                      checked={draft.contextWindow === ONE_MILLION}
                      onChange={(next) =>
                        setDraft({ ...draft, contextWindow: next ? ONE_MILLION : draft.contextWindow })
                      }
                      label="1M"
                      hint={tf("tick for {count} tokens", { count: ONE_MILLION.toLocaleString() })}
                    />
                  </div>
                </Field>
                <Field label={t("Max output")} hint={formatContext(draft.maxTokens)}>
                  <NumberInput value={draft.maxTokens} onChange={(value) => setDraft({ ...draft, maxTokens: value })} />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-ui-sm font-medium text-ink-2">{t("Thinking level map")}</span>
                <span className="text-ui-xs text-ink-3">
                  {t("Map each Pi level to a provider value. Set to “— unsupported” to hide it.")}
                </span>
                {THINKING_LEVELS.map((level) => {
                  const value = draft.thinkingLevelMap?.[level] ?? "";
                  const supported = draft.reasoning && value !== null;
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="w-16 font-mono text-ui-sm text-ink-2">{level}</span>
                      <select
                        disabled={!draft.reasoning}
                        value={value === null ? "__unsupported" : value}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDraft({
                            ...draft,
                            thinkingLevelMap: {
                              ...(draft.thinkingLevelMap ?? {}),
                              [level]: next === "__unsupported" ? null : next,
                            },
                          });
                        }}
                        className={cn(
                          "h-7 min-w-0 flex-1 rounded-control bg-field px-2 text-ui-sm outline-none",
                          supported ? "text-ink" : "text-ink-3",
                          !draft.reasoning && "opacity-50",
                        )}
                      >
                        <option value="">{t("default")}</option>
                        {THINKING_LEVELS.filter((candidate) => candidate !== "off").map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                        <option value="__unsupported">{t("— unsupported")}</option>
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  disabled={isNew}
                  onClick={() => {
                    onUseModel(draft.provider, draft.id);
                  }}
                  className="pressable-soft pressable h-7 rounded-control bg-ink text-ui-caption font-medium text-canvas disabled:opacity-40"
                >
                  {t("Use in this session")}
                </button>
                <button
                  type="button"
                  disabled={isNew}
                  onClick={() => onSetDefault(draft.provider, draft.id)}
                  className="pressable-soft pressable h-7 rounded-control bg-surface text-ui-caption text-ink shadow-btn hover:bg-inset disabled:opacity-40"
                >
                  {t("Set as startup default")}
                </button>
                <button
                  type="button"
                  disabled={!draft.provider.trim() || !draft.id.trim()}
                  onClick={() => {
                    onSave({ ...draft, name: draft.name.trim() || draft.id });
                    setSelectedKey(`${draft.provider}/${draft.id}`);
                  }}
                  className="pressable-soft pressable h-7 rounded-control bg-surface text-ui-caption text-ink shadow-btn hover:bg-inset disabled:opacity-40"
                >
                  {isNew ? t("Add to models.json") : t("Save to models.json")}
                </button>
                <button
                  type="button"
                  disabled={state.models.find((item) => item.provider === draft.provider && item.id === draft.id)?.source !== "models.json"}
                  onClick={() => onDeleteOverride(draft.provider, draft.id)}
                  className="pressable-soft pressable flex h-7 items-center justify-center gap-1.5 rounded-control bg-surface text-ui-caption text-red shadow-btn hover:bg-red-tint disabled:opacity-40"
                >
                  <TrashIcon size={12} />
                  {t("Remove override")}
                </button>
              </div>

              <div className="rounded-control bg-inset px-2.5 py-2 font-mono text-ui-xs leading-relaxed text-ink-3">
                {draft.provider}/{draft.id}
                <br />
                {t("thinking:")}{" "}
                {draft.thinkingLevelMap
                  ? `${Object.keys(draft.thinkingLevelMap).length} ${t("mapped")}`
                  : t("provider default")}
              </div>
            </div>
          </aside>
        ) : (
          <aside className="w-[320px] shrink-0 border-l border-line bg-canvas p-4">
            <Skeleton className="h-[120px]" />            <div className="mt-3 text-ui-sm text-ink-3">
              {t("Pick a model to configure thinking depth, image input, context window, and output limits. Changes are written to")}{" "}
              <span className="font-mono">~/.pi/agent/models.json</span> {t("and picked up by the Pi CLI too.")}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
