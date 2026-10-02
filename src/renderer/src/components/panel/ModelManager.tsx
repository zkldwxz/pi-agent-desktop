import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelApi, ChannelEdit, ChannelInfo, ModelEdit, ModelInfo } from "@shared/types";
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
import { THINKING_LEVELS } from "@shared/thinking";

/**
 * Model management, in the settings page rather than behind a second view.
 *
 * The list, the enable switch and the editor were previously split: the only
 * way to add a model was the Customize view's inspector, and the only way to
 * see whether it worked was to change session — the write happened, the list
 * did not. Both live here now, next to the thinking overrides they configure,
 * and every action reports what happened through the shell's notice stack.
 */


/** The `input[]` values a provider model can declare, in the order they are offered. */
const INPUT_KINDS = ["text", "image", "video", "pdf"] as const;
type InputKind = (typeof INPUT_KINDS)[number];

/**
 * The wire protocols a channel can speak.
 *
 * These are pi's own `api` literals, not display names — the value written to
 * models.json has to be the one the runtime composes a provider from.
 */
const CHANNEL_APIS: Array<{ api: ChannelApi; label: string }> = [
  { api: "openai-completions", label: "OpenAI" },
  { api: "anthropic-messages", label: "Anthropic" },
  { api: "google-generative-ai", label: "Gemini" },
];

const apiLabel = (api: string) => CHANNEL_APIS.find((entry) => entry.api === api)?.label ?? api;

/** the `provider` value meaning "declare a new endpoint while adding this model" */
const NEW_CHANNEL = "__new_channel__";

/** Flat is the default and the old behaviour; grouping is a per-machine view. */
const GROUP_KEY = "pi-model-grouped";

/** Whether the id-reading helper pre-fills the form; a per-machine preference,
 *  also surfaced as a default in Settings ▸ Models & thinking. */
