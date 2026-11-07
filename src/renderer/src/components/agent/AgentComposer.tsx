import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, HostState, PlanAction, PlanState } from "@shared/types";
import PromptBar from "../beautiful/primitives/PromptBar";
import { buildTurns, CONVERSATION_COLUMN, toolSignature } from "../../lib/agent-view";
import { ModelThinkingControl } from "./ModelThinkingControl";
import { UsageIndicator, usePlanQuota } from "./UsageIndicator";
import { t, useLocale } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { InfinityIcon, ListChecksIcon, PencilIcon } from "../icons";
import { ActivityStrip, type RunningTask } from "./ActivityStrip";
import { ComposerPill, PickerFooterRow, PickerMenu } from "./ComposerPill";
import { useHotSweep } from "../../lib/theme";

/** What the mode pill adds after "Plan", per phase. */
const PLAN_STATUS: Record<PlanState["phase"], string | null> = {
  off: null,
  planning: "Planning",
  review: "Awaiting review",
  executing: "Building",
};

/** Files this session has already read or edited, as real `@path` mentions. */
function recentFiles(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "toolCall") continue;
      const path = block.arguments.file_path ?? block.arguments.path;
      if (typeof path === "string" && path && !seen.has(path)) seen.add(path);
    }
  }
  return [...seen].slice(-8).reverse();
}

/**
 * The composer, in the Beautiful UI prompt bar.
 *
 * `PromptBar` owns the input and the `@` / `/` menus; everything that
 * qualifies the prompt — model, thinking depth, context pressure, the token
 * ledger — sits on one bottom row, Cursor-style: pills on the left, ambient
 * 16px rings on the right.
 */
