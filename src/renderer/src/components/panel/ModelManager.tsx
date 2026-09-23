import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelEdit, ModelInfo } from "@shared/types";
import { inferModelCapabilities, type ModelCapabilityGuess } from "@shared/model-capabilities";
import { cn } from "../../lib/cn";
import { formatContext } from "../../lib/format";
import { t, tf } from "../../lib/i18n";
import { useFocusTrap } from "../motion";
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "../icons";
import { Chip } from "../ui";
import { Section } from "./SettingsParts";

/**
 * Model management, in the settings page rather than behind a second view.
 *
 * The list, the enable switch and the editor were previously split: the only
 * way to add a model was the Customize view's inspector, and the only way to
 * see whether it worked was to change session — the write happened, the list
 * did not. Both live here now, next to the thinking overrides they configure,
 * and every action reports what happened through the shell's notice stack.
 */

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The `input[]` values a provider model can declare, in the order they are offered. */
const INPUT_KINDS = ["text", "image", "video", "pdf"] as const;
type InputKind = (typeof INPUT_KINDS)[number];

/** Whether the id-reading helper pre-fills the form; a per-machine preference. */
const SMART_KEY = "pi-model-smart-config";

/** the sentinel `editing` value for a model that does not exist yet */
const NEW = "__new__";

const keyOf = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;

function draftFromModel(model: ModelInfo): ModelEdit {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.input.length ? model.input : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    thinkingLevelMap: model.thinkingLevelMap,
  };
}

/** A new record starts from the channel the list is showing and nothing else —
 *  the smart switch, when it is on, fills the capabilities from the id. */
function emptyDraft(provider: string): ModelEdit {
  return {
    provider,
    id: "",
    name: "",
    reasoning: true,
    input: ["text"],
    contextWindow: 0,
    maxTokens: 0,
  };
}

