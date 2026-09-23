import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { promptTokens } from "@shared/cache-usage";
import type { ChatMessage, HostState, PlanAction, PlanState } from "@shared/types";
import PromptBar from "../beautiful/primitives/PromptBar";
import { buildTurns, toolSignature } from "../../lib/agent-view";
import { ModelThinkingControl } from "./ModelThinkingControl";
import { CacheRing } from "./CacheRing";
import { ContextBadge } from "../panel/ContextBadge";
import { t, useLocale } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { ListChecksIcon } from "../icons";
import { useUltraSweep } from "../../lib/theme";

/** What the pill says, per phase. */
const PLAN_LABEL: Record<PlanState["phase"], string> = {
  off: "Plan",
  planning: "Planning",
  review: "Plan ready",
  executing: "Building",
};

const PLAN_HINT: Record<PlanState["phase"], string> = {
  off: "Plan mode — the agent explores read-only and hands you a plan to approve",
  planning: "Planning, read-only — click to leave plan mode",
  review: "A plan is waiting for review — click to leave plan mode",
  executing: "Building the plan — click to leave plan mode",
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
  onSetThinking,
  onPlanAction,
}: {
  state: HostState;
  messages: ChatMessage[];
  prefill?: string;
  onPrefillConsumed?: () => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
  onPlanAction: (action: PlanAction) => void;
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
  const tokens = state.snapshot?.stats?.tokens;

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
     plugin published and toggles it through `/plan`, so it says the same thing
     whether the mode was entered from here, from the `/` menu or from the CLI. */
  const planPhase = state.plan.phase;
  const planOn = planPhase !== "off";
  const onPlan = useCallback(() => {
    onPlanAction({ action: planOn ? "cancel" : "toggle" });
  }, [onPlanAction, planOn]);

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
  /* the travelling light is the Ultra hue: the sweep is a Max-depth moment, and
     Max is where the track and the level label go purple */
  const sweepPalette = useUltraSweep();

  return (
    <div className="flex w-full flex-col items-center px-6 pb-3 pt-1">
      <div className="w-full max-w-[720px]">
        <PromptBar
          variant="Rounded"
          demo={false}
          forceWide={messages.length > 0}
          placeholder={messages.length ? t("Send follow-up…") : t("Ask Pi to build, analyze or explain anything…")}
          controls={
            <ModelThinkingControl state={state} onSetModel={onSetModel} onSetThinking={onSetThinking} />
          }
          controlsTrailing={
            <>
              {tokens && promptTokens(tokens) > 0 ? (
                <CacheRing
                  stats={{ input: tokens.input, cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite }}
                />
              ) : null}
              <ContextBadge state={state} />
            </>
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
            /* the mode is always one click away, and it tells the truth about
               which phase it is in — amber the moment a plan is waiting */
            <button
              type="button"
              aria-pressed={planOn}
              aria-label={t("Plan mode")}
              title={t(PLAN_HINT[planPhase])}
              onClick={onPlan}
              className={cn(
                "pressable hidden h-7 items-center gap-1 rounded-[8px] px-1.5 text-[11.5px] font-medium",
                "transition-[background-color,color] duration-150 sm:inline-flex",
                planPhase === "off"
                  ? "text-ink-3 hover:bg-hover hover:text-ink"
                  : planPhase === "planning"
                    ? "bg-accent-tint text-accent-ink hover:bg-accent-tint/80"
                    : "bg-plan-tint text-plan-ink hover:bg-plan-tint/80",
              )}
            >
              <ListChecksIcon size={12} />
              {t(PLAN_LABEL[planPhase])}
            </button>
          }
          sweepPalette={sweepPalette}
        />
      </div>
    </div>
  );
}
