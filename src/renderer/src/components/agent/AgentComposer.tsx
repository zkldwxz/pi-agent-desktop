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

  /* the session's token accounting, on the same row as the model pill */
  const tokens = state.snapshot?.stats?.tokens;

  return (
    <div className="flex w-full flex-col items-center px-6 pb-3 pt-1">
      <div className="w-full max-w-[720px]">
        <PromptBar
          variant="Rounded"
          demo={false}
          forceWide={messages.length > 0}
          placeholder="Ask Pi to build, analyze or explain anything…"
          controls={
            <ModelThinkingControl state={state} onSetModel={onSetModel} onSetThinking={onSetThinking} />
          }
          controlsTrailing={
            <>
              {tokens && tokens.total > 0 ? (
                <CacheRing stats={{ total: tokens.total, cacheRead: tokens.cacheRead }} />
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
        />
      </div>
    </div>
  );
}
