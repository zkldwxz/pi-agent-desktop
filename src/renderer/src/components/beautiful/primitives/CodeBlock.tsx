"use client";

import { useCallback, useMemo, useState } from "react";
import { highlightCode, highlightLines, languageFromFilename } from "../../../lib/highlight";
import { t } from "../../../lib/i18n";
import { cn } from "../../../lib/cn";

/* ─────────────────────────────────────────────────────────
 * CODE BLOCK
 * A light editor panel with two versions (switch in the card):
 *   · Code — a line-numbered listing
 *   · Diff — a unified diff: one gutter of line numbers, a green/red
 *     accent bar and row tint, and only the words that actually changed
 *     carrying a wash of their own.
 *
 * Colouring is highlight.js with GitHub's own light and dark themes (see
 * `lib/highlight.ts`); the hand-rolled keyword regex that used to live here
 * coloured a keyword only when a space followed it and missed comments,
 * strings with escapes, and every language that is not JavaScript.
 *
 * WIDTH: the card fills its parent. It used to cap itself at 105 spacing units
 * (~370px), which made every listing narrower than the prose it sat between —
 * the block now reaches exactly as far as the text does.
 * ───────────────────────────────────────────────────────── */

const FILE = "churn.ts";

const CODE_LINES = [
  "export async function churnBatch() {",
  '  const flavor = await getFlavor("pistachio");',
  "  const base = await dairy.fetch({ flavor });",
  '  await freezer.store(base, { temp: "-16C" });',
  "  if (!base.approved) return null;",
  "  return base.gallons;",
  "}",
];

/* A single run of code within a diff row; `change` tints it as an add/del. */
export type CodePiece = { text: string; change?: "add" | "del" };
/* One row of a unified diff: old/new line numbers, its kind, and its pieces. */
export type DiffRow = {
  old: number | null;
  cur: number | null;
  type: "ctx" | "add" | "del";
  pieces: CodePiece[];
};
/* Prominent copy strings on the code block. */
export type CodeBlockLabels = { copy: string; copied: string };

const HATCH = "repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)";

/* Every row is its own grid, so the gutter is a fixed width — `auto` would let
 * each row size to its own number and leave the code column ragged — and the
 * hairline that separates it is drawn on that same edge. */
const GUTTER = "grid-cols-[34px_minmax(0,1fr)]";
const GUTTER_EDGE = "left-[34px]";

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" };

export type CodeBlockProps = {
  /** Which view to render — "Code" (line-numbered listing) or "Diff". */
  variant?: string;
  /** The lines shown in the Code view. */
  lines?: string[];
  /** Raw text placed on the clipboard by Copy. Defaults to `lines` joined. */
  code?: string;
  /** The unified-diff rows shown in the Diff view. */
  diff?: DiffRow[];
  /** Filename shown in the header, and the hint for which grammar to use. */
  filename?: string;
  /** Overrides the language inferred from `filename`. */
  language?: string;
  /** Prominent copy strings. */
  labels?: Partial<CodeBlockLabels>;
  /** Called with the copied text after a successful copy. */
  onCopy?: (text: string) => void;
  /** HOST ADDITION: the currently quoted line range, tinted per row. */
  quoted?: { start: number; end: number } | null;
  /** HOST ADDITION: clicking a line number starts or extends a quote. */
  onLineClick?: (line: number) => void;
  /** HOST ADDITION: with a diff in hand, asking for this puts a Code | Diff switch in the header. */
  onVariantChange?: (variant: "Code" | "Diff") => void;
};

