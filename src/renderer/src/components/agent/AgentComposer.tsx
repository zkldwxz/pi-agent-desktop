import { useMemo } from "react";
import type { ChatMessage, HostState } from "@shared/types";
import PromptBar from "../beautiful/primitives/PromptBar";
import { buildTurns, toolSignature } from "../../lib/agent-view";
import { ModelThinkingControl } from "./ModelThinkingControl";
import { CacheRing } from "./CacheRing";
import { ContextBadge } from "../panel/ContextBadge";

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
 * `PromptBar` already owns the hard parts: the `@` / `/` menus with a single
 * gliding highlight, keyboard traversal with ↑↓ and Enter, the measured
 * textarea that grows past one line, the rainbow sweep on thinking depth, and
 * dictation. We supply the real catalogues and the run state, so the send
 * control becomes a stop control while the agent works.
 *
 * Placement: the model and thinking cluster is the host `controls` slot on the
 * bottom row, immediately left of dictation — it qualifies the prompt you are
 * about to write, so it belongs next to the input rather than in the window
 * header. The cache and context rings are the `footer` slot, under dictation.
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
}: {
  state: HostState;
  messages: ChatMessage[];
  prefill?: string;
  onPrefillConsumed?: () => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
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
  const sources = useMemo(() => {
    const touched = recentFiles(messages);
    const entries = [
      { key: "agents", name: "AGENTS.md", desc: "project context the agent reads first", glyph: "clip" },
      { key: "pkg", name: "package.json", desc: "dependencies and scripts", glyph: "layers" },
      ...touched.map((path) => ({ key: path, name: path, desc: "read earlier in this session", glyph: "clip" })),
    ];
    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
    return unique.slice(0, 10);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the session's token accounting, shown under the model control */
  const tokens = state.snapshot?.stats?.tokens;

  return (
    <div className="flex w-full flex-col items-center gap-2 px-6 pb-5 pt-1.5">
      <div className="w-full max-w-[720px]">
        <PromptBar
          variant="Rounded"
          demo={false}
          tall
          forceWide={messages.length > 0}
          placeholder="Ask Pi to build, analyze or explain anything…"
          controls={
            <ModelThinkingControl state={state} onSetModel={onSetModel} onSetThinking={onSetThinking} />
          }
          commands={commands}
          sources={sources}
          streaming={Boolean(state.snapshot?.isStreaming)}
          onAbort={onAbort}
          onSend={onSend}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
        />

        {/* The two rings sit *outside* the bar, in the same column template as
            the control row above, so each lands under the thing it describes:
            cache under the model, context under dictation. Inside the bar they
            competed with the prompt for the same row; here they are ambient. */}
        <div className="mt-1 grid grid-cols-[28px_minmax(0,1fr)_auto_28px_28px] items-center gap-x-1 px-[13px]">
          <div className="col-start-2 flex items-center">
            {tokens && tokens.total > 0 ? (
              <CacheRing stats={{ total: tokens.total, cacheRead: tokens.cacheRead }} />
            ) : null}
          </div>
          <div className="col-start-4 flex items-center justify-center">
            <ContextBadge state={state} />
          </div>
        </div>
      </div>
      <div className="text-[10.5px] text-ink-3">
        Enter to send · Shift+Enter for a new line · @ for context · / for commands
      </div>
    </div>
  );
}
