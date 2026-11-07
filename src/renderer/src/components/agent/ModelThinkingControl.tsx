import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostState, ModelInfo } from "@shared/types";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import { buildCatalogue, channelOfModel, modelSections } from "../../lib/model-list";
import { brandOfModel, brandOfProvider } from "../../lib/model-brand";
import { BrandLogo, hasBrandLogo } from "../BrandLogo";
import { CheckIcon, ChevronRightIcon, SearchIcon, SlidersIcon } from "../icons";
import { ComposerPill } from "./ComposerPill";

/**
 * The model pill and its menu — baocode's SessionModelPicker over its
 * ComposerPicker (lib/chat/composer/session_model_picker.dart,
 * composer_picker.dart), ported as they are:
 *
 * - the pill: the model's maker's logo, then "model · effort" — the upstream
 *   before the name only when another upstream has a model of that name;
 * - the menu, 260 wide, above the pill: a search line once there are 10 or more
 *   models, the models under their upstream's heading (sticky, 11px faint,
 *   a line above every heading but the first), 30px rows of logo 15 + name 12.5
 *   (no descriptions: "its maker's logo and its upstream's heading tell the
 *   rest"), a check on the current one, a › where it has settings; the
 *   settings — its effort — in a submenu to the right; "Manage Models…" last.
 */

const key = (model: Pick<ModelInfo, "provider" | "id">) => `${model.provider}/${model.id}`;

function logoOf(model: ModelInfo, baseUrl?: string): string | null {
  const brand = brandOfModel(model.id) ?? brandOfModel(model.name) ?? brandOfProvider(model.provider, baseUrl);
  return hasBrandLogo(brand) ? brand : null;
}

function ModelLogo({ name, size }: { name: string | null; size: number }) {
  return name ? (
    <BrandLogo name={name} size={size} />
  ) : (
    <span className="codicon codicon-sparkle shrink-0" style={{ fontSize: size }} aria-hidden />
  );
}

const displayName = (model: Pick<ModelInfo, "name">) => model.name.replace(/\(.*\)/, "").trim();