export default function CodeBlock({
  variant = "Code",
  lines = CODE_LINES,
  code,
  diff = [],
  filename = FILE,
  language,
  labels,
  onCopy,
  quoted,
  onLineClick,
  onVariantChange,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDiff = variant === "Diff";
  const text = { ...DEFAULT_LABELS, ...labels };
  const raw = code ?? lines.join("\n");
  const lang = language ?? languageFromFilename(filename);
  /* both views have to be available for a switch to mean anything */
  const switchable = Boolean(onVariantChange) && diff.length > 0;

  /* One highlight pass for the whole snippet, then split — highlighting line by
     line would break any token that spans a newline. `null` means "no grammar",
     and the raw text renders uncoloured. */
  const codeLines = useMemo(() => (isDiff ? null : highlightLines(raw, lang)), [isDiff, raw, lang]);

  /* Each run of a diff row is highlighted on its own: a changed run carries a
     tint of its own, and a tint can only wrap a run, never part of a span. */
  const diffRows = useMemo(() => {
    if (!isDiff) return null;
    return diff.map((row) => {
      const hunk = row.type === "ctx" && (row.pieces[0]?.text ?? "").startsWith("@@");
      return { row, hunk, html: hunk ? [] : row.pieces.map((piece) => highlightCode(piece.text, lang)) };
    });
  }, [isDiff, diff, lang]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      onCopy?.(raw);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [raw, onCopy]);

  const added = diff.filter((r) => r.type === "add").length;
  const removed = diff.filter((r) => r.type === "del").length;

  return (
    <div className="w-full overflow-hidden rounded-card bg-surface shadow-card">
      {/* header — file · (diff stat | copy) · view switch */}
      <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-ui-caption">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <FileIcon />
          <span className="truncate font-mono leading-none text-ink">{filename}</span>
        </span>

        <span className="ml-auto inline-flex shrink-0 items-center gap-2">
          {isDiff ? (
            <span className="inline-flex items-center gap-2 font-mono text-ui-caption leading-none tabular-nums">
              <span className="text-green">+{added}</span>
              <span className="text-red">-{removed}</span>
            </span>
          ) : (
            <button
              type="button"
              aria-label={t("Copy code")}
              onClick={copy}
              className={`-mr-1 flex h-6 items-center gap-1 rounded-chip px-1.5 text-ui-caption
                font-medium transition-colors duration-100 hover:bg-hover
                ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              )}
              {copied ? t(text.copied) : t(text.copy)}
            </button>
          )}

          {switchable ? (
            <span role="tablist" aria-label={t("View")} className="inline-flex items-center rounded-chip bg-field p-0.5">
              {(["Code", "Diff"] as const).map((option) => {
                const active = (option === "Diff") === isDiff;
                return (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onVariantChange?.(option)}
                    className={cn(
                      "rounded-chip px-2 py-[3px] text-ui-sm font-medium transition-colors duration-100",
                      active ? "bg-surface text-ink shadow-hairline" : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {t(option)}
                  </button>
                );
              })}
            </span>
          ) : null}
        </span>
      </div>

      {/* body — equal inset on top / left / right; lines wrap */}
      <div className="hljs py-3 font-mono text-ui-caption leading-[1.65]">
        {isDiff ? (
          <div className="relative">
            <span className={cn("pointer-events-none absolute inset-y-0 w-px bg-line", GUTTER_EDGE)} />
            {(diffRows ?? []).map(({ row, hunk, html }, i) => {
              const add = row.type === "add";
              const del = row.type === "del";
              const num = del ? row.old : row.cur;

              /* a hunk header is a page break, not a line of code: no number, no
                 tint, and it stays in the muted grey the diff tools use */
              if (hunk) {
                return (
                  <div key={i} className={cn("grid items-start pt-2 pb-0.5 first:pt-0", GUTTER)}>
                    <span />
                    <code className="min-w-0 truncate pr-3 pl-1 text-ui-sm text-ink-3">
                      {row.pieces.map((piece) => piece.text).join("")}
                    </code>
                  </div>
                );
              }

              return (
                <div
                  key={i}
                  className={cn("relative grid items-start", GUTTER, add ? "bg-green-tint" : del ? "bg-red-tint" : "")}
                >
                  {(add || del) && (
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: add ? "var(--green)" : HATCH }} />
                  )}
                  <span className={cn("select-none pr-2 text-right text-ui-sm tabular-nums", add ? "text-green" : del ? "text-red" : "text-ink-3")}>
                    {num ?? ""}
                  </span>
                  <code className="pr-3 pl-1 break-words whitespace-pre-wrap">
                    {row.pieces.map((piece, j) => {
                      const run = html[j];
                      const changed = piece.change === "add" || piece.change === "del";
                      return (
                        <span
                          key={j}
                          className={changed ? "rounded-tiny" : undefined}
                          style={
                            changed
                              ? {
                                  background: `color-mix(in srgb, var(--${piece.change === "add" ? "green" : "red"}) 18%, transparent)`,
                                  padding: "0 2px",
                                  margin: "0 -1px",
                                  boxDecorationBreak: "clone",
                                  WebkitBoxDecorationBreak: "clone",
                                }
                              : undefined
                          }
                        >
                          {run ? (
                            // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                            <span dangerouslySetInnerHTML={{ __html: run }} />
                          ) : (
                            piece.text
                          )}
                        </span>
                      );
                    })}
                  </code>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="relative">
            <span className={cn("pointer-events-none absolute inset-y-0 w-px bg-line", GUTTER_EDGE)} />
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const inQuote = quoted ? lineNo >= quoted.start && lineNo <= quoted.end : false;
              return (
                <div
                  key={i}
                  onClick={onLineClick ? () => onLineClick(lineNo) : undefined}
                  className={cn("grid items-start", GUTTER, onLineClick && "cursor-pointer", inQuote && "bg-accent-tint")}
                >
                  <span
                    className={cn(
                      "select-none pr-2 text-right text-ui-sm tabular-nums",
                      inQuote ? "font-medium text-accent-ink" : "text-ink-3",
                    )}
                  >
                    {lineNo}
                  </span>
                  {codeLines ? (
                    // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                    <code className="pr-3 pl-1 break-words whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: codeLines[i] ?? "" }} />
                  ) : (
                    <code className="pr-3 pl-1 break-words whitespace-pre-wrap">{line}</code>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