export function AgentComposer({
  state,
  messages,
  prefill,
  onPrefillConsumed,
  onSend,
  onAbort,
  onSetModel,
  onManageModels,
  onSetThinking,
  onPlanAction,
  onOpenPlan,
  runningTasks = [],
  onOpenTerminal,
  editingQueued,
}: {
  state: HostState;
  messages: ChatMessage[];
  prefill?: string;
  onPrefillConsumed?: () => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (provider: string, modelId: string) => void;
  /** opens Settings ▸ Models — the model menu's last row */
  onManageModels?: () => void;
  onSetThinking: (level: string) => void;
  onPlanAction: (action: PlanAction) => void;
  /** opens the plan panel; the badge uses it whenever a plan file exists */
  onOpenPlan?: () => void;
  /** the terminal calls the agent is running right now — the activity strip */
  runningTasks?: RunningTask[];
  /** clicking a running command opens the dock on the terminal */
  onOpenTerminal?: () => void;
  /** a queued message was loaded back into the editor — the shell says so */
  editingQueued?: boolean;
}) {
  const commands = useMemo(
    () =>
      state.commands.map((command) => ({
        key: command.name,
        name: `/${command.name}`,
        desc: command.description ?? command.source,
      })),
    [state.commands],
  );

  // the @-mention catalogue only moves when a tool call lands; keying it on the
  // work signature keeps a plain streaming answer from re-scanning the log
  const signature = toolSignature(useMemo(() => buildTurns(messages, []), [messages]));

  /* the workspace itself is the real @ catalogue: one bounded walk per
   * workspace, refreshed when the folder changes */
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  useLocale();
  useEffect(() => {
    let cancelled = false;
    void window.pi
      .searchFiles()
      .then((hits) => {
        if (!cancelled) setWorkspaceFiles(hits.map((hit) => hit.path));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.cwd]);

  const sources = useMemo(() => {
    const touched = recentFiles(messages);
    const entries = [
      { key: "agents", name: "AGENTS.md", desc: "project context the agent reads first", glyph: "clip" },
      { key: "pkg", name: "package.json", desc: "dependencies and scripts", glyph: "layers" },
      ...touched.map((path) => ({ key: path, name: path, desc: "read earlier in this session", glyph: "clip" })),
      ...workspaceFiles.map((path) => ({ key: path, name: path, desc: "", glyph: "clip" })),
    ];
    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
    // session touches first, then the workspace walk (breadth-first, so the
    // files people actually mention come before the deep ones)
    return unique.slice(0, 400);
  }, [signature, workspaceFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the session's token accounting, on the same row as the model pill */
  const quota = usePlanQuota(Boolean(state.snapshot?.isStreaming));

  /* pasted images append their path references to whatever is being typed */
  const [appendState, setAppendState] = useState<
    { text: string; nonce: number; mode?: "append" | "replace" } | undefined
  >(undefined);
  const appendNonce = useRef(0);
  const appendToDraft = useCallback((text: string) => {
    appendNonce.current += 1;
    setAppendState({ text, nonce: appendNonce.current, mode: "append" });
  }, []);

  /* Plan mode is the plugin's, not the draft's: the pill reads the phase the
     plugin published, so it says the same thing whether the mode was entered
     from here, from the `/` menu or from the CLI. It only exists once the mode
     is on — `/plan` starts it, and the pill is then the way back out. */
  const planPhase = state.plan.phase;
  const planOn = planPhase !== "off";
  /* the right pane no longer opens itself for a plan, so with a plan written
     the badge is the way to it; the panel carries "leave plan mode". Before a
     plan exists the badge still leaves the mode. */
  const hasPlan = Boolean(state.plan.path) && Boolean(onOpenPlan);
  /* the mode pill: always there, as baocode's "Agent ▾" is — Agent or Plan,
     switched from its menu; with a plan written, the menu opens it too */
  const [modeOpen, setModeOpen] = useState(false);
  const closeMode = useCallback(() => setModeOpen(false), []);
  const planStatus = PLAN_STATUS[planPhase];

  /* pasted images become path references. A file already on disk keeps its
     path; anything temporary (or a raw clipboard bitmap) is copied into the
     app's own paste directory first, so the reference survives temp cleaners
     for the 24 hours the desktop keeps it. */
  const isTempPath = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    return /(^|\/)(windows\/temp|appdata\/local\/temp)\//.test(normalized);
  }, []);
  const handlePasteFiles = useCallback(
    (files: File[]): boolean => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (!images.length) return false;
      void (async () => {
        const refs: string[] = [];
        for (const image of images) {
          const path = window.pi.getPathForFile(image);
          if (path && !isTempPath(path)) {
            refs.push(`@${path}`);
            continue;
          }
          /* no usable source path — read the bytes and let the main process
             park them in our paste directory */
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve("");
            reader.readAsDataURL(image);
          });
          if (!dataUrl) continue;
          try {
            const saved = await window.pi.savePasteImage(dataUrl, image.type.split("/")[1]);
            refs.push(`@${saved}`);
          } catch {
            /* unreadable clipboard image — skip it silently */
          }
        }
        if (refs.length) appendToDraft(refs.join(" "));
      })();
      return true;
    },
    [appendToDraft, isTempPath],
  );
  /* the travelling light is the hot hue: the sweep is a Max-depth moment, and
     Max is where the track and the level label go purple */
  const sweepPalette = useHotSweep();

  return (
    <div className="flex w-full flex-col items-center px-6 pb-3 pt-1">
      <div
        className={cn(
          /* the dock renders ZCode's exact conversation column — the same
             class the timeline uses, or the prompt bar drifts out of line
             with the text it answers. The greeting stays a centred hero. */
          messages.length > 0 ? CONVERSATION_COLUMN : "mx-auto w-full max-w-[720px]",
          "transition-transform duration-150 ease-out",
          /* no inset: the shell spans the column, edge for edge with the
             prompt cards above it */
        )}
      >
      {editingQueued ? (
        /* the shell's status line: green, gone the moment the draft is sent */
        <div
          className="mb-1.5 flex w-full items-center gap-1.5 rounded-control bg-green-tint px-2 py-1 text-ui-sm text-green"
          style={{ animation: "fade-up 200ms var(--ease-out-strong-css) both" }}
        >
          <PencilIcon size={11} className="shrink-0" />
          {t("Editing a queued message — Enter sends it")}
        </div>
      ) : null}
        {/* what is running, over the composer (baocode's activity strip) */}
        <ActivityStrip tasks={runningTasks} onOpen={onOpenTerminal} onStop={onAbort} />
        <PromptBar
          variant="Rounded"
          tall
          demo={false}
          forceWide={messages.length > 0}
          placeholder={messages.length ? t("Send follow-up…") : t("Ask Pi to build, analyze or explain anything…")}
          controls={
            <>
              <ModelThinkingControl
                state={state}
                onSetModel={onSetModel}
                onSetThinking={onSetThinking}
                onManageModels={onManageModels}
              />
            </>
          }
          controlsTrailing={
            /* one indicator for context, cache and plan quota — it replaced
               two unlabeled rings */
            <UsageIndicator state={state} quotas={quota.quotas} loading={quota.loading} onRefresh={quota.refresh} />
          }
          commands={commands}
          sources={sources}
          streaming={Boolean(state.snapshot?.isStreaming)}
          onAbort={onAbort}
          onSend={onSend}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
          appendToken={appendState}
          onPasteFiles={handlePasteFiles}
          leadingAddon={
            /* the mode pill — the emphasized one, as baocode's "Agent ▾" */
            <span className="relative hidden sm:inline-flex">
              <ComposerPill
                emphasized
                menu
                open={modeOpen}
                onClick={() => setModeOpen((value) => !value)}
                title={t("Mode")}
                icon={planOn ? <ListChecksIcon size={13} /> : <InfinityIcon size={13} />}
                label={planOn ? (planStatus ? `${t("Plan")} · ${t(planStatus)}` : t("Plan")) : t("Agent")}
              />
              <PickerMenu
                open={modeOpen}
                onClose={closeMode}
                options={[
                  {
                    key: "agent",
                    label: t("Agent"),
                    description: t("Edits and runs commands directly"),
                    icon: <InfinityIcon size={15} />,
                    selected: !planOn,
                    onSelect: () => {
                      if (planOn) onPlanAction({ action: "cancel" });
                    },
                  },
                  {
                    key: "plan",
                    label: t("Plan"),
                    description: t("Explores read-only, then hands you a plan"),
                    icon: <ListChecksIcon size={15} />,
                    selected: planOn,
                    onSelect: () => {
                      if (!planOn) onPlanAction({ action: "toggle" });
                    },
                  },
                ]}
                footer={
                  hasPlan ? (
                    <PickerFooterRow icon={<ListChecksIcon size={15} />} label={t("Open the plan")} onClick={() => {
                      setModeOpen(false);
                      onOpenPlan?.();
                    }} />
                  ) : undefined
                }
              />
            </span>
          }
          sweepPalette={sweepPalette}
        />
      </div>
    </div>
  );
}
