import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { PtySession, TerminalShell } from "@shared/terminal";
import { cn } from "../../lib/cn";
import { t, tf } from "../../lib/i18n";
import { Popover } from "../motion";
import { ArrowUpIcon, ChevronDownIcon, PlusIcon, SparkIcon, SquareStopIcon, TerminalIcon, XIcon } from "../icons";

interface Line {
  id: number;
  kind: "prompt" | "out" | "error";
  text: string;
}

let nextLineId = 1;

/**
 * Resolve a design token to something xterm's canvas will accept.
 *
 * The palette is written in oklch; xterm hands its colours straight to
 * `fillStyle`, and a value it cannot parse silently becomes black on black.
 * Painting through a canvas context normalises the colour once, here, so the
 * terminal follows light and dark mode like the rest of the shell.
 */
let probe: CanvasRenderingContext2D | null | undefined;
function resolveColor(cssVar: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!value) return fallback;
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d");
  }
  if (!probe) return value;
  probe.fillStyle = "#000000";
  probe.fillStyle = value;
  const normalized = probe.fillStyle;
  return typeof normalized === "string" && normalized !== "#000000" ? normalized : value;
}

function terminalTheme() {
  const background = resolveColor("--surface", "#ffffff");
  const foreground = resolveColor("--ink", "#1a1a1a");
  return {
    theme: {
      background,
      foreground,
      cursor: resolveColor("--accent", "#3b82f6"),
      cursorAccent: background,
      selectionBackground: resolveColor("--accent", "#3b82f6") + "55",
      black: resolveColor("--ink", "#1a1a1a"),
      white: resolveColor("--ink", "#1a1a1a"),
      red: resolveColor("--red", "#ef4444"),
      green: resolveColor("--green", "#22c55e"),
      yellow: resolveColor("--orange", "#f59e0b"),
      blue: resolveColor("--accent", "#3b82f6"),
      magenta: resolveColor("--accent-ink", "#6366f1"),
      cyan: resolveColor("--accent", "#3b82f6"),
    },
  };
}

/**
 * One live PTY, rendered by xterm.
 *
 * Remounted whenever the selected tab changes: the host keeps a capped replay
 * buffer per session, so a tab that has been sitting in the background while
 * you read another one still shows everything it printed.
 */
function PtyTerminal({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      scrollback: 4000,
      fontSize: 12.5,
      fontFamily:
        '"Geist Mono Variable", ui-monospace, "PingFang SC", "Microsoft YaHei UI", Menlo, Consolas, monospace',
      minimumContrastRatio: 4.5,
      ...terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    window.pi.resizePty(id, term.cols, term.rows);

    /* chunks that land while the replay is still in flight are held back so the
       scrollback arrives in order rather than after the newest line */
    const queued: string[] = [];
    let ready = false;
    let disposed = false;
    const offData = window.pi.onPtyData((payload) => {
      if (payload.id !== id) return;
      if (!ready) {
        queued.push(payload.data);
        return;
      }
      term.write(payload.data);
    });
    void window.pi.replayPty(id).then((replay) => {
      if (disposed) return;
      term.write(replay);
      for (const chunk of queued) term.write(chunk);
      queued.length = 0;
      ready = true;
      term.focus();
    }).catch(() => {
      if (disposed) return;
      for (const chunk of queued) term.write(chunk);
      queued.length = 0;
      ready = true;
    });

    const input = term.onData((data) => window.pi.writePty(id, data));
    const resize = term.onResize(({ cols, rows }) => window.pi.resizePty(id, cols, rows));

    const observer = new ResizeObserver(() => {
      fit.fit();
      term.scrollToBottom();
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      input.dispose();
      resize.dispose();
      term.dispose();
    };
  }, [id]);

  return <div ref={hostRef} className="xterm-host min-h-0 flex-1 px-2 py-1.5" />;
}

/**
 * The shell the agent itself runs — commands go through `session.executeBash`,
 * so their output is recorded in the conversation and the next prompt already
 * knows what the command printed.
 */
