import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppOpener, FileContent } from "@shared/workspace";
import CodeBlock from "../beautiful/primitives/CodeBlock";
import { ExplorerGlyph } from "./FolderOpener";
import { ChevronDownIcon, MessagePlusIcon, XIcon } from "../icons";
import { toDiffRows } from "../../lib/agent-view";
import { cn } from "../../lib/cn";
import { openerName, t, tf } from "../../lib/i18n";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** `src/renderer/src/App.tsx` → `src/renderer/src` */
function parentDir(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}

/**
 * "Open with" — the applications this machine has registered for the file.
 *
 * The list comes from the operating system (see `main/openers.ts`), so it holds
 * whatever the user actually has: the file manager, Cursor, VS Code, the default
 * handler. Nothing here is hard-coded, which is the only way the menu stays
 * correct on a machine we cannot see.
 */
function OpenWith({ path, onReveal }: { path: string; onReveal: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [openers, setOpeners] = useState<AppOpener[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.pi
      .listOpeners(path)
      .then((list) => {
        if (!cancelled) setOpeners(list);
      })
      .catch(() => {
        if (!cancelled) setOpeners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const launch = async (opener: AppOpener) => {
    setOpen(false);
    setError(null);
    if (opener.kind === "reveal") {
      onReveal(path);
      return;
    }
    const result = await window.pi.openWith(path, opener.id).catch(() => ({ ok: false, error: t("Launch failed.") }));
    if (!result.ok) setError(result.error ?? t("Could not open the file."));
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="pressable inline-flex h-6 items-center gap-1 rounded-chip bg-field px-2 text-[11.5px] text-ink-2 hover:bg-hover-2"
      >
        {t("Open with")}
        <ChevronDownIcon size={11} className="text-ink-3" />
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-[10px] bg-surface py-1 shadow-overlay"
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "top right" }}
        >
          {openers === null ? (
            <div className="px-2.5 py-2 text-[11.5px] text-ink-3">{t("Looking up registered apps…")}</div>
          ) : (
            openers.map((opener) => (
              <button
                key={opener.id}
                type="button"
                title={opener.command ?? openerName(opener)}
                onClick={() => void launch(opener)}
                className="pressable flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-hover"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {opener.icon ? (
                    <img src={opener.icon} alt="" className="size-4 rounded-[3px]" />
                  ) : opener.kind === "reveal" ? (
                    <ExplorerGlyph size={15} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-line-strong" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{openerName(opener)}</span>
                {opener.kind === "default" ? (
                  <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{t("default")}</span>
                ) : null}
              </button>
            ))
          )}
          {error ? <div className="border-t border-line px-2.5 py-1.5 text-[10.5px] text-red">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Code viewer.
 *
 * Reading is capped in the main process, so a huge file arrives truncated
 * rather than hanging the window. The listing itself is `CodeBlock`, which
 * gives line numbers, the light syntax colouring and the copy action.
 */
export function FileViewer({
  path,
  diffLines,
  dockToggle,
  onClose,
  onReveal,
  /** drop a quote of the selected lines into the composer */
  onAddToChat,
}: {
  path: string;
  /** when the file was edited this session, its parsed diff is shown first */
  diffLines?: { text: string; tone: "add" | "del" | "ctx" }[];
  /** the right panel's trigger, positioned by the shell */
  dockToggle?: ReactNode;
  onClose: () => void;
  onReveal: (path: string) => void;
  onAddToChat?: (text: string) => void;
}) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const lines = useMemo(() => (file?.text ? file.text.replace(/\n$/, "").split("\n") : []), [file]);

  /* line quoting: the first click starts the range, the next click extends it
     to that line, a third click starts over. The bar under the header sends. */
  const [quote, setQuote] = useState<{ anchor: number; end: number } | null>(null);
  const quotedRange = useMemo(() => {
    if (!quote) return null;
    return { start: Math.min(quote.anchor, quote.end), end: Math.max(quote.anchor, quote.end) };
  }, [quote]);
  /* which reading of the file the card shows: a file that was edited this
     session opens on its diff, because that is what the reader came for */
  const [view, setView] = useState<"Code" | "Diff">(diffLines?.length ? "Diff" : "Code");
  const onLineClick = (line: number) =>
    setQuote((current) => {
      /* a one-line selection is still "start"; the next click extends it */
      if (!current || current.anchor !== current.end) return { anchor: line, end: line };
      return { ...current, end: line };
    });
  const quotedCode = useMemo(
    () => (quotedRange ? lines.slice(quotedRange.start - 1, quotedRange.end).join("\n") : ""),
    [quotedRange, lines],
  );
  const addQuoteToChat = () => {
    if (!quotedRange || !onAddToChat) return;
    const name = file?.name ?? path.split(/[\\/]/).pop() ?? path;
    const range =
      quotedRange.start === quotedRange.end
        ? `:${quotedRange.start}`
        : `:${quotedRange.start}-${quotedRange.end}`;
    /* the line contents ride along on the clipboard, so the agent can read
       them even when the file has since changed */
    void navigator.clipboard?.writeText(quotedCode).catch(() => undefined);
    onAddToChat(`@${name}${range}`);
    setQuote(null);
  };
  /* a new file clears any half-finished quote and picks its opening view */
  useEffect(() => {
    setQuote(null);
    setView(diffLines?.length ? "Diff" : "Code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.pi.readFile(path).then((content) => {
      if (cancelled) return;
      setFile(content);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line px-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px] font-medium text-ink">{file?.name ?? path}</div>
          <div className="truncate font-mono text-[10px] text-ink-3">{parentDir(path)}</div>
        </div>
        <span className="flex-1" />
        {file && !file.binary ? (
          <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">
            {tf("{count} lines · {size}", { count: lines.length, size: formatSize(file.size) })}
          </span>
        ) : null}
        <OpenWith path={path} onReveal={onReveal} />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close file")}
          className="pressable flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <XIcon size={13} />
        </button>
        {dockToggle}
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="h-4 rounded-[4px] bg-hover-2"
                style={{ width: `${40 + ((index * 17) % 55)}%`, animation: `fade-in 300ms ease-out ${index * 25}ms both` }}
              />
            ))}
          </div>
        ) : file?.error ? (
          <div className="rounded-card bg-red-tint px-3 py-2 text-[12px] text-red">{file.error}</div>
        ) : file?.binary ? (
          <div className="rounded-card border border-dashed border-line-strong px-4 py-8 text-center text-[12px] text-ink-3">
            {tf("Binary file — {size}. Nothing to display.", { size: formatSize(file.size) })}
          </div>
        ) : (
          <div className="flex max-w-[980px] flex-col gap-4">
            {/* One card carries both readings of the file — the diff is what
                changed, the listing is where it changed — and the switch in its
                header moves between them. They used to be two stacked cards,
                which said the same thing twice and left the diff with no way
                back to the file it belonged to. */}
            {diffLines?.length ? null : (
              <div className="rounded-card border border-dashed border-line-strong px-3 py-2 text-[11.5px] text-ink-3">
                {t("No diff was recorded for this file — it may have been written before this session, or by another tool.")}
              </div>
            )}
            <CodeBlock
              variant={view}
              lines={lines}
              code={file?.text ?? ""}
              diff={diffLines?.length ? toDiffRows(diffLines) : []}
              filename={file?.name ?? path}
              quoted={view === "Code" ? quotedRange : null}
              onLineClick={view === "Code" && onAddToChat && !file?.binary ? onLineClick : undefined}
              onVariantChange={setView}
            />
            {file?.truncated ? (
              <div className="text-[11.5px] text-orange">
                {tf("Showing the first 512 KB — the file is {size}.", { size: formatSize(file.size) })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* the quote bar: shows what is selected and hands it to the composer */}
      {quotedRange && onAddToChat ? (
        <div
          className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-2"
          style={{ animation: "fade-up 200ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          <MessagePlusIcon size={13} className="shrink-0 text-accent-ink" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
            {file?.name ?? path}:{quotedRange.start}
            {quotedRange.end !== quotedRange.start ? `-${quotedRange.end}` : ""} · {quotedRange.end - quotedRange.start + 1} {t("lines")}
          </span>
          <button
            type="button"
            onClick={addQuoteToChat}
            className="pressable flex h-6.5 shrink-0 items-center gap-1 rounded-chip bg-ink px-2.5 text-[11.5px] font-medium text-canvas"
          >
            {t("Add to chat")}
          </button>
          <button
            type="button"
            onClick={() => setQuote(null)}
            aria-label={t("Cancel")}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <XIcon size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
