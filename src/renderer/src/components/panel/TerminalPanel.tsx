import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { ArrowUpIcon, SquareStopIcon, TerminalIcon } from "../icons";

interface Line {
  id: number;
  kind: "prompt" | "out" | "error";
  text: string;
}

let nextId = 1;

/**
 * Agent shell.
 *
 * Commands run through `session.executeBash`, not a PTY. That is the pi logic:
 * the same shell, the same `shellPath` config, and — the reason it matters —
 * the output is recorded into the session, so the next prompt already knows
 * what the command printed. A PTY would look more like a terminal and tell the
 * agent nothing.
 *
 * Tradeoff: no interactive TUI programs (vim, top). Those need a real PTY.
 */
export function TerminalPanel({ cwd }: { cwd: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [past, setPast] = useState<string[]>([]);
  const [pastIndex, setPastIndex] = useState(-1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // streamed stdout/stderr, appended verbatim — whitespace-pre-wrap keeps the
  // newlines, so there is no need to re-split chunks into lines
  useEffect(() => {
    const unsubscribe = window.pi.onTerminalChunk((chunk) => {
      setLines((current) => [...current, { id: nextId++, kind: "out", text: chunk.delta }]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines, running]);

  const submit = async () => {
    const command = draft.trim();
    if (!command || running) return;
    setPast((current) => [command, ...current].slice(0, 60));
    setPastIndex(-1);
    setDraft("");
    setLines((current) => [...current, { id: nextId++, kind: "prompt", text: command }]);
    setRunning(true);
    try {
      const result = await window.pi.runBash(command);
      if (result.exitCode !== 0 && result.exitCode !== undefined) {
        setLines((current) => [...current, { id: nextId++, kind: "error", text: `exit ${result.exitCode}` }]);
      }
    } catch (error) {
      setLines((current) => [
        ...current,
        { id: nextId++, kind: "error", text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
        <TerminalIcon size={12} className="text-ink-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">
          {cwd} · agent shell · output joins the conversation
        </span>
        {running ? (
          <button
            type="button"
            onClick={() => void window.pi.abortBash()}
            className="pressable inline-flex h-6 items-center gap-1.5 rounded-chip bg-field px-2 text-[11px] text-ink-2 hover:bg-hover-2"
          >
            <SquareStopIcon size={10} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setLines([])}
            className="pressable inline-flex h-6 items-center rounded-chip px-2 text-[11px] text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.6]"
      >
        {lines.length === 0 ? (
          <div className="flex flex-col gap-1 py-2 text-ink-3">
            <span>Runs through the agent's own bash tool.</span>
            <span className="text-[11px]">
              Same shell the model uses, and the output is recorded in the session so the next prompt can see it.
            </span>
            <span className="mt-1 text-[11px]">
              Try <span className="text-ink-2">git status</span> or <span className="text-ink-2">ls -la</span>
            </span>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.kind === "prompt" && "text-accent-ink",
                line.kind === "out" && "text-ink-2",
                line.kind === "error" && "text-red",
              )}
              style={line.kind === "prompt" ? { animation: "fade-up 200ms cubic-bezier(0.23,1,0.32,1) both" } : undefined}
            >
              {line.kind === "prompt" ? `❯ ${line.text}` : line.text}
            </div>
          ))
        )}
        {running ? (
          <div className="flex items-center gap-2 pt-1 text-ink-3" style={{ animation: "fade-in 200ms ease-out both" }}>
            <span className="spin-fast size-2.5 rounded-full border-[1.5px] border-line-strong border-t-accent" />
            running…
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <span className="font-mono text-[12px] text-ink-3">❯</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
              return;
            }
            if (event.key === "ArrowUp" && past.length) {
              event.preventDefault();
              const next = Math.min(pastIndex + 1, past.length - 1);
              setPastIndex(next);
              setDraft(past[next]);
              return;
            }
            if (event.key === "ArrowDown" && past.length) {
              event.preventDefault();
              const next = pastIndex - 1;
              setPastIndex(next);
              setDraft(next < 0 ? "" : past[next]);
            }
          }}
          placeholder={running ? "running…" : "Enter to run"}
          disabled={running}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={running || !draft.trim()}
          aria-label="Run command"
          className="pressable flex size-6 items-center justify-center rounded-[6px] bg-ink text-canvas disabled:bg-line-strong disabled:text-ink-3"
        >
          <ArrowUpIcon size={13} />
        </button>
      </div>
    </div>
  );
}