function AgentShell({ cwd }: { cwd: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  /* the command itself is the status — "running…" said nothing the spinner above
     it did not, while the line the user just submitted said everything */
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [past, setPast] = useState<string[]>([]);
  const [pastIndex, setPastIndex] = useState(-1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = window.pi.onTerminalChunk((chunk) => {
      setLines((current) => [...current, { id: nextLineId++, kind: "out", text: chunk.delta }]);
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
    setLines((current) => [...current, { id: nextLineId++, kind: "prompt", text: command }]);
    setRunning(true);
    setRunningCommand(command);
    try {
      const result = await window.pi.runBash(command);
      if (result.exitCode !== 0 && result.exitCode !== undefined) {
        setLines((current) => [...current, { id: nextLineId++, kind: "error", text: `exit ${result.exitCode}` }]);
      }
    } catch (error) {
      setLines((current) => [
        ...current,
        { id: nextLineId++, kind: "error", text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setRunning(false);
      setRunningCommand(null);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <div
        ref={scrollerRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-[12px] py-[8px] font-mono text-ui-caption leading-[1.65]"
      >
        {lines.length === 0 ? (
          <div className="flex flex-col gap-1.5 py-2 text-ink-3">
            <span>{t("Runs through the agent's own bash tool.")}</span>
            <span className="text-ui-sm">
              {t("Same shell the model uses, and the output is recorded in the session so the next prompt can see it.")}
            </span>
            <span className="mt-1 text-ui-sm">
              {t("Try")} <span className="text-ink-2">git status</span> {t("or")} <span className="text-ink-2">ls -la</span>
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
              style={line.kind === "prompt" ? { animation: "fade-up 200ms var(--ease-out-strong-css) both" } : undefined}
            >
              {line.kind === "prompt" ? `❯ ${line.text}` : line.text}
            </div>
          ))
        )}
        {running ? (
          <div className="flex min-w-0 items-center gap-2 pt-1 text-ink-3" style={{ animation: "fade-in 200ms ease-out both" }}>
            <span className="spin-fast size-2.5 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-accent" />
            <span className="min-w-0 truncate font-mono text-ui-sm text-ink-2">
              {runningCommand ?? t("Running")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-[8px] border-t border-line px-[12px] py-[8px]">
        <span className="font-mono text-ui-caption text-ink-3">❯</span>
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
          placeholder={t("Enter to run — output joins the conversation")}
          disabled={running}
          className="min-w-0 flex-1 bg-transparent font-mono text-ui-caption text-ink outline-none placeholder:text-ink-4 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={running || !draft.trim()}
          aria-label={t("Run command")}
          className="pressable flex size-6 items-center justify-center rounded-chip bg-ink text-canvas disabled:bg-line-strong disabled:text-ink-3"
        >
          <ArrowUpIcon size={13} />
        </button>
      </div>
    </>
  );
}

/**
 * The workspace terminal.
 *
 * Real PTYs now: every tab is a shell process the main process owns, started in
 * the folder you are working in, and they keep running when you switch projects
 * or close the dock. That isolation is the point — a dev server belongs to the
 * project that launched it.
 *
 * The agent shell sits behind the second control because it answers a different
 * question: not "run this" but "run this and tell the model what happened".
 */
export function TerminalPanel({ cwd }: { cwd: string }) {
  const [mode, setMode] = useState<"terminal" | "agent">("terminal");
  const [sessions, setSessions] = useState<PtySession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [shellChoices, setShellChoices] = useState<TerminalShell[] | null>(null);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  /** shellId omitted = the preference chain (custom path → preference → first
   *  available), resolved in the main process */
  const open = useCallback(async (shellId?: string) => {
    const requestedCwd = cwdRef.current;
    try {
      const result = await window.pi.spawnPty(requestedCwd, shellId);
      if (cwdRef.current !== requestedCwd) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setSessions((current) => [...current, result]);
      setActiveId(result.id);
    } catch (error) {
      if (cwdRef.current === requestedCwd) setError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const toggleShellMenu = () => {
    const next = !shellMenuOpen;
    setShellMenuOpen(next);
    if (next) {
      void window.pi
        .listShells()
        .then((result) => setShellChoices(result.shells))
        .catch(() => setShellChoices([]));
    }
  };

  /* load this folder's shells — and start one the first time you open it */
  useEffect(() => {
    let cancelled = false;
    setActiveId(null);
    setSessions([]);
    setError(null);
    setShellMenuOpen(false);
    void (async () => {
      const existing = await window.pi.listPtySessions(cwd);
      if (cancelled) return;
      if (existing.length) {
        setSessions(existing);
        setActiveId(existing[existing.length - 1].id);
        return;
      }
      const result = await window.pi.spawnPty(cwd);
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSessions([result]);
      setActiveId(result.id);
    })().catch((error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  useEffect(() => {
    const offExit = window.pi.onPtyExit(({ id, exitCode }) => {
      setSessions((current) => current.map((session) => (session.id === id ? { ...session, status: "exited", exitCode } : session)));
    });
    return offExit;
  }, []);

  const close = (id: string) => {
    void window.pi.killPty(id);
    setSessions((current) => {
      const rest = current.filter((session) => session.id !== id);
      if (id === activeId) setActiveId(rest.length ? rest[rest.length - 1].id : null);
      return rest;
    });
  };

  const active = sessions.find((session) => session.id === activeId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* tabs · new · mode */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session, index) => {
            const selected = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group/tab flex h-6 shrink-0 items-center gap-1 rounded-chip pr-1 pl-2 text-ui-sm",
                  selected ? "bg-field text-ink" : "text-ink-3 hover:bg-hover",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(session.id)}
                  className="pressable flex items-center gap-1.5"
                  title={`${session.shell} · ${session.cwd}`}
                >
                  {session.status === "exited" ? (
                    <span className="size-1.5 rounded-full bg-orange" title={tf("exited {code}", { code: session.exitCode ?? "" })} />
                  ) : null}
                  <span className="font-mono text-ui-xs tabular-nums opacity-60">{index + 1}</span>
                  <span className="max-w-24 truncate">{session.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => close(session.id)}
                  aria-label={tf("Close {name}", { name: session.title })}
                  className="pressable flex size-4 items-center justify-center rounded-tiny opacity-0 group-hover/tab:opacity-100 hover:bg-hover-2"
                >
                  <XIcon size={9} />
                </button>
              </div>
            );
          })}
          <div className="relative flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => void open()}
              aria-label={t("New terminal")}
              title={t("New terminal in this folder")}
              className="pressable flex size-6 items-center justify-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
            >
              <PlusIcon size={12} />
            </button>
            <button
              type="button"
              data-popover-trigger
              onClick={toggleShellMenu}
              aria-label={t("New terminal in a specific shell")}
              title={t("Pick a shell for the new terminal")}
              className={cn(
                "pressable flex size-4 items-center justify-center rounded-tiny text-ink-3 hover:bg-hover hover:text-ink",
                shellMenuOpen && "bg-hover text-ink",
              )}
            >
              <ChevronDownIcon size={9} />
            </button>
            <Popover
              open={shellMenuOpen}
              onClose={() => setShellMenuOpen(false)}
              anchor="bottom-right"
              className="z-40 w-64 rounded-card border border-line bg-surface shadow-card"
            >
              <div className="flex flex-col gap-0.5 p-1">
                <span className="px-2 pt-1 pb-0.5 text-ui-xs tracking-[0.4px] text-ink-3 uppercase">
                  {t("Shell for the new terminal")}
                </span>
                {(shellChoices ?? []).map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    onClick={() => {
                      setShellMenuOpen(false);
                      void open(shell.id);
                    }}
                    className="pressable flex flex-col gap-0.5 rounded-chip px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="text-ui-caption text-ink">{shell.name}</span>
                    <span className="truncate font-mono text-ui-xs text-ink-3">
                      {shell.args.length ? `${shell.path} ${shell.args.join(" ")}` : shell.path}
                    </span>
                  </button>
                ))}
                {!shellChoices ? (
                  <span className="px-2 py-2 text-ui-sm text-ink-3">{t("Detecting shells…")}</span>
                ) : null}
                {shellChoices && !shellChoices.length ? (
                  <span className="px-2 py-2 text-ui-sm text-ink-3">{t("No shell was found on PATH.")}</span>
                ) : null}
              </div>
            </Popover>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded-chip bg-field p-0.5">
          <button
            type="button"
            onClick={() => setMode("terminal")}
            aria-label={t("Terminal")}
            title={t("Terminal — a real shell in this folder")}
            className={cn(
              "pressable flex size-5 items-center justify-center rounded-chip",
              mode === "terminal" ? "bg-surface text-ink shadow-hairline" : "text-ink-3 hover:text-ink",
            )}
          >
            <TerminalIcon size={11} />
          </button>
          <button
            type="button"
            onClick={() => setMode("agent")}
            aria-label={t("Agent shell")}
            title={t("Agent shell — output is recorded in the conversation")}
            className={cn(
              "pressable flex size-5 items-center justify-center rounded-chip",
              mode === "agent" ? "bg-surface text-ink shadow-hairline" : "text-ink-3 hover:text-ink",
            )}
          >
            <SparkIcon size={11} />
          </button>
        </div>
      </div>

      {mode === "agent" ? (
        <AgentShell cwd={cwd} />
      ) : error ? (
        <div className="m-3 rounded-card bg-red-tint px-3 py-2.5 text-ui-sm leading-relaxed text-red">
          {tf("No shell could start: {error}", { error })}
        </div>
      ) : active ? (
        <PtyTerminal key={active.id} id={active.id} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-ui-caption text-ink-3">{t("No terminal in this folder.")}</p>
          <button
            type="button"
            onClick={() => void open()}
            className="pressable inline-flex h-7 items-center gap-1.5 rounded-chip bg-field px-2.5 text-ui-sm text-ink-2 hover:bg-hover-2"
          >
            <PlusIcon size={11} />
            {t("New terminal")}
          </button>
        </div>
      )}

      {mode === "terminal" && active ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-ink-3" title={active.cwd}>
            {active.cwd}
          </span>
          {active.status === "running" ? (
            <button
              type="button"
              onClick={() => close(active.id)}
              className="pressable inline-flex h-6 items-center gap-1.5 rounded-chip px-2 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              <SquareStopIcon size={9} />
              {t("Kill")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void open()}
              className="pressable inline-flex h-6 items-center rounded-chip px-2 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              {t("Restart")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
