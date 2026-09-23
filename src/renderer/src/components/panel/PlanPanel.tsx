import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HostState, PlanAction, PlanState } from "@shared/types";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import { Markdown } from "../Markdown";
import TaskRows, { type TaskRow } from "../beautiful/primitives/TaskRows";
import { GlideList, Popover } from "../motion";
import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  ListChecksIcon,
  LoaderIcon,
  PlusIcon,
  RefreshIcon,
} from "../icons";
import { EmptyState } from "../ui";

type ModelRef = { provider: string; id: string };

const PHASE_LABEL: Record<PlanState["phase"], string> = {
  off: "Plan mode",
  planning: "Planning…",
  review: "Plan ready",
  executing: "Building",
};

const PHASE_TONE: Record<PlanState["phase"], string> = {
  off: "var(--ink-3)",
  planning: "var(--accent)",
  review: "var(--plan)",
  executing: "var(--green)",
};

/** `plan-mode-extension.md` — the file, which is the plan's real name. */
function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** `F:/Projects/pi-agent-desktop/.pi/plans` */
function parentDir(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}

/**
 * The plan file, split into the parts the document shows where.
 *
 * A plan is a markdown file — that is the artifact the extension writes and the
 * user keeps — so this panel reads it back and renders it instead of redrawing
 * the plan from state. Three of its parts already have a home on screen: the H1
 * is the document's title, the byline under it is metadata the header carries
 * anyway, and the `## Steps` section is the live task list below (its statuses
 * come from the extension, not from the file, which is written once). What is
 * left — the notes the agent wrote — is the document itself.
 */
function splitPlan(text: string): { title?: string; body: string } {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let title: string | undefined;
  let head = true;
  let inSteps = false;
  for (const line of lines) {
    if (head) {
      const trimmed = line.trim();
      if (!title && /^#\s+/.test(trimmed)) {
        title = trimmed.replace(/^#\s+/, "");
        continue;
      }
      if (/^_[^_]*_$/.test(trimmed)) continue;
      if (trimmed) head = false;
    }
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) inSteps = /^steps$/i.test(heading[1].trim());
    if (!inSteps) kept.push(line);
  }
  return { title, body: kept.join("\n").trim() };
}

/**
 * The plan, as the document it actually is.
 *
 * Plan mode writes a markdown file; this panel is the window onto it. The
 * header says which file and where, the toolbar holds the one decision the
 * document exists to ask for — build it, on this model — and the file's own
 * prose is rendered below it. The steps come last as the live task list, since
 * their statuses are kept by the extension as the build runs.
 *
 * Build is the only control here that changes the model the session runs on, so
 * the picker sits on the button itself and remembers what it was last told: the
 * model you chose last time, or the one the plan was written with. A plan that
 * plan mode has left is not buildable — there is nothing left to approve — and
 * the panel says so by offering to start the mode again instead.
 *
 * The overflow menu is the file's own actions: the plan copied out as markdown,
 * its path copied, or handed to the file manager.
 */
