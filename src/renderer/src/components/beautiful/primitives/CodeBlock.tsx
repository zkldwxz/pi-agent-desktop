"use client";

import { useCallback, useMemo, useState } from "react";
import { highlightCode } from "../../../lib/highlight";

/* ─────────────────────────────────────────────────────────
 * CODE BLOCK
 * A light editor panel with two versions (switch in the card):
 *   · Code — a line-numbered listing
 *   · Diff — a unified diff: old/new gutters, a green/red accent
 *     bar and row tint.
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

/**
 * Split highlighted HTML into per-line strings.
 *
 * `highlight.js` emits one HTML string for the whole snippet, and its spans can
 * cross a newline (a block comment, a template literal). Each visual line is
 * its own `<div>`, so a line has to be re-opened inside whatever spans are still
 * active — the browser closes them at the div boundary for us, which is exactly
 * the behaviour a line-per-row listing wants.
 */
function splitHighlightedLines(html: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];

  for (const line of html.split("\n")) {
    const openedAtStart = stack.join("");
    const tokens = line.match(/<span\b[^>]*>|<\/span>|[^<]+/g) ?? [];
    let body = "";

    for (const token of tokens) {
      if (token === "</span>") {
        stack.pop();
        body += token;
      } else if (token.startsWith("<span")) {
        stack.push(token);
        body += token;
      } else {
        body += token;
      }
    }

    out.push(openedAtStart + body);
  }

  return out;
}

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" };

/** `snippet.ts` → `ts`, so a diff can be coloured by the file it belongs to. */
function languageFromFilename(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

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
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDiff = variant === "Diff";
  const text = { ...DEFAULT_LABELS, ...labels };
  const raw = code ?? lines.join("\n");
  const lang = language ?? languageFromFilename(filename);

  /* One highlight pass for the whole snippet, then split — highlighting line by
     line would break any token that spans a newline. `null` means "no grammar",
     and the raw text renders uncoloured. */
  const codeLines = useMemo(() => {
    if (isDiff) return null;
    const html = highlightCode(raw, lang);
    return html ? splitHighlightedLines(html) : null;
  }, [isDiff, raw, lang]);

  /* Diff rows are coloured per line, from the file's own grammar. */
  const diffHtml = useMemo(() => {
    if (!isDiff) return null;
    return diff.map((row) => {
      const plain = row.pieces.map((piece) => piece.text).join("");
      return highlightCode(plain, lang);
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
      {/* header — file · (diff stat | copy) */}
      <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-[12.5px]">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <FileIcon />
          <span className="truncate font-mono leading-none text-ink">{filename}</span>
        </span>

        {isDiff ? (
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-[12px] leading-none tabular-nums">
            <span className="text-green">+{added}</span>
            <span className="text-red">-{removed}</span>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Copy code"
            onClick={copy}
            className={`-mr-1 ml-auto flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px]
              font-medium transition-colors duration-100 hover:bg-hover
              ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            {copied ? text.copied : text.copy}
          </button>
        )}
      </div>

      {/* body — equal inset on top / left / right; lines wrap */}
      <div className="hljs py-3 font-mono text-[12.5px] leading-[1.65]">
        {isDiff ? (
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
            {diff.map((r, i) => {
              const add = r.type === "add";
              const del = r.type === "del";
              // one gutter column: removals keep the old number, additions/context show the new one
              const num = del ? r.old : r.cur;
              const html = diffHtml?.[i] ?? null;
              return (
                <div
                  key={i}
                  className={`relative grid grid-cols-[20px_minmax(0,1fr)] items-start
                    ${add ? "bg-green-tint" : del ? "bg-red-tint" : ""}`}
                >
                  {(add || del) && (
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: add ? "var(--green)" : HATCH }} />
                  )}
                  <span className={`select-none text-center text-[11px] ${add ? "text-green" : del ? "text-red" : "text-ink-3"}`}>{num ?? ""}</span>
                  {html ? (
                    // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                    <code className="pr-3 pl-1 break-words whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: html }} />
                  ) : (
                    <code className="pr-3 pl-1 break-words whitespace-pre-wrap">
                      {r.pieces.map((piece, j) => (
                        <span key={j}>{piece.text}</span>
                      ))}
                    </code>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[20px_minmax(0,1fr)] items-start">
                <span className="select-none text-center text-[11px] text-ink-3">{i + 1}</span>
                {codeLines ? (
                  // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                  <code className="pr-3 pl-1 break-words whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: codeLines[i] ?? "" }} />
                ) : (
                  <code className="pr-3 pl-1 break-words whitespace-pre-wrap">{line}</code>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