export function ModelThinkingControl({
  state,
  onSetModel,
  onSetThinking,
  onManageModels,
}: {
  state: HostState;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
  /** opens Settings ▸ Models */
  onManageModels?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submenu, setSubmenu] = useState<{ key: string; top: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  /* optimistic: the pill moves on the click, the host's state takes over */
  const hostKey = state.snapshot?.model ? key(state.snapshot.model) : "";
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const currentKey = pendingKey ?? hostKey;
  const current = state.models.find((model) => key(model) === currentKey) ?? state.snapshot?.model ?? null;
  useEffect(() => {
    if (pendingKey === null) return;
    if (hostKey === pendingKey) {
      setPendingKey(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingKey(null), 3000);
    return () => window.clearTimeout(timer);
  }, [pendingKey, hostKey]);

  /* an effort picked on another model's submenu: switch, then set it */
  const [pendingEffort, setPendingEffort] = useState<{ key: string; level: string } | null>(null);
  useEffect(() => {
    if (!pendingEffort || hostKey !== pendingEffort.key) return;
    onSetThinking(pendingEffort.level);
    setPendingEffort(null);
  }, [pendingEffort, hostKey, onSetThinking]);

  const hostLevel = state.snapshot?.thinkingLevel ?? "off";
  const [pendingLevel, setPendingLevel] = useState<string | null>(null);
  useEffect(() => {
    if (pendingLevel === null) return;
    if (hostLevel === pendingLevel) {
      setPendingLevel(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingLevel(null), 1500);
    return () => window.clearTimeout(timer);
  }, [pendingLevel, hostLevel]);
  const level = pendingLevel ?? hostLevel;

  /* the ramp the session offers for the current model; another model's own */
  const levelsOf = useCallback(
    (model: ModelInfo | null): string[] =>
      model && key(model) === hostKey
        ? (state.snapshot?.thinkingLevels ?? model.thinkingLevels)
        : (model?.thinkingLevels ?? []),
    [hostKey, state.snapshot?.thinkingLevels],
  );
  const canThink = levelsOf(current).length > 1;

  const catalogue = useMemo(() => buildCatalogue(state.models, state.channels), [state.models, state.channels]);
  /* an upstream with no model to pick has no heading here (Settings lists it) */
  const sections = useMemo(
    () => modelSections(catalogue, { grouped: true, query }).filter((section) => section.rows.length > 0),
    [catalogue, query],
  );
  const searchable = state.models.length >= 10;

  /* SessionModelPicker._label */
  const label = useMemo(() => {
    if (!current) return t("No model");
    const twin = state.models.some((other) => other.name === current.name && other.provider !== current.provider);
    return [twin ? current.providerName : null, displayName(current), canThink && level !== "off" ? t(level) : null]
      .filter(Boolean)
      .join(" · ");
  }, [current, state.models, canThink, level]);
  const currentChannel = current ? channelOfModel(current, state.channels) : undefined;

  const close = useCallback(() => {
    setOpen(false);
    setSubmenu(null);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const pick = (model: ModelInfo) => {
    if (key(model) !== currentKey) {
      setPendingKey(key(model));
      onSetModel(model.provider, model.id);
    }
    close();
  };

  const pickEffort = (model: ModelInfo, next: string) => {
    if (key(model) === hostKey) {
      setPendingLevel(next);
      onSetThinking(next);
    } else {
      setPendingKey(key(model));
      setPendingEffort({ key: key(model), level: next });
      onSetModel(model.provider, model.id);
    }
    close();
  };

  const submenuModel = submenu ? (state.models.find((model) => key(model) === submenu.key) ?? null) : null;
  const submenuLevels = levelsOf(submenuModel).filter((value) => value !== "off");

  return (
    <div ref={wrapper} className="relative flex min-w-0 items-center">
      <ComposerPill
        menu
        open={open}
        onClick={() => (open ? close() : setOpen(true))}
        title={tf("Model — {model}", { model: current?.name ?? t("No model") })}
        icon={<ModelLogo name={current ? logoOf(current, currentChannel?.baseUrl) : null} size={13} />}
        label={label}
      />

      {open ? (
        <div
          ref={panel}
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-1.5 flex w-[260px] flex-col rounded-card bg-surface py-1 shadow-overlay"
          style={{ animation: "picker-in 140ms var(--ease-out-strong-css) both", transformOrigin: "bottom left" }}
        >
          {searchable ? (
            /* the search line: 28 high, 4 in, radius 5, a line that turns the
               focus colour */
            <label className="mx-1 mb-0.5 flex h-7 items-center gap-1.5 rounded-[5px] border border-transparent px-[7px] focus-within:border-accent">
              <SearchIcon size={14} className="shrink-0 text-ink-4" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSubmenu(null);
                }}
                placeholder={t("Search models")}
                className="min-w-0 flex-1 bg-transparent text-ui-caption leading-[1.2] text-ink outline-none placeholder:text-ink-4"
              />
            </label>
          ) : null}

          <div className="scrollbar-thin relative max-h-[380px] overflow-y-auto">
            {sections.map((section, sectionIndex) => (
              <div key={section.channel?.id ?? "other"} className={cn(sectionIndex > 0 && "mt-1 border-t border-line")}>
                {/* the heading: 12 / 4|6 / 12 / 3, 11px faint, sticky */}
                <div
                  className={cn(
                    "sticky top-0 z-10 bg-surface px-3 pb-[3px] text-ui-xs text-ink-4",
                    sectionIndex === 0 ? "pt-1" : "pt-1.5",
                  )}
                >
                  {section.channel?.name ?? t("Other")}
                </div>
                {section.rows.map((model) => {
                  const rowKey = key(model);
                  const selected = rowKey === currentKey;
                  const hasSettings = levelsOf(model).filter((value) => value !== "off").length > 0;
                  return (
                    <button
                      key={rowKey}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      title={`${model.provider}/${model.id}`}
                      onClick={() => pick(model)}
                      onMouseEnter={(event) => {
                        if (!hasSettings) {
                          setSubmenu(null);
                          return;
                        }
                        const row = event.currentTarget.getBoundingClientRect();
                        const box = panel.current?.getBoundingClientRect();
                        setSubmenu({ key: rowKey, top: box ? row.top - box.top : 0 });
                      }}
                      className={cn(
                        "mx-1 flex h-[30px] w-[calc(100%-8px)] items-center gap-2.5 rounded-[5px] px-2 text-left transition-colors duration-100 hover:bg-hover",
                        submenu?.key === rowKey && "bg-hover",
                      )}
                    >
                      <span className="flex size-[15px] shrink-0 items-center justify-center text-ink-2">
                        <ModelLogo name={logoOf(model, section.channel?.baseUrl)} size={15} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ui-caption text-ink">{displayName(model)}</span>
                      {selected ? <CheckIcon size={15} className="shrink-0 text-ink" /> : null}
                      {hasSettings ? <ChevronRightIcon size={15} className="ml-1 shrink-0 text-ink-4" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {!sections.length ? <div className="px-3 py-2 text-ui-sm text-ink-4">{t("No models match")}</div> : null}
          </div>

          {onManageModels ? (
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  onManageModels();
                }}
                onMouseEnter={() => setSubmenu(null)}
                className="mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2.5 rounded-[5px] px-2 text-left text-ui-caption text-ink transition-colors duration-100 hover:bg-hover"
              >
                <SlidersIcon size={15} className="shrink-0 text-ink-2" />
                {t("Manage Models…")}
              </button>
            </div>
          ) : null}

          {/* the settings submenu: to the right of its row, level with it,
              4px off; the same panel; "Effort" over 28px rows */}
          {submenu && submenuModel && submenuLevels.length ? (
            <div
              role="menu"
              className="absolute left-full z-50 ml-1 flex min-w-[148px] max-w-[240px] flex-col rounded-card bg-surface py-1 shadow-overlay"
              style={{
                top: Math.max(0, submenu.top - 4),
                animation: "picker-in 90ms var(--ease-out-strong-css) both",
                transformOrigin: "left top",
              }}
            >
              <div className="flex h-6 items-center px-2 text-ui-xs text-ink-4">{t("Effort")}</div>
              {submenuLevels.map((value) => {
                const active = key(submenuModel) === currentKey && value === level;
                return (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => pickEffort(submenuModel, value)}
                    className="mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2.5 rounded-[5px] px-2 text-left text-ui-caption text-ink transition-colors duration-100 hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{t(value)}</span>
                    {active ? <CheckIcon size={15} className="shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