export const SMART_KEY = "pi-model-smart-config";

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
  channels,
  enabledKeys,
  currentKey,
  onSave,
  onDelete,
  onCreateChannel,
  onRemoveChannel,
  onAddKey,
  onRemoveKey,
  onSetEnabled,
}: {
  /** every model the runtime knows, disabled ones included */
  models: ModelInfo[];
  /** the endpoints those models sit on — one channel, one key per member */
  channels: ChannelInfo[];
  /** the keys a picker may offer — `models` minus the disabled ones */
  enabledKeys: string[];
  /** the session's model, marked so it is not switched off by accident */
  currentKey: string | null;
  onSave: (edit: ModelEdit) => Promise<void>;
  onDelete: (provider: string, modelId: string) => Promise<void>;
  onCreateChannel: (edit: ChannelEdit) => Promise<string[]>;
  onRemoveChannel: (channelId: string) => Promise<void>;
  onAddKey: (channelId: string, key: string) => Promise<void>;
  onRemoveKey: (providerId: string) => Promise<void>;
  onSetEnabled: (keys: string[]) => Promise<void>;
}) {
  /* one dialog for both jobs: `null` is closed, the string is the row it edits,
     and `NEW` means a record that does not exist yet */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* ZCode manages models per provider — "By provider" is the default view,
   * and the preference persists either way */
  const [grouped, setGrouped] = useState(() => localStorage.getItem(GROUP_KEY) !== "off");
  /* the channel whose key list is open for editing, and the row awaiting a
     delete confirmation — endpoints carry spendable credentials, so neither
     action happens on a single click */
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [confirmChannel, setConfirmChannel] = useState<string | null>(null);

  const enabled = new Set(enabledKeys);
  const editingModel = editing && editing !== NEW ? models.find((model) => keyOf(model) === editing) ?? null : null;

  /** Channels by the provider id a model row carries, so a row can name its
   *  endpoint in either view. */
  const channelOfModel = (model: ModelInfo) =>
    channels.find((channel) => channel.id === model.channelId) ??
    channels.find((channel) => channel.members.includes(model.provider));

  const customChannels = channels.filter((channel) => channel.custom);

  const setGroupView = (next: boolean) => {
    setGrouped(next);
    localStorage.setItem(GROUP_KEY, next ? "on" : "off");
  };

  /**
   * The list in whichever shape the view asks for.
   *
   * Grouped sorts by channel name so a channel's rows land together however the
   * runtime ordered them, and a channel with no models yet still gets a section
   * — otherwise the endpoint just created would look like it had not been saved.
   */
  const sections: Array<{ channel: ChannelInfo | null; rows: ModelInfo[] }> = [];
  if (!grouped) {
    sections.push({ channel: null, rows: models });
  } else {
    const byChannel = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const id = channelOfModel(model)?.id ?? model.provider;
      const bucket = byChannel.get(id);
      if (bucket) bucket.push(model);
      else byChannel.set(id, [model]);
    }
    for (const channel of [...channels].sort((a, b) => a.name.localeCompare(b.name))) {
      const rows = byChannel.get(channel.id);
      sections.push({ channel, rows: rows ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : [] });
      byChannel.delete(channel.id);
    }
    /* endpoints the host reported no channel for still belong somewhere */
    for (const [id, rows] of byChannel) {
      sections.push({ channel: channels.find((channel) => channel.id === id) ?? null, rows });
    }
  }

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
            {/* two readings of one list: the flat catalogue, or a block per
                endpoint with its keys named once above it */}
            <div className="flex items-center rounded-control bg-field p-0.5">
              {[false, true].map((next) => (
                <button
                  key={String(next)}
                  type="button"
                  aria-pressed={grouped === next}
                  onClick={() => setGroupView(next)}
                  className={cn(
                    "pressable h-5 rounded-chip px-1.5 text-ui-xs font-medium transition-colors",
                    grouped === next ? "bg-surface text-ink shadow-hairline" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {next ? t("By provider") : t("Flat")}
                </button>
              ))}
            </div>
            <span className="font-mono text-ui-xs text-ink-3 tabular-nums">
              {tf("{enabled}/{total} enabled", { enabled: enabledKeys.length, total: models.length })}
            </span>
            <Chip onClick={() => setEditing(NEW)} title={t("Add a model to models.json")}>
              <PlusIcon size={12} />
              {t("Add model")}
            </Chip>
          </div>
        }
      >
        {!models.length && !customChannels.length ? (
          <div className="px-4 py-3 text-ui-sm leading-snug text-ink-3">
            {t("No models are authenticated yet. Run `pi login`, then reload this page.")}
          </div>
        ) : null}
        {sections.map((section) => {
          const channel = section.channel;
          return (
          <div key={channel?.id ?? "__flat"}>
            {channel ? (
              <ChannelHeader
                channel={channel}
                busy={busy}
                addingKey={keyFor === channel.id}
                confirming={confirmChannel === channel.id}
                onToggleKeys={() => setKeyFor(keyFor === channel.id ? null : channel.id)}
                onAddKey={(key) => void run(() => onAddKey(channel.id, key).then(() => setKeyFor(null)))}
                onRemoveKey={(providerId) => void run(() => onRemoveKey(providerId))}
                onAskRemove={() => setConfirmChannel(channel.id)}
                onDismissRemove={() => setConfirmChannel(null)}
                onRemoveChannel={() => void run(() => onRemoveChannel(channel.id).then(() => setConfirmChannel(null)))}
              />
            ) : null}
            {channel && !section.rows.length ? (
              <div className="px-4 py-2 text-ui-sm leading-snug text-ink-3">
                {t("No models on this endpoint yet — add one and every key can serve it.")}
              </div>
            ) : null}
            {section.rows.map((model) => {
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
                  <span className="truncate text-ui-caption text-ink">{model.name}</span>
                  {inUse ? (
                    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-chip bg-green-tint px-1.5 text-ui-xs text-green">
                      <CheckIcon size={10} />
                      {t("in use")}
                    </span>
                  ) : null}
                  {model.source === "models.json" ? (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-chip bg-orange-tint px-1.5 text-ui-xs text-orange">
                      {t("overridden")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate font-mono text-ui-xs text-ink-3">{key}</div>
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
                  <span className="text-ui-sm text-ink-3">{t("Remove from models.json?")}</span>                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onDelete(model.provider, model.id))}
                    className="pressable-soft pressable flex h-7 items-center gap-1.5 rounded-control bg-red-tint px-2 text-ui-sm text-red disabled:opacity-40"
                  >
                    <TrashIcon size={12} />
                    {t("Remove")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="pressable h-7 rounded-control px-2 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
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
                    className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
                  >
                    <PencilIcon size={12} />
                  </button>
                  <button
                    type="button"
                    title={t("Remove from models.json")}
                    disabled={model.source !== "models.json"}
                    onClick={() => setConfirming(key)}
                    className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-red-tint hover:text-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              )}
            </div>
          );
            })}
          </div>
          );
        })}
      </Section>

      {editing && typeof document !== "undefined"
        ? createPortal(
            <ModelEditorDialog
              key={editing}
              isNew={editing === NEW}
              initial={editingModel ? draftFromModel(editingModel) : emptyDraft(channels[0]?.members[0] ?? "")}
              channels={channels}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSubmit={(edit, channel) =>
                void run(async () => {
                  /* a new endpoint is written first: the model has to name a
                     provider that already exists by the time the file re-reads */
                  const provider = channel ? (await onCreateChannel(channel))[0] : edit.provider;
                  if (!provider) throw new Error(t("The channel needs a name, an address and at least one key."));
                  await onSave({ ...edit, provider, name: edit.name.trim() || edit.id.trim() });
                })
              }
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
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-chip bg-field px-1.5 text-ui-xs text-ink-2 tabular-nums"
    >
      {children}
    </span>
  );
}