export function PlanPanel({
  state,
  buildModel,
  onAction,
}: {
  state: HostState;
  /** the model Build last ran with, from the desktop config */
  buildModel?: ModelRef;
  onAction: (action: PlanAction) => void;
}) {
  const plan = state.plan;
  const path = plan.path;
  /** the file as it was read back; null until the first read lands */
  const [file, setFile] = useState<{ text: string; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<ModelRef | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [note, setNote] = useState("");
  const copyTimer = useRef<number | undefined>(undefined);

  /* The document is the file, read from disk rather than mirrored in state: a
   * plan that has been edited by hand reads correctly here, and what the user
   * reviews is exactly what was kept. Keyed on the path — a refined plan is a
   * new file — with the header's refresh for the rest. */
  useEffect(() => {
    setFile(null);
    if (!path) {
      setFile({ text: "" });
      return;
    }
    let cancelled = false;
    void window.pi
      .readFile(path)
      .then((content) => {
        if (!cancelled) setFile({ text: content.text ?? "", error: content.error });
      })
      .catch((error: unknown) => {
        if (!cancelled) setFile({ text: "", error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, reload]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const doc = useMemo(() => splitPlan(file?.text || plan.notes || ""), [file?.text, plan.notes]);

  const current = state.snapshot?.model;
  const parent = plan.parentModel;
  const target = picked ?? buildModel ?? parent ?? (current ? { provider: current.provider, id: current.id } : undefined);
  const targetName =
    state.models.find((model) => model.provider === target?.provider && model.id === target?.id)?.name ?? target?.id ?? "—";

  const done = plan.steps.filter((step) => step.status === "done").length;
  const rows: TaskRow[] = plan.steps.map((step, index) => ({
    key: step.id || `step-${index}`,
    label: step.label,
    amount: "",
    status: step.status,
    step: index + 1,
    details: step.detail ? [{ label: step.detail, meta: "" }] : [],
  }));

  /* grouped for the picker; the providers in order, the models in the order the
   * host sent them (which is the catalogue's own order, not alphabetical) */
  const grouped = state.models.reduce<Array<[string, typeof state.models]>>((out, model) => {
    const entry = out.find(([provider]) => provider === model.provider);
    if (entry) entry[1].push(model);
    else out.push([model.provider, [model]]);
    return out;
  }, []);

  /* Approving is the only way to build — a plan is buildable while it is
     waiting for that decision and not after, which is what makes plan mode
     leaving the plan unbuildable. */
  const canBuild = plan.phase === "review" && plan.steps.length > 0 && state.snapshot?.isIdle === true;
  const showDoc = Boolean(path || plan.steps.length) && plan.phase !== "planning";

  const copy = (what: string, text: string) => {
    if (!text) return;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(what);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
      })
      .catch(() => undefined);
  };

  const refine = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    onAction({ action: "refine", note: trimmed });
    setNote("");
    setRefining(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showDoc ? (
        <header className="shrink-0 px-3 pt-3">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: PHASE_TONE[plan.phase] }} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-2">{t(PHASE_LABEL[plan.phase])}</span>
            {plan.steps.length ? (
              <span className="shrink-0 font-mono text-[10.5px] text-ink-3 tabular-nums">
                {done}/{plan.steps.length}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={t("Re-read the plan file")}
              title={t("Re-read the plan file")}
              onClick={() => setReload((count) => count + 1)}
              className="pressable flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              <RefreshIcon size={11} />
            </button>
          </div>

          {/* the file this document is: its title, then the name and folder the
              copy actions hand out — clicking through reaches it on disk */}
          <button
            type="button"
            disabled={!path}
            onClick={() => path && void window.pi.showItem(path)}
            title={path}
            className="pressable mt-1.5 block w-full min-w-0 text-left"
          >
            <div className="truncate text-[13px] font-medium tracking-[-0.01em] text-ink">
              {doc.title || plan.title || baseName(path ?? "Plan")}
            </div>
            <div className="truncate font-mono text-[10px] text-ink-3">
              {baseName(path ?? "Plan")} · {parentDir(path ?? "")}
            </div>
          </button>

          {/* the toolbar: the model Build runs on, Build itself — one button,
              no cloud or local split — and the file's own actions */}
          {plan.phase === "review" || plan.phase === "executing" ? (
            <div className="relative mt-2 flex items-center gap-1.5">
              {plan.phase === "review" ? (
                <>
                  <button
                    type="button"
                    data-popover-trigger
                    aria-expanded={pickerOpen}
                    onClick={() => {
                      setMenuOpen(false);
                      setPickerOpen((open) => !open);
                    }}
                    title={t("Model to build with")}
                    className="pressable flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[8px] bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
                  >
                    <span className="truncate">{targetName}</span>
                    <ChevronDownIcon size={11} className="shrink-0 text-ink-3" />
                  </button>
                  <button
                    type="button"
                    disabled={!canBuild}
                    onClick={() => target && onAction({ action: "build", model: target })}
                    className="pressable flex h-7 shrink-0 items-center justify-center rounded-[8px] bg-plan px-3 text-[12px] font-semibold text-plan-ink hover:bg-plan/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("Build")}
                  </button>
                </>
              ) : (
                <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-plan-tint px-2 text-[11.5px] font-medium text-plan-ink">
                  <LoaderIcon size={11} className="spin-fast shrink-0" />
                  <span className="truncate">{tf("{done} of {total} steps done", { done, total: plan.steps.length })}</span>
                </span>
              )}
              <button
                type="button"
                data-popover-trigger
                aria-expanded={menuOpen}
                aria-label={t("More actions")}
                title={t("More actions")}
                onClick={() => {
                  setPickerOpen(false);
                  setMenuOpen((open) => !open);
                }}
                className="pressable flex size-7 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                <EllipsisIcon size={14} />
              </button>

              <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} anchor="top-right" className="w-64">
                <div className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
                  {grouped.map(([provider, models]) => (
                    <div key={provider} className="mb-1.5">
                      <div className="px-1 pb-0.5 font-mono text-[10px] text-ink-3">{provider}</div>
                      <GlideList rowSelector="[data-row]" highlightClassName="bg-hover" radius={6}>
                        {models.map((model) => {
                          const active = target?.provider === model.provider && target?.id === model.id;
                          return (
                            <button
                              key={model.id}
                              data-row
                              type="button"
                              onClick={() => {
                                setPicked({ provider: model.provider, id: model.id });
                                setPickerOpen(false);
                              }}
                              className={cn(
                                "glide-row pressable flex items-center gap-2 rounded-[6px] px-2 py-1 text-left",
                                active && "bg-surface shadow-hairline",
                              )}
                            >
                              <span className={cn("min-w-0 flex-1 truncate text-[11.5px]", active ? "text-ink" : "text-ink-2")}>
                                {model.name}
                              </span>
                              {active ? <span className="size-1.5 shrink-0 rounded-full bg-plan" /> : null}
                            </button>
                          );
                        })}
                      </GlideList>
                    </div>
                  ))}
                </div>
              </Popover>

              <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchor="top-right" className="w-56">
                <div className="p-1">
                  <MenuRow
                    icon={<CopyIcon size={12} />}
                    label={copied === "markdown" ? t("Copied") : t("Copy as Markdown")}
                    disabled={!file?.text}
                    onClick={() => copy("markdown", file?.text ?? "")}
                  />
                  <MenuRow
                    icon={<FolderIcon size={12} />}
                    label={copied === "path" ? t("Copied") : t("Copy file path")}
                    onClick={() => copy("path", path ?? "")}
                  />
                  <MenuRow
                    icon={<FolderOpenIcon size={12} />}
                    label={t("Reveal in explorer")}
                    onClick={() => {
                      setMenuOpen(false);
                      if (path) void window.pi.showItem(path);
                    }}
                  />
                </div>
              </Popover>
            </div>
          ) : null}

          {plan.phase === "review" && !buildModel && !picked && parent ? (
            <div className="mt-1.5 text-[10.5px] leading-snug text-ink-3">{t("Build defaults to the model that wrote the plan.")}</div>
          ) : null}
        </header>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {plan.phase === "off" && !path && !plan.steps.length ? (
          <EmptyState
            title={t("No plan yet")}
            body={t(
              "Plan mode explores read-only and hands you a plan to approve before anything is written. Approving it starts the build and works the steps in order.",
            )}
          />
        ) : plan.phase === "planning" ? (
          <div className="mt-2 rounded-card bg-inset px-3 py-3">
            <div className="flex items-center gap-2">
              <ListChecksIcon size={13} className="text-accent" />
              <span className="text-[12px] text-ink">{t("Researching, read-only")}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
              {t(
                "Write calls are refused while this runs. When the agent calls create_plan, the plan lands here for review.",
              )}
            </p>
          </div>
        ) : (
          <>
            {/* the document proper: the plan's own prose, as markdown */}
            {file?.error ? (
              <div className="mt-3 rounded-card bg-red-tint px-3 py-2 text-[11.5px] text-red">{file.error}</div>
            ) : doc.body ? (
              <div className="mt-3">
                <Markdown>{doc.body}</Markdown>
              </div>
            ) : file ? (
              <div className="mt-3 rounded-card border border-dashed border-line-strong px-3 py-2 text-[11.5px] leading-relaxed text-ink-3">
                {t("The plan file holds nothing but its steps.")}
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-3.5 rounded-[4px] bg-hover-2"
                    style={{ width: `${45 + ((index * 19) % 50)}%`, animation: `fade-in 300ms ease-out ${index * 30}ms both` }}
                  />
                ))}
              </div>
            )}

            {/* the steps, live: what the extension keeps updated as the build runs */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11px] tracking-[0.3px] text-ink-3">{t("Tasks")}</span>
              <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">
                {done}/{plan.steps.length}
              </span>
              <span className="flex-1" />
              {plan.phase === "review" ? (
                <button
                  type="button"
                  onClick={() => setRefining((open) => !open)}
                  className="pressable flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11px] text-ink-2 hover:bg-hover"
                >
                  <PlusIcon size={10} />
                  {t("Refine")}
                </button>
              ) : null}
            </div>

            {refining ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  autoFocus
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") refine();
                    if (event.key === "Escape") setRefining(false);
                  }}
                  placeholder={t("What should change?")}
                  className="h-7 min-w-0 flex-1 rounded-[8px] bg-field px-2 text-[11.5px] text-ink placeholder:text-ink-3 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!note.trim()}
                  onClick={refine}
                  className="pressable h-7 shrink-0 rounded-[8px] bg-field px-2.5 text-[11px] text-ink disabled:opacity-40"
                >
                  {t("Refine")}
                </button>
              </div>
            ) : null}

            {plan.steps.length ? (
              <>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-field">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${(done / plan.steps.length) * 100}%`,
                      transition: "width 300ms cubic-bezier(0.23,1,0.32,1)",
                    }}
                  />
                </div>
                <div className="mt-2">
                  <TaskRows variant="List" rows={rows} instant labels={{ completed: t("Done"), failed: t("Failed") }} />
                </div>
              </>
            ) : (
              <div className="mt-1.5 text-[11.5px] text-ink-3">{t("The plan has no steps yet.")}</div>
            )}
          </>
        )}
      </div>

      <footer className="mt-auto shrink-0 border-t border-line p-3">
        {plan.phase === "off" ? (
          <button
            type="button"
            onClick={() => onAction({ action: "toggle" })}
            className="pressable flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-field text-[12px] font-medium text-ink hover:bg-hover-2"
          >
            <ListChecksIcon size={13} />
            {t("Start plan mode")}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {plan.phase === "executing" ? (
              <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-ink-3">
                {t("Building. The steps above follow the task list the agent keeps updated.")}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <button
              type="button"
              onClick={() => onAction({ action: "cancel" })}
              title={t("Leave plan mode. The plan file stays on disk, but there is nothing left to build.")}
              className="pressable flex h-7 shrink-0 items-center rounded-[6px] px-2 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              {t("Cancel plan mode")}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pressable flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[11.5px] text-ink-2 hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
