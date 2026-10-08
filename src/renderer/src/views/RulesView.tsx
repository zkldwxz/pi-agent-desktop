import { useEffect, useMemo, useState } from "react";
import type { PluginInfo } from "@shared/types";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { IS_MAC } from "../lib/platform";
import { CheckIcon, FolderOpenIcon, RefreshIcon, TrashIcon } from "../components/icons";
import { EmptyState, Skeleton } from "../components/ui";

/**
 * Rules, with the editor they always needed.
 *
 * This list used to be the generic plugin list, which left a rule you had just
 * created impossible to edit or delete: the trash icon inherited the toggle's
 * disabled state (`toggleable` is false for everything the scanner does not
 * classify as an extension), and the only remaining action revealed the file in
 * the OS file manager. A rule is a small markdown file the agent reads at the
 * start of every session, so here it opens into a plain editor and saves back
 * to the same file.
 */
export function RulesView({
  rules,
  loading,
  onDelete,
  onOpen,
  onRefresh,
}: {
  rules: PluginInfo[];
  loading: boolean;
  onDelete: (plugin: PluginInfo) => void;
  onOpen: (plugin: PluginInfo) => void;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  /** the rule a click wanted to open while the editor holds unsaved changes */
  const [pending, setPending] = useState<PluginInfo | null>(null);

  const current = useMemo(() => rules.find((rule) => rule.path === selected) ?? null, [rules, selected]);
  const dirty = selected !== null && text !== saved;

  /* A deleted or rescanned-away rule must not leave the editor pointing at a
     file that no longer exists. */
  useEffect(() => {
    if (selected && !rules.some((rule) => rule.path === selected)) {
      setSelected(null);
      setText("");
      setSaved("");
      setError(null);
    }
  }, [rules, selected]);

  const load = async (plugin: PluginInfo) => {
    setSelected(plugin.path);
    setLoadingText(true);
    setError(null);
    try {
      const content = await window.pi.readPluginText(plugin.path);
      setText(content);
      setSaved(content);
    } catch (cause) {
      setText("");
      setSaved("");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingText(false);
    }
  };

  const pick = (plugin: PluginInfo) => {
    if (plugin.path === selected) return;
    /* Unsaved work is never thrown away by a stray click — ask first. */
    if (dirty) {
      setPending(plugin);
      return;
    }
    void load(plugin);
  };

  const save = async () => {
    if (!current || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await window.pi.writePluginText(current.path, text);
      setSaved(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    if (!current) return;
    setError(null);
    try {
      const content = await window.pi.readPluginText(current.path);
      setText(content);
      setSaved(content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="scrollbar-thin flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-ui-caption font-medium text-ink-2">{t("Rules")}</span>
          <button
            type="button"
            title={t("Rescan")}
            onClick={onRefresh}
            className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
          >
            <RefreshIcon size={12} />
          </button>
        </div>

        {loading && !rules.length ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={cn(
                "group flex items-center gap-1 rounded-control pr-1",
                rule.path === selected ? "bg-surface shadow-hairline" : "hover:bg-hover",
              )}
            >
              <button
                type="button"
                onClick={() => pick(rule)}
                className="pressable flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5 text-left"
              >
                <span
                  className={cn(
                    "w-full truncate text-ui-caption",
                    rule.path === selected ? "font-medium text-ink" : "text-ink-2",
                  )}
                >
                  {rule.name}
                </span>
                <span className="font-mono text-ui-xs text-ink-3">{rule.scope}</span>
              </button>
              {/* The row's two actions stay in the layout and only fade in: a
                  `hidden` toggle would change the row's width as the pointer
                  crosses it, and the name would jump. */}
              <button
                type="button"
                title={t("Reveal in explorer")}
                onClick={() => onOpen(rule)}
                className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 opacity-0 hover:bg-hover-2 hover:text-ink group-hover:opacity-100"
              >
                <FolderOpenIcon size={12} />
              </button>
              {confirming === rule.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(rule);
                      setConfirming(null);
                    }}
                    className="pressable inline-flex h-6 items-center rounded-chip bg-red px-2 text-ui-xs text-white"
                  >
                    {t("Move to trash")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="pressable inline-flex h-6 items-center rounded-chip bg-field px-2 text-ui-xs text-ink-2 hover:bg-hover-2"
                  >
                    {t("Cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title={t("Delete")}
                  onClick={() => setConfirming(rule.id)}
                  className="pressable flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 opacity-0 hover:bg-red-tint hover:text-red group-hover:opacity-100"
                >
                  <TrashIcon size={12} />
                </button>
              )}
            </div>
          ))
        )}

        {!loading && !rules.length ? (
          <div className="px-1 pt-2 text-ui-sm leading-relaxed text-ink-3">
            {t("Create a rule above, or drop a markdown file into")}{" "}
            <span className="font-mono">~/.pi/agent/prompts/</span>.
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!current ? (
          <div className="p-8">
            <EmptyState title={t("No rule selected")} body={t("Pick a rule on the left to read and edit it here.")} />
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-caption font-medium text-ink">{current.name}</div>
                <div className="truncate font-mono text-ui-xs text-ink-3">{current.path}</div>
              </div>
              {dirty ? (
                <span className="shrink-0 rounded-chip bg-orange-tint px-1.5 py-0.5 text-ui-xs text-orange">
                  {t("Unsaved changes")}
                </span>
              ) : null}
              <button
                type="button"
                title={t("Reload from disk")}
                onClick={() => void reload()}
                className="pressable flex size-7 shrink-0 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
              >
                <RefreshIcon size={13} />
              </button>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                title={`${t("Save")} · ${IS_MAC ? "⌘S" : "Ctrl+S"}`}
                className="pressable flex h-7 shrink-0 items-center gap-1.5 rounded-chip bg-ink px-2.5 text-ui-sm font-medium text-canvas disabled:opacity-40"
              >
                {saving ? null : <CheckIcon size={11} />}
                {t("Save")}
              </button>
            </div>

            {pending ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-orange-tint px-4 py-2 text-ui-caption text-orange">
                <span className="flex-1">{t("Discard unsaved changes?")}</span>
                <button
                  type="button"
                  onClick={() => {
                    const target = pending;
                    setPending(null);
                    void load(target);
                  }}
                  className="pressable inline-flex h-6 items-center rounded-chip bg-orange px-2 text-ui-xs text-white"
                >
                  {t("Discard")}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="pressable inline-flex h-6 items-center rounded-chip bg-field px-2 text-ui-xs text-ink-2 hover:bg-hover-2"
                >
                  {t("Keep editing")}
                </button>
              </div>
            ) : null}

            {error ? (
              <div className="shrink-0 border-b border-line bg-red-tint px-4 py-2 text-ui-caption text-red">{error}</div>
            ) : null}

            <textarea
              value={text}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((IS_MAC ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
              className="scrollbar-thin min-h-0 flex-1 resize-none bg-canvas p-4 font-mono text-ui-caption leading-relaxed text-ink outline-none"
            />

            <div className="shrink-0 border-t border-line px-4 py-1.5 text-ui-xs text-ink-3">
              {loadingText ? t("Loading…") : t("Markdown — the agent reads this file at the start of every session")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