/**
 * One endpoint, named once, with its keys listed under it.
 *
 * The header exists because of the storage shape: pi keeps one key per provider,
 * so several keys are several providers, and a list that printed the endpoint on
 * every model row would read as duplicated catalogue. Here the endpoint is said
 * once and the keys are said as its members.
 *
 * The keys are shown by provider id, never by value — the main process strips
 * `apiKey` before any of this reaches the window.
 */
function ChannelHeader({
  channel,
  busy,
  addingKey,
  confirming,
  onToggleKeys,
  onAddKey,
  onRemoveKey,
  onAskRemove,
  onDismissRemove,
  onRemoveChannel,
}: {
  channel: ChannelInfo;
  busy: boolean;
  addingKey: boolean;
  confirming: boolean;
  onToggleKeys: () => void;
  onAddKey: (key: string) => void;
  onRemoveKey: (providerId: string) => void;
  onAskRemove: () => void;
  onDismissRemove: () => void;
  onRemoveChannel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const multi = channel.members.length > 1;

  return (
    <div data-row className="relative z-10 flex flex-col gap-1.5 border-b border-line bg-inset px-4 pt-2 pb-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-ui-sm font-medium text-ink-2">{channel.name}</span>
        <span className="shrink-0 rounded-chip bg-field px-1.5 text-ui-xs text-ink-3">{apiLabel(channel.api)}</span>
        {channel.baseUrl ? (
          <span className="hidden min-w-0 truncate font-mono text-ui-xs text-ink-3 md:inline">{channel.baseUrl}</span>
        ) : null}
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
          {tf("{count} keys", { count: channel.members.length })}
        </span>
        {channel.custom ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleKeys}
              aria-expanded={addingKey}
              className="pressable h-6 rounded-chip px-1.5 text-ui-xs text-ink-3 hover:bg-hover hover:text-ink"
            >
              {addingKey ? t("Done") : t("Manage keys")}
            </button>
            <button
              type="button"
              onClick={onAskRemove}
              title={t("Remove this endpoint")}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-red-tint hover:text-red"
            >
              <TrashIcon size={11} />
            </button>
          </div>
        ) : null}
      </div>

      {addingKey ? (
        <div className="flex flex-col gap-1">
          {channel.members.map((id, index) => (
            <div key={id} className="flex items-center gap-2">
              <span className="w-4 shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-ink-2">{id}</span>
              {multi ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveKey(id)}
                  aria-label={tf("Forget key {index}", { index: index + 1 })}
                  className="pressable flex size-5 items-center justify-center rounded-chip text-ink-3 hover:bg-red-tint hover:text-red disabled:opacity-40"
                >
                  <XIcon size={10} />
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <TextInput mono value={draft} onChange={setDraft} placeholder={t("sk-… one more key for this endpoint")} />
            </div>
            <button
              type="button"
              disabled={!draft.trim() || busy}
              onClick={() => {
                onAddKey(draft.trim());
                setDraft("");
              }}
              className="pressable-soft pressable flex h-7 shrink-0 items-center gap-1 rounded-control bg-field px-2 text-ui-sm text-ink-2 hover:bg-hover disabled:opacity-40"
            >
              <PlusIcon size={11} />
              {t("Add key")}
            </button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-ui-sm leading-snug text-ink-3">
            {t("Remove this endpoint and every key on it from models.json?")}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onRemoveChannel}
            className="pressable-soft pressable flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-red-tint px-2 text-ui-sm text-red disabled:opacity-40"
          >
            <TrashIcon size={12} />
            {t("Remove")}
          </button>
          <button
            type="button"
            onClick={onDismissRemove}
            className="pressable h-7 shrink-0 rounded-control px-2 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            {t("Cancel")}
          </button>
        </div>
      ) : null}
    </div>
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
          transition: "transform 240ms var(--ease-out-strong-css)",
        }}
      />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-ui-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-ui-xs text-ink-3">{hint}</span> : null}
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
        "h-7 w-full min-w-0 rounded-control bg-field px-2 text-ui-caption text-ink outline-none transition-shadow duration-150 placeholder:text-ink-4 focus:shadow-[0_0_0_3px_var(--accent-tint)]",
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
      className="h-7 w-full min-w-0 rounded-control bg-field px-2 font-mono text-ui-caption text-ink tabular-nums outline-none transition-shadow duration-150 placeholder:text-ink-4 focus:shadow-[0_0_0_3px_var(--accent-tint)]"
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
        "pressable-soft pressable flex h-7 items-center gap-2 rounded-control px-2 text-ui-sm",
        checked ? "bg-accent-tint text-ink" : "bg-field text-ink-2 hover:bg-hover-2",
        disabled && "opacity-70",
      )}
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