export function ModelManagerSection({
  models,
  enabledKeys,
  currentKey,
  onSave,
  onDelete,
  onSetEnabled,
}: {
  /** every model the runtime knows, disabled ones included */
  models: ModelInfo[];
  /** the keys a picker may offer — `models` minus the disabled ones */
  enabledKeys: string[];
  /** the session's model, marked so it is not switched off by accident */
  currentKey: string | null;
  onSave: (edit: ModelEdit) => Promise<void>;
  onDelete: (provider: string, modelId: string) => Promise<void>;
  onSetEnabled: (keys: string[]) => Promise<void>;
}) {
  /* one dialog for both jobs: `null` is closed, the string is the row it edits,
     and `NEW` means a record that does not exist yet */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = new Set(enabledKeys);
  const channels = [...new Set(models.map((model) => model.provider))];
  const editingModel = editing && editing !== NEW ? models.find((model) => keyOf(model) === editing) ?? null : null;

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
      setEditing(null);
      setConfirming(null);
    } catch {
      /* the shell shows the message; the dialog stays open so the work is not lost */
    } finally {
      setBusy(false);
    }
  };

  /** The switch writes the whole whitelist: pi reads an empty list as "all", so
   *  that is what a fully-enabled catalogue is stored as — a model added later
   *  is then on by default rather than silently disabled. */
  const toggle = (model: ModelInfo, next: boolean) => {
    const key = keyOf(model);
    const keys = next ? [...enabled, key] : [...enabled].filter((entry) => entry !== key);
    void run(() => onSetEnabled(keys.length === models.length ? [] : keys));
  };

  return (
    <>
      <Section
        title={t("Model management")}
        index={0}
        actions={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">
              {tf("{enabled}/{total} enabled", { enabled: enabledKeys.length, total: models.length })}
            </span>
            <Chip onClick={() => setEditing(NEW)} title={t("Add a model to models.json")}>
              <PlusIcon size={12} />
              {t("Add model")}
            </Chip>
          </div>
        }
      >
        {!models.length ? (
          <div className="px-4 py-3 text-[11.5px] leading-snug text-ink-3">
            {t("No models are authenticated yet. Run `pi login`, then reload this page.")}
          </div>
        ) : null}
        {models.map((model) => {
          const key = keyOf(model);
          const on = enabled.has(key);
          const inUse = currentKey === key;
          const isConfirming = confirming === key;
          return (
            <div
              key={key}
              data-row
              className={cn(
                "relative z-10 flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0",
                /* a disabled row stays in place and turns pale — a row that
                   disappears reads as a delete */
                !on && "opacity-55",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] text-ink">{model.name}</span>
                  {inUse ? (
                    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-chip bg-green-tint px-1.5 text-[10.5px] text-green">
                      <CheckIcon size={10} />
                      {t("in use")}
                    </span>
                  ) : null}
                  {model.source === "models.json" ? (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-chip bg-orange-tint px-1.5 text-[10.5px] text-orange">
                      {t("overridden")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">{key}</div>
              </div>

              {/* the facts a picker needs: how big the window is, how much comes
                  back, and whether it takes images or thinking */}
              <div className="hidden shrink-0 items-center gap-1 lg:flex">
                <Tag>{`ctx ${formatContext(model.contextWindow)}`}</Tag>
                <Tag>{`max ${formatContext(model.maxTokens)}`}</Tag>
                {model.reasoning ? (
                  <Tag title={t("Reasoning model")}>
                    <BrainIcon size={10} />
                    {t("reasoning")}
                  </Tag>
                ) : null}
                {model.supportsImages ? (
                  <Tag title={t("Image input")}>
                    <ImageIcon size={10} />
                    {t("vision")}
                  </Tag>
                ) : null}
              </div>

              {isConfirming ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] text-ink-3">{t("Remove from models.json?")}</span>                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onDelete(model.provider, model.id))}
                    className="pressable-soft pressable flex h-7 items-center gap-1.5 rounded-control bg-red-tint px-2 text-[11.5px] text-red disabled:opacity-40"
                  >
                    <TrashIcon size={12} />
                    {t("Remove")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="pressable h-7 rounded-control px-2 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
                  >
                    {t("Cancel")}
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Switch
                    on={on}
                    disabled={busy || inUse}
                    onClick={() => toggle(model, !on)}
                    title={inUse ? t("This is the model the session is running on") : undefined}
                    label={tf("{action} {model}", { action: on ? t("Disable") : t("Enable"), model: key })}
                  />
                  <button
                    type="button"
                    title={t("Edit")}
                    onClick={() => setEditing(key)}
                    className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
                  >
                    <PencilIcon size={12} />
                  </button>
                  <button
                    type="button"
                    title={t("Remove from models.json")}
                    disabled={model.source !== "models.json"}
                    onClick={() => setConfirming(key)}
                    className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-red-tint hover:text-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {editing && typeof document !== "undefined"
        ? createPortal(
            <ModelEditorDialog
              key={editing}
              isNew={editing === NEW}
              initial={editingModel ? draftFromModel(editingModel) : emptyDraft(channels[0] ?? "")}
              channels={channels}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSubmit={(edit) => void run(() => onSave({ ...edit, name: edit.name.trim() || edit.id.trim() }))}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/** A capability chip. Compact on purpose: five of them sit in one row. */
function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-chip bg-field px-1.5 text-[10.5px] text-ink-2 tabular-nums"
    >
      {children}
    </span>
  );
}

/** The settings switch, with the disabled state the model list needs. */
function Switch({
  on,
  onClick,
  disabled,
  title,
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** the accessible name — a bare pill says nothing to a screen reader */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={on}
      className={cn("pressable relative h-[18px] w-8 shrink-0 rounded-full", on ? "bg-green" : "bg-line-strong", disabled && "opacity-50")}
      style={{ transition: "background-color 200ms ease-out" }}
    >
      <span
        className="absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow"
        style={{
          transform: on ? "translateX(14px)" : "translateX(0)",
          transition: "transform 240ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[10.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  list,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  list?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      list={list}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-7 w-full min-w-0 rounded-control bg-field px-2 text-[12px] text-ink outline-none transition-shadow duration-150 placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--accent-tint)]",
        mono && "font-mono",
      )}
    />
  );
}

function NumberInput({ value, onChange, onEdited }: { value: number; onChange: (next: number) => void; onEdited: () => void }) {
  return (
    <input
      type="number"
      value={value || ""}
      min={0}
      step={1024}
      placeholder="0"
      onChange={(event) => {
        onEdited();
        onChange(Number(event.target.value) || 0);
      }}
      className="h-7 w-full min-w-0 rounded-control bg-field px-2 font-mono text-[12px] text-ink tabular-nums outline-none transition-shadow duration-150 placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--accent-tint)]"
    />
  );
}

/**
 * Ticking a box here writes the `input[]` array directly rather than asking for
 * the same fact twice, and `text` can never be unticked — a provider entry with
 * no input kinds reads as a model that accepts nothing.
 */
function InputKindBox({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "pressable-soft pressable flex h-7 items-center gap-2 rounded-control px-2 text-[11.5px]",
        checked ? "bg-accent-tint text-ink" : "bg-field text-ink-2 hover:bg-hover-2",
        disabled && "opacity-70",
      )}
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

/**
 * Add / edit one model.
 *
 * The layout follows the order the facts are known: the id first, then the
 * window and the output ceiling, and everything a provider rarely changes —
 * input kinds, reasoning, the thinking map — folded into Advanced.
 */
function ModelEditorDialog({
  isNew,
  initial,
  channels,
  busy,
  onCancel,
  onSubmit,
}: {
  isNew: boolean;
  initial: ModelEdit;
  channels: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (edit: ModelEdit) => void;
}) {
  const [draft, setDraft] = useState<ModelEdit>(initial);
  const [smart, setSmart] = useState(() => localStorage.getItem(SMART_KEY) !== "off");
  const [guess, setGuess] = useState<ModelCapabilityGuess | null>(null);
  const [advanced, setAdvanced] = useState(() => Boolean(initial.thinkingLevelMap && Object.keys(initial.thinkingLevelMap).length));
  const trapRef = useFocusTrap(true);

  /* Fields the user typed in are theirs: the helper may re-read a changed id,
     but it never overwrites an answer that came from a hand. The set is cleared
     when the id changes, because a different model is a different question. */
  const touched = useRef<Set<keyof ModelEdit>>(new Set());
  const lastId = useRef(initial.id);

  useEffect(() => {
    if (lastId.current === draft.id) return;
    lastId.current = draft.id;
    touched.current = new Set();
  }, [draft.id]);

  useEffect(() => {
    if (!smart) {
      setGuess(null);
      return;
    }
    const next = inferModelCapabilities({ provider: draft.provider, id: draft.id, name: draft.name });
    setGuess(next);
    if (!next) return;
    setDraft((current) => {
      const merged = { ...current };
      if (next.contextWindow !== undefined && !touched.current.has("contextWindow")) merged.contextWindow = next.contextWindow;
      if (next.maxTokens !== undefined && !touched.current.has("maxTokens")) merged.maxTokens = next.maxTokens;
      if (next.reasoning !== undefined && !touched.current.has("reasoning")) merged.reasoning = next.reasoning;
      if (next.supportsImages !== undefined && !touched.current.has("input")) {
        merged.input = next.supportsImages
          ? [...new Set([...merged.input, "image"])]
          : merged.input.filter((kind) => kind !== "image");
      }
      return merged;
    });
  }, [smart, draft.provider, draft.id, draft.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const touch = (field: keyof ModelEdit, next: ModelEdit) => {
    touched.current.add(field);
    setDraft(next);
  };

  const toggleInput = (kind: InputKind) => {
    const has = draft.input.includes(kind);
    /* known kinds keep their offered order, and anything a hand-written
       models.json declared that this list does not know about is carried along
       rather than dropped by the toggle */
    const nextInput = has
      ? draft.input.filter((entry) => entry !== kind)
      : [...INPUT_KINDS.filter((entry) => entry === kind || draft.input.includes(entry)), ...draft.input.filter((entry) => !INPUT_KINDS.includes(entry as InputKind))];
    touch("input", { ...draft, input: nextInput });
  };

  const valid = Boolean(draft.provider.trim() && draft.id.trim());

  return (
    <div ref={trapRef} role="dialog" aria-modal="true" aria-label={isNew ? t("Add model") : t("Edit model")} className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/50"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={onCancel}
      />
      <div
        className="relative flex max-h-[86vh] w-full max-w-[480px] flex-col overflow-hidden rounded-card bg-surface shadow-overlay"
        style={{ animation: "pop-in 220ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{isNew ? t("Add model") : t("Edit model")}</div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
              {draft.provider && draft.id ? keyOf(draft) : t("written to models.json")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("Close")}
            className="pressable flex size-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <XIcon size={11} />
          </button>
        </div>

        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
          {/* smart configuration — the id is read, then everything stays editable */}
          <div className="flex items-start gap-2 rounded-control bg-inset px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ink">{t("Smart configuration")}</div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-ink-3">
                {!smart
                  ? t("Off — every value below is exactly what you type.")
                  : guess
                    ? t("Read from the model id. Fields you edit are left alone.")
                    : t("No match for this id yet — fill the fields in yourself.")}
              </div>
            </div>
            <Switch
              on={smart}
              label={t("Smart configuration")}
              onClick={() => {
                const next = !smart;
                setSmart(next);
                localStorage.setItem(SMART_KEY, next ? "on" : "off");
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t("Provider")} hint={t("an id from models.json")}>
              <TextInput
                mono
                value={draft.provider}
                list="pi-model-channels"
                onChange={(value) => setDraft({ ...draft, provider: value })}
                placeholder="anthropic"
              />
            </Field>
            <Field label={t("Model id")} hint={t("as the provider spells it")}>
              <TextInput
                mono
                autoFocus
                value={draft.id}
                onChange={(value) => setDraft({ ...draft, id: value })}
                placeholder="claude-sonnet-4-5"
              />
            </Field>
            <datalist id="pi-model-channels">
              {channels.map((channel) => (
                <option key={channel} value={channel} />
              ))}
            </datalist>
          </div>

          <Field label={t("Display name")} hint={t("what the pickers show — the id when left empty")}>
            <TextInput value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} placeholder={draft.id || "Claude Sonnet 4.5"} />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t("Context window")} hint={draft.contextWindow ? formatContext(draft.contextWindow) : t("tokens the model may read")}>
              <NumberInput value={draft.contextWindow} onChange={(value) => setDraft({ ...draft, contextWindow: value })} onEdited={() => touched.current.add("contextWindow")} />
            </Field>
            <Field label={t("Max output")} hint={draft.maxTokens ? formatContext(draft.maxTokens) : t("tokens it may answer with")}>
              <NumberInput value={draft.maxTokens} onChange={(value) => setDraft({ ...draft, maxTokens: value })} onEdited={() => touched.current.add("maxTokens")} />
            </Field>
          </div>

          <div className="rounded-control shadow-hairline">
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
              className="pressable-soft pressable flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left hover:bg-inset"
            >
              <span className="min-w-0 flex-1 text-[12px] text-ink">{t("Advanced")}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                {[
                  draft.reasoning ? t("reasoning") : null,
                  draft.input.filter((kind) => kind !== "text").join(" · ") || t("text only"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <ChevronDownIcon size={12} className={cn("shrink-0 text-ink-3 transition-transform duration-200", advanced && "rotate-180")} />
            </button>
            {advanced ? (
              <div className="flex flex-col gap-3 border-t border-line px-2.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink">{t("Reasoning model")}</div>
                    <div className="mt-0.5 text-[10.5px] text-ink-3">{t("enables thinking levels")}</div>
                  </div>
                  <Switch
                    on={draft.reasoning}
                    onClick={() => touch("reasoning", { ...draft, reasoning: !draft.reasoning })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-ink-2">{t("Input types")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {INPUT_KINDS.map((kind) => (
                      <InputKindBox
                        key={kind}
                        label={t(kind === "text" ? "Text" : kind === "image" ? "Images" : kind === "video" ? "Video" : "PDF")}
                        checked={draft.input.includes(kind)}
                        disabled={kind === "text"}
                        onClick={() => toggleInput(kind)}
                      />
                    ))}
                  </div>
                  <span className="text-[10.5px] text-ink-3">
                    {t("Written as the provider's input array. Text is always included.")}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-ink-2">{t("Thinking level map")}</span>
                  <span className="text-[10.5px] leading-snug text-ink-3">
                    {t("Map each Pi level to a provider value. Set to “— unsupported” to hide it.")}
                  </span>
                  {LEVELS.map((level) => {
                    const value = draft.thinkingLevelMap?.[level] ?? "";
                    return (
                      <div key={level} className="flex items-center gap-2">
                        <span className={cn("w-14 shrink-0 font-mono text-[11px]", draft.reasoning ? "text-ink-2" : "text-ink-3")}>{level}</span>
                        <select
                          disabled={!draft.reasoning}
                          value={value === null ? "__unsupported" : value}
                          onChange={(event) => {
                            const next = event.target.value;
                            touch("thinkingLevelMap", {
                              ...draft,
                              thinkingLevelMap: {
                                ...(draft.thinkingLevelMap ?? {}),
                                [level]: next === "__unsupported" ? null : next,
                              },
                            });
                          }}
                          className={cn(
                            "h-7 min-w-0 flex-1 rounded-control bg-field px-2 text-[11.5px] outline-none",
                            draft.reasoning ? "text-ink" : "text-ink-3 opacity-50",
                          )}
                        >
                          <option value="">{t("default")}</option>
                          {LEVELS.filter((candidate) => candidate !== "off").map((candidate) => (
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
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1 text-[10.5px] text-ink-3">
            {t("Written to ~/.pi/agent/models.json — the Pi CLI reads the same file.")}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="pressable h-7 rounded-control px-2.5 text-[12px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => onSubmit({ ...draft, provider: draft.provider.trim(), id: draft.id.trim() })}
            className="pressable-soft pressable h-7 rounded-control bg-ink px-3 text-[12px] font-medium text-canvas disabled:opacity-40"
          >
            {isNew ? t("Add to models.json") : t("Save to models.json")}
          </button>
        </div>
      </div>
    </div>
  );
}
