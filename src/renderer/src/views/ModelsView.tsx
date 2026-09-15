import { useEffect, useMemo, useState } from "react";
import type { HostState, ModelEdit, ModelInfo } from "@shared/types";
import { formatContext } from "../lib/format";
import { cn } from "../lib/cn";
import { BrainIcon, CheckIcon, ImageIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon } from "../components/icons";
import { Card, Chip, EmptyState, Skeleton, ViewHeader } from "../components/ui";
import { stagger } from "../components/motion";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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
      <span className="text-[11.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[10.5px] text-ink-3">{hint}</span> : null}
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
      className="h-7 w-full rounded-control bg-field px-2 font-mono text-[12px] text-ink tabular-nums outline-none"
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
        className="pressable flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
      >
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
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
          "flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
          checked ? "border-ink bg-ink text-canvas" : "border-line-strong bg-field",
        )}
      >
        {checked ? <CheckIcon size={11} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink">{label}</span>
        {hint ? <span className="block text-[10.5px] text-ink-3">{hint}</span> : null}
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((model) => {
      if (provider !== "all" && model.provider !== provider) return false;
      if (!q) return true;
      return `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(q);
    });
  }, [models, query, provider]);

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

  const providerIds = useMemo(() => [...new Set(models.map((model) => model.provider))], [models]);

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
        title="Models"
        subtitle={`${models.length} authenticated models across ${state.providers.length} channels`}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="flex h-6 items-center gap-1.5 rounded-chip bg-field px-2">
              <SearchIcon size={12} className="text-ink-3" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter"
                className="w-24 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <Chip onClick={onRefresh} title="Reload models.json">
              <RefreshIcon size={12} />
              Reload
            </Chip>
            <Chip onClick={startNewModel} title="Add a model to models.json">
              <PlusIcon size={12} />
              Add
            </Chip>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
            <Chip active={provider === "all"} onClick={() => setProvider("all")} index={0}>
              All channels
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
                title="No authenticated models"
                body="Run `pi login` (or add a provider to ~/.pi/agent/models.json) and reload."
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 p-4">
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
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{model.name}</span>
                      {inUse ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-green-tint px-1.5 text-[10.5px] text-green">
                          <CheckIcon size={10} />
                          in use
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-[10px] text-ink-2">
                        {model.provider}
                      </span>
                      {model.reasoning ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-field px-1.5 text-[10px] text-ink-2">
                          <BrainIcon size={10} />
                          reasoning
                        </span>
                      ) : null}
                      {model.supportsImages ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-chip bg-field px-1.5 text-[10px] text-ink-2">
                          <ImageIcon size={10} />
                          vision
                        </span>
                      ) : null}
                      {model.source === "models.json" ? (
                        <span className="inline-flex h-5 items-center rounded-chip bg-orange-tint px-1.5 text-[10px] text-orange">
                          overridden
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-3 tabular-nums">
                      <span>ctx {formatContext(model.contextWindow)}</span>
                      <span>max {formatContext(model.maxTokens)}</span>
                      <span>{model.thinkingLevels.filter((level) => level !== "off").length} levels</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <div className="col-span-2">
                  <EmptyState title="No models match" body="Clear the search or switch channel." />
                </div>
              ) : null}
            </div>
          )}

          {state.providers.length ? (
            <div className="px-4 pb-4">
              <Card index={2} className="overflow-hidden">
                <div className="border-b border-line px-3 py-2 text-[12.5px] font-medium text-ink">Channels</div>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-3">
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">API</th>
                      <th className="px-3 py-2 text-right font-medium">Models</th>
                      <th className="px-3 py-2 font-medium">Auth</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.providers.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-0 hover:bg-hover">
                        <td className="px-3 py-2 text-ink">
                          {row.name}
                          <span className="ml-1.5 font-mono text-[10.5px] text-ink-3">{row.id}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{row.api}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.modelCount}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded-chip px-1.5 text-[10.5px]",
                              row.hasAuth ? "bg-green-tint text-green" : "bg-red-tint text-red",
                            )}
                          >
                            {row.hasAuth ? "configured" : "missing"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-ink-3">{row.editable ? "models.json" : "built-in"}</td>
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
                <div className="truncate text-[12.5px] font-medium text-ink">
                  {isNew ? "New model" : draft.id}
                </div>
                <div className="font-mono text-[10.5px] text-ink-3">
                  {isNew ? "written to models.json" : draft.provider}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="pressable rounded-[5px] px-1.5 py-0.5 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                Close
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {isNew ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Provider" hint="an id from models.json">
                    <input
                      list="pi-provider-ids"
                      value={draft.provider}
                      onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
                      placeholder="anthropic"
                      className="h-7 w-full rounded-control bg-field px-2 font-mono text-[12px] text-ink outline-none"
                    />
                  </Field>
                  <Field label="Model id" hint="as the provider spells it">
                    <input
                      value={draft.id}
                      onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                      placeholder="claude-sonnet-4-5"
                      className="h-7 w-full rounded-control bg-field px-2 font-mono text-[12px] text-ink outline-none"
                    />
                  </Field>
                  <datalist id="pi-provider-ids">
                    {providerIds.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              <Field label="Display name">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="h-7 w-full rounded-control bg-field px-2 text-[12px] text-ink outline-none"
                />
              </Field>

              <div className="flex items-center justify-between rounded-control bg-surface px-2.5 py-2 shadow-hairline">
                <div>
                  <div className="text-[12px] text-ink">Reasoning model</div>
                  <div className="text-[10.5px] text-ink-3">enables thinking levels</div>
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
                      transition: "transform 240ms cubic-bezier(0.23,1,0.32,1)",
                    }}
                  />
                </button>
              </div>

              {/* Ticking this writes the field it stands for: the provider's
                  `input` array is derived, never typed by hand. */}
              <Check
                checked={draft.input.includes("image")}
                onChange={(next) => setDraft({ ...draft, input: next ? ["text", "image"] : ["text"] })}
                label="Image input"
                hint='supports screenshots & photos — writes input: ["text", "image"]'
              />

              <div className="grid grid-cols-2 gap-2">
                <Field label="Context window" hint={formatContext(draft.contextWindow)}>
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
                      hint={`tick for ${ONE_MILLION.toLocaleString()} tokens`}
                    />
                  </div>
                </Field>
                <Field label="Max output" hint={formatContext(draft.maxTokens)}>
                  <NumberInput value={draft.maxTokens} onChange={(value) => setDraft({ ...draft, maxTokens: value })} />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-ink-2">Thinking level map</span>
                <span className="text-[10.5px] text-ink-3">
                  Map each Pi level to a provider value. Set to “— unsupported” to hide it.
                </span>
                {LEVELS.map((level) => {
                  const value = draft.thinkingLevelMap?.[level] ?? "";
                  const supported = draft.reasoning && value !== null;
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="w-16 font-mono text-[11px] text-ink-2">{level}</span>
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
                          "h-7 min-w-0 flex-1 rounded-control bg-field px-2 text-[11.5px] outline-none",
                          supported ? "text-ink" : "text-ink-3",
                          !draft.reasoning && "opacity-50",
                        )}
                      >
                        <option value="">default</option>
                        {LEVELS.filter((candidate) => candidate !== "off").map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                        <option value="__unsupported">— unsupported</option>
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
                  className="pressable-soft pressable h-7 rounded-control bg-ink text-[12px] font-medium text-canvas disabled:opacity-40"
                >
                  Use in this session
                </button>
                <button
                  type="button"
                  disabled={isNew}
                  onClick={() => onSetDefault(draft.provider, draft.id)}
                  className="pressable-soft pressable h-7 rounded-control bg-surface text-[12px] text-ink shadow-btn hover:bg-inset disabled:opacity-40"
                >
                  Set as startup default
                </button>
                <button
                  type="button"
                  disabled={!draft.provider.trim() || !draft.id.trim()}
                  onClick={() => {
                    onSave({ ...draft, name: draft.name.trim() || draft.id });
                    setSelectedKey(`${draft.provider}/${draft.id}`);
                  }}
                  className="pressable-soft pressable h-7 rounded-control bg-surface text-[12px] text-ink shadow-btn hover:bg-inset disabled:opacity-40"
                >
                  {isNew ? "Add to models.json" : "Save to models.json"}
                </button>
                <button
                  type="button"
                  disabled={state.models.find((item) => item.provider === draft.provider && item.id === draft.id)?.source !== "models.json"}
                  onClick={() => onDeleteOverride(draft.provider, draft.id)}
                  className="pressable-soft pressable flex h-7 items-center justify-center gap-1.5 rounded-control bg-surface text-[12px] text-red shadow-btn hover:bg-red-tint disabled:opacity-40"
                >
                  <TrashIcon size={12} />
                  Remove override
                </button>
              </div>

              <div className="rounded-control bg-inset px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink-3">
                {draft.provider}/{draft.id}
                <br />
                thinking: {draft.thinkingLevelMap ? `${Object.keys(draft.thinkingLevelMap).length} mapped` : "provider default"}
              </div>
            </div>
          </aside>
        ) : (
          <aside className="w-[320px] shrink-0 border-l border-line bg-canvas p-4">
            <Skeleton className="h-[120px]" />            <div className="mt-3 text-[11.5px] text-ink-3">
              Pick a model to configure thinking depth, image input, context window, and output limits. Changes are written to{" "}
              <span className="font-mono">~/.pi/agent/models.json</span> and picked up by the Pi CLI too.
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