/**
 * The channel list, as a menu rather than a native select.
 *
 * A machine with forty providers turns the platform dropdown into a scroll the
 * user has to win, and the two answers they most often want — the endpoint they
 * wrote themselves, and a brand new one — land at the bottom of it. So the menu
 * opens with 新建渠道, then the hand-written channels, then the providers pi
 * ships, and the whole thing is capped and scrolls inside its own panel.
 *
 * It is portalled and positioned off the trigger because the dialog body
 * scrolls: a menu absolutely positioned inside that would be clipped by the
 * card's own overflow.
 */
function ChannelPicker({
  channels,
  value,
  declaring,
  onPick,
}: {
  channels: ChannelInfo[];
  value: string;
  declaring: boolean;
  onPick: (providerOrSentinel: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-channel-menu]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const toggle = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) setRect({ left: box.left, top: box.bottom + 4, width: box.width });
    setOpen(!open);
  };

  const custom = channels.filter((entry) => entry.custom);
  const builtIn = channels.filter((entry) => !entry.custom);
  const chosen = channels.find((entry) => entry.members.includes(value));
  const label = declaring ? t("New channel…") : chosen?.name ?? value ?? t("Pick a channel");

  const row = (entry: ChannelInfo) => {
    const selected = !declaring && entry.id === chosen?.id;
    return (
      <button
        key={entry.id}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => {
          onPick(entry.members[0]);
          setOpen(false);
        }}
        className={cn(
          "pressable-soft pressable flex h-7 w-full items-center gap-2 rounded-chip px-2 text-left text-ui-sm",
          /* the check marks the choice; a full-row fill would out-shout the row
             above it and read as hover rather than as the current value */
          selected ? "text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {entry.members.length > 1 ? (
          <span className="shrink-0 font-mono text-ui-xs text-ink-3 tabular-nums">
            {tf("{count} keys", { count: entry.members.length })}
          </span>
        ) : null}
        {selected ? <CheckIcon size={11} className="shrink-0 text-accent-ink" /> : null}
      </button>
    );
  };

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="pressable flex h-7 w-full items-center gap-1.5 rounded-control bg-field px-2 text-left text-ui-sm text-ink"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDownIcon size={11} className={cn("shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && rect
        ? createPortal(
            <div
              data-channel-menu
              role="listbox"
              className="fixed z-[70] overflow-hidden rounded-control bg-surface py-1 shadow-overlay"
              style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 240) }}
            >
              {/* a fixed 2px between options, so the list reads as one dense
                  stack rather than as rows with their own margins */}
              <div className="scrollbar-thin flex max-h-[260px] flex-col gap-0.5 overflow-y-auto px-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={declaring}
                  onClick={() => {
                    onPick(NEW_CHANNEL);
                    setOpen(false);
                  }}
                  className={cn(
                    "pressable-soft pressable flex h-7 w-full items-center gap-1.5 rounded-chip px-2 text-left text-ui-sm",
                    declaring ? "text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                  )}
                >
                  <PlusIcon size={11} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t("New channel…")}</span>
                  {declaring ? <CheckIcon size={11} className="shrink-0 text-accent-ink" /> : null}
                </button>

                {custom.length ? <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">{custom.map(row)}</div> : null}
                {builtIn.length ? <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">{builtIn.map(row)}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * Add / edit one model.
 *
 * The layout follows the order the facts are known: which endpoint it belongs
 * to, then the id, then the window and the output ceiling, and everything a
 * provider rarely changes — input kinds, reasoning, the thinking map — folded
 * into Advanced.
 *
 * A model can arrive with an endpoint of its own. Declaring one asks for the
 * protocol, the address and the keys; picking a channel that already exists
 * hides all three again, because there is nothing left to say about it.
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
  channels: ChannelInfo[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (edit: ModelEdit, channel?: ChannelEdit) => void;
}) {
  const [draft, setDraft] = useState<ModelEdit>(initial);
  /* the draft's provider is either a channel that exists or a new one being
     declared here — nothing in between */
  const [declaring, setDeclaring] = useState(() => !channels.some((entry) => entry.members.includes(initial.provider)));
  const [channel, setChannel] = useState<ChannelEdit>({
    name: "",
    api: "openai-completions",
    baseUrl: "",
    keys: [""],
  });
  const [smart, setSmart] = useState(() => localStorage.getItem(SMART_KEY) !== "off");
  const [guess, setGuess] = useState<ModelCapabilityGuess | null>(null);
  const [advanced, setAdvanced] = useState(() => Boolean(initial.thinkingLevelMap && Object.keys(initial.thinkingLevelMap).length));
  const trapRef = useFocusTrap(true);

  /* Fields the user typed in are theirs: the helper may re-read a changed id,
     but it never overwrites an answer that came from a hand. The set is cleared
     when the id changes, because a different model is a different question.
     A record that already exists arrives with answers of its own — every field
     the models.json entry filled counts as "from a hand" too, or opening the
     dialog to change one number would silently rewrite the others from the id. */
  const touched = useRef<Set<keyof ModelEdit>>(
    isNew
      ? new Set()
      : new Set<keyof ModelEdit>(["contextWindow", "maxTokens", "reasoning", "input"]),
  );
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

  const valid = declaring
    ? Boolean(draft.id.trim() && channel.name.trim() && channel.baseUrl.trim() && channel.keys.some((key) => key.trim()))
    : Boolean(draft.provider.trim() && draft.id.trim());

  return (
    <div ref={trapRef} role="dialog" aria-modal="true" aria-label={isNew ? t("Add model") : t("Edit model")} className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/50"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={onCancel}
      />
      <div
        className="relative flex max-h-[86vh] w-full max-w-[480px] flex-col overflow-hidden rounded-card bg-surface shadow-overlay"
        style={{ animation: "pop-in 220ms var(--ease-out-strong-css) both" }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-base font-medium text-ink">{isNew ? t("Add model") : t("Edit model")}</div>
            <div className="mt-0.5 truncate font-mono text-ui-xs text-ink-3">
              {declaring
                ? channel.name.trim() || t("new channel")
                : draft.provider && draft.id
                  ? keyOf(draft)
                  : t("written to models.json")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("Close")}
            className="pressable flex size-5 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <XIcon size={11} />
          </button>
        </div>

        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
          {/* smart configuration — the id is read, then everything stays editable */}
          <div className="flex items-start gap-2 rounded-control bg-inset px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-ui-caption text-ink">{t("Smart configuration")}</div>
              <div className="mt-0.5 text-ui-xs leading-snug text-ink-3">
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
            <Field label={t("Channel")} hint={t("an endpoint from models.json")}>
              <ChannelPicker
                channels={channels}
                value={draft.provider}
                declaring={declaring}
                onPick={(next) => {
                  if (next === NEW_CHANNEL) {
                    setDeclaring(true);
                    return;
                  }
                  /* an endpoint that already exists carries its own address and
                     keys, so the fields for them leave the form with this click */
                  setDeclaring(false);
                  setDraft({ ...draft, provider: next });
                }}
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
          </div>

          {declaring ? (
            <div className="flex flex-col gap-2 rounded-control bg-inset px-2.5 py-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("Channel name")}>
                  <TextInput
                    value={channel.name}
                    onChange={(value) => setChannel({ ...channel, name: value })}
                    placeholder="My Proxy"
                  />
                </Field>
                <Field label={t("Protocol")} hint={t("the wire format the endpoint answers")}>
                  <select
                    value={channel.api}
                    onChange={(event) => setChannel({ ...channel, api: event.target.value as ChannelApi })}
                    className="h-7 min-w-0 rounded-control bg-field px-2 text-ui-sm text-ink outline-none"
                  >
                    {CHANNEL_APIS.map((entry) => (
                      <option key={entry.api} value={entry.api}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Base URL" hint={t("where pi sends the requests for these models")}>
                <TextInput
                  mono
                  value={channel.baseUrl}
                  onChange={(value) => setChannel({ ...channel, baseUrl: value })}
                  placeholder="https://proxy.example.com/v1"
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <span className="text-ui-sm font-medium text-ink-2">{t("API keys")}</span>
                <span className="text-ui-xs leading-snug text-ink-3">
                  {t("Every key stays its own provider on this endpoint — they are never merged into one.")}
                </span>
                {channel.keys.map((key, index) => (
                  <div key={`key-${index}`} className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <TextInput
                        mono
                        value={key}
                        onChange={(value) =>
                          setChannel({
                            ...channel,
                            keys: channel.keys.map((entry, at) => (at === index ? value : entry)),
                          })
                        }
                        placeholder="sk-…"
                      />
                    </div>
                    {channel.keys.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setChannel({ ...channel, keys: channel.keys.filter((_, at) => at !== index) })}
                        aria-label={tf("Remove key {index}", { index: index + 1 })}
                        className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-red-tint hover:text-red"
                      >
                        <XIcon size={10} />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setChannel({ ...channel, keys: [...channel.keys, ""] })}
                  className="pressable-soft pressable flex h-6 w-fit items-center gap-1 rounded-control px-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <PlusIcon size={11} />
                  {t("Add another key")}
                </button>
              </div>
            </div>
          ) : null}

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
              <span className="min-w-0 flex-1 text-ui-caption text-ink">{t("Advanced")}</span>
              <span className="shrink-0 font-mono text-ui-xs text-ink-3">
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
                    <div className="text-ui-caption text-ink">{t("Reasoning model")}</div>
                    <div className="mt-0.5 text-ui-xs text-ink-3">{t("enables thinking levels")}</div>
                  </div>
                  <Switch
                    on={draft.reasoning}
                    onClick={() => touch("reasoning", { ...draft, reasoning: !draft.reasoning })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-ui-sm font-medium text-ink-2">{t("Input types")}</span>
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
                  <span className="text-ui-xs text-ink-3">
                    {t("Written as the provider's input array. Text is always included.")}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-ui-sm font-medium text-ink-2">{t("Thinking level map")}</span>
                  <span className="text-ui-xs leading-snug text-ink-3">
                    {t("Map each Pi level to a provider value. Set to “— unsupported” to hide it.")}
                  </span>
                  {THINKING_LEVELS.map((level) => {
                    const value = draft.thinkingLevelMap?.[level] ?? "";
                    return (
                      <div key={level} className="flex items-center gap-2">
                        <span className={cn("w-14 shrink-0 font-mono text-ui-sm", draft.reasoning ? "text-ink-2" : "text-ink-3")}>{level}</span>
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
                            "h-7 min-w-0 flex-1 rounded-control bg-field px-2 text-ui-sm outline-none",
                            draft.reasoning ? "text-ink" : "text-ink-3 opacity-50",
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
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1 text-ui-xs text-ink-3">
            {t("Written to ~/.pi/agent/models.json — the Pi CLI reads the same file.")}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="pressable h-7 rounded-control px-2.5 text-ui-caption text-ink-2 hover:bg-hover hover:text-ink"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() =>
              onSubmit(
                { ...draft, provider: draft.provider.trim(), id: draft.id.trim() },
                declaring
                  ? {
                      ...channel,
                      name: channel.name.trim(),
                      baseUrl: channel.baseUrl.trim(),
                      keys: channel.keys.map((key) => key.trim()).filter(Boolean),
                    }
                  : undefined,
              )
            }
            className="pressable-soft pressable h-7 rounded-control bg-ink px-3 text-ui-caption font-medium text-canvas disabled:opacity-40"
          >
            {declaring ? t("Create channel and add") : isNew ? t("Add to models.json") : t("Save to models.json")}
          </button>
        </div>
      </div>
    </div>
  );
}
