"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { McpResultSection, McpTextBlock } from "@shared/mcp-tool";
import { highlightCode, highlightLines, languageFromFilename } from "../../../lib/highlight";
import { t, tf } from "../../../lib/i18n";

/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS
 * An agent run as compact rows: tool calls with inline
 * chips, then file-diff chips summarizing the edits.
 * Hover a row to reveal its chevron; every row expands
 * to show what the tool actually did.
 * ───────────────────────────────────────────────────────── */

const STEP_MS = 700;

const Icons: Record<string, React.ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  /* an MCP call is not a terminal: it reaches a server, so it gets the plug. */
  mcp: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 8V3m6 5V3m3 5v4a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8Z" /><path d="M12 17v4" /></g>,
};

export type ToolDetailLine = { text: string; tone?: "add" | "del" };

/**
 * The structured second layer for a call whose result is more than a few lines.
 *
 * Rows with `pane` render it inside the same expanded boundary as `detail` —
 * one scroll region per row, never a card inside a card. Sections arrive already
 * bounded and parsed (`@shared/mcp-tool`); the pane only draws them.
 */
export type ToolRowPane = {
  sections: McpResultSection[];
  /** the call's arguments as pretty JSON */
  args?: McpTextBlock;
  /** pi saved the full text of a truncated result here */
  fullOutputPath?: string;
};

export type ToolStep = {
  /** stable identity — several calls can share a label */
  id?: string;
  icon: string;
  label: string;
  chip: string;
  mono: boolean;
  detailMono: boolean;
  detail: ToolDetailLine[];
  /** the call's own state. Without it a running call inside an open group is
   *  indistinguishable from a finished one until you read its detail text. */
  status?: "running" | "done" | "error";
  /** structured second layer — see {@link ToolRowPane} */
  pane?: ToolRowPane;
  /** the unformatted call name, kept as the row's native tooltip */
  title?: string;
};

export type ToolDiff = { file: string; add: number; del: number };

export type ToolDiffLine = { text: string; tone: "add" | "del" | "ctx" };

export type ToolChipsLabels = {
  /** accepts nodes: the host composes counts and coloured +/− totals here */
  header: React.ReactNode;
  /** the trailing "+2 more" affordance; empty hides it */
  more: string;
};

const DEFAULT_LABELS: ToolChipsLabels = {
  header: "4 tool calls, 2 messages",
  more: "+2 more",
};

/**
 * The structured second layer of one call.
 *
 * Everything here renders flat into the row's own scroll boundary: the result
 * sections, the arguments, and the pointer pi leaves when it truncated a long
 * output. There is deliberately no nested collapsible — a card that folds inside
 * a card that folds is where "expand the tool" turns into three clicks.
 */
function ToolRowPaneView({ pane, rowKey }: { pane: ToolRowPane; rowKey: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  /* A copy button that copies: the clipboard is the one the rest of the shell
     already writes to, and the label flips only after the write resolves. */
  const copy = (key: string, text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
      })
      .catch(() => undefined);
  };

  const copyButton = (key: string, text: string) => (
    <button
      type="button"
      aria-label={t("Copy")}
      title={t("Copy")}
      onClick={() => copy(key, text)}
      className={`-mr-0.5 flex h-5 shrink-0 items-center gap-1 rounded-chip px-1.5 text-ui-xs font-medium transition-colors duration-100 hover:bg-hover ${
        copied === key ? "text-green" : "text-ink-3 hover:text-ink"
      }`}
    >
      {copied === key ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
      {copied === key ? t("Copied") : t("Copy")}
    </button>
  );

  const moreLine = (count: number) => (
    <span className="pt-1 text-ui-xs text-ink-3">{tf("… {count} more lines", { count })}</span>
  );

  return (
    <>
      {pane.sections.map((section, index) => {
        const key = `${rowKey}-s${index}`;
        if (section.kind === "error") {
          return (
            <div key={key} className="flex min-w-0 flex-col">
              {section.lines.length ? (
                <pre className="m-0 max-w-full rounded-control bg-red-tint px-2 py-1.5 font-mono text-ui-sm leading-[1.6] whitespace-pre-wrap break-words text-red">
                  {section.lines.join("\n")}
                </pre>
              ) : (
                <span className="text-ui-sm text-red">{t("failed")}</span>
              )}
              {section.more > 0 ? moreLine(section.more) : null}
            </div>
          );
        }

        if (section.kind === "json" || section.kind === "text") {
          /* JSON gets the grammar; the lines are already the bounded slice, so
             the highlight pass never sees the whole 20KB result. */
          const html = section.kind === "json" ? highlightLines(section.lines.join("\n"), "json") : null;
          return (
            <div key={key} className="flex min-w-0 flex-col">
              <div className="flex h-5 items-center justify-between gap-2">
                <span className="truncate text-ui-xs text-ink-3">{section.kind === "json" ? t("JSON") : t("Text")}</span>
                {copyButton(key, section.text)}
              </div>
              <div className="min-w-0 rounded-control bg-field px-2 py-1.5 font-mono text-ui-sm leading-[1.6] text-ink-2">
                {section.lines.map((line, lineIndex) => (
                  <div key={lineIndex} className="whitespace-pre-wrap break-words">
                    {html ? (
                      // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                      <span dangerouslySetInnerHTML={{ __html: html[lineIndex] ?? "" }} />
                    ) : (
                      line || " "
                    )}
                  </div>
                ))}
                {section.more > 0 ? moreLine(section.more) : null}
              </div>
            </div>
          );
        }

        if (section.kind === "image") {
          /* bounded by height: a screenshot in a tool row must not push the
             answer off screen */
          return (
            <img
              key={key}
              src={section.src}
              alt={t("Image")}
              className="max-h-56 max-w-full self-start rounded-control bg-field"
            />
          );
        }

        if (section.kind === "resource") {
          return (
            <div key={key} className="flex min-w-0 flex-col gap-0.5 rounded-control bg-field px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-ui-sm text-ink-2" title={section.uri}>
                  {section.label}
                </span>
                {section.mimeType ? (
                  <span className="shrink-0 font-mono text-ui-xs text-ink-3">{section.mimeType}</span>
                ) : null}
              </div>
              <span className="truncate font-mono text-ui-xs text-ink-3">{section.uri}</span>
              {section.description ? <span className="text-ui-xs text-ink-3">{section.description}</span> : null}
              {section.text ? (
                <pre className="m-0 mt-1 max-w-full font-mono text-ui-xs leading-[1.6] whitespace-pre-wrap break-words text-ink-2">
                  {section.text}
                </pre>
              ) : null}
            </div>
          );
        }

        return section.text ? (
          <span key={key} className="truncate font-mono text-ui-xs text-ink-3" title={section.text}>
            {section.text}
          </span>
        ) : null;
      })}

      {pane.fullOutputPath ? (
        <span className="truncate font-mono text-ui-xs text-ink-3" title={pane.fullOutputPath}>
          {tf("Full output: {path}", { path: pane.fullOutputPath })}
        </span>
      ) : null}

      {pane.args ? (
        <div className="flex min-w-0 flex-col">
          <div className="flex h-5 items-center justify-between gap-2">
            <span className="truncate text-ui-xs text-ink-3">{t("Arguments")}</span>
            {copyButton(`${rowKey}-args`, pane.args.text)}
          </div>
          <div className="min-w-0 rounded-control bg-field px-2 py-1.5 font-mono text-ui-sm leading-[1.6] text-ink-2">
            {pane.args.lines.map((line, lineIndex) => (
              <div key={lineIndex} className="whitespace-pre-wrap break-words">
                {line || " "}
              </div>
            ))}
            {pane.args.more > 0 ? moreLine(pane.args.more) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

const ROWS: ToolStep[] = [
  {
    icon: "think", label: "Thinking", chip: "Planning the churn schedule…", mono: false, detailMono: false,
    detail: [
      { text: "Weekend demand carries pistachio, so it churns first." },
      { text: "Batch capacity leaves two evening freezer windows." },
    ],
  },
  {
    icon: "write", label: "Write 204 lines", chip: "ChurnSchedule.tsx", mono: true, detailMono: true,
    detail: [
      { text: "+ const windows = slots.filter((s) => s.temp <= -12)", tone: "add" },
      { text: "+ return schedule(windows, { hero: \"pistachio\" })", tone: "add" },
    ],
  },
  {
    icon: "run", label: "Rebuild and verify", chip: "npm run freeze", mono: true, detailMono: true,
    detail: [
      { text: "✓ built in 1.2s" },
      { text: "✓ 34 checks passed" },
    ],
  },
  {
    icon: "read", label: "Read image", chip: "flavor-chart.png", mono: true, detailMono: false,
    detail: [
      { text: "1280 × 720 · line chart, three summers." },
      { text: "Mint chip trends up 12% through July." },
    ],
  },
];

const DIFFS: ToolDiff[] = [
  { file: "flavors.css", add: 13, del: 0 },
  { file: "ChurnSchedule.tsx", add: 74, del: 41 },
  { file: "menu.ts", add: 8, del: 2 },
];

/* hovering a file chip opens its diff — green added, red removed */
const DIFF_LINES: Record<string, ToolDiffLine[]> = {
  "flavors.css": [
    { text: ".scoop-card {", tone: "ctx" },
    { text: "  gap: 14px;", tone: "del" },
    { text: "  gap: 12px;", tone: "add" },
    { text: "  container-type: inline-size;", tone: "add" },
    { text: "}", tone: "ctx" },
  ],
  "ChurnSchedule.tsx": [
    { text: "const slots = coldSlots(week);", tone: "ctx" },
    { text: "const windows = slots;", tone: "del" },
    { text: "const windows = slots.filter(", tone: "add" },
    { text: "  (s) => s.temp <= -12,", tone: "add" },
    { text: ");", tone: "add" },
  ],
  "menu.ts": [
    { text: "export const hero = \"mint-chip\";", tone: "del" },
    { text: "export const hero = \"pistachio\";", tone: "add" },
  ],
};

export default function ToolChips({
  steps = ROWS,
  diffs = DIFFS,
  diffLines = DIFF_LINES,
  labels,
  className,
  onOpenChange,
  onToggleRow,
  instant,
  defaultOpen = true,
}: {
  /** Accepted for gallery/registry parity; ToolChips has no visual variants. */
  variant?: string;
  steps?: ToolStep[];
  diffs?: ToolDiff[];
  diffLines?: Record<string, ToolDiffLine[]>;
  labels?: Partial<ToolChipsLabels>;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  onToggleRow?: (label: string, open: boolean) => void;
  /** host override: show every tool row at once instead of replaying the demo timeline */
  instant?: boolean;
  /** host override: whether the run starts collapsed. Hosts group tool calls and
   *  want finished groups shut, with only the live one open. */
  defaultOpen?: boolean;
} = {}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const [step, setStep] = useState(0);
  /* a click is a decision and sticks; until then the run follows the host, so a
   * group that was open while running collapses itself when it settles */
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? defaultOpen;
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  /* A row that was opened once keeps its structured pane mounted. Unmounting it
   * with the close would drop the 1fr content before the grid transition ran,
   * collapsing the row instantly instead of animating it; re-parsing and
   * re-mounting the pane on every toggle is also the churn this avoids. Rows
   * the user never opened never mount one. */
  const [drawnRows, setDrawnRows] = useState<Set<string>>(new Set());
  /* Rendered in a body portal so animated/translated reply wrappers cannot
   * redefine the fixed-position coordinate system. */
  const [preview, setPreview] = useState<{
    file: string;
    x: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const openPreview = (file: string) => (event: React.SyntheticEvent) => {
    const rect = (event.currentTarget as Element).closest("[data-diffchip]")!.getBoundingClientRect();
    const previewHeight = 38 + (diffLines[file]?.length ?? 0) * 19;
    const fitsBelow = rect.bottom + 6 + previewHeight <= window.innerHeight - 12;
    setPreview({
      file,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      ...(fitsBelow
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    });
  };
  const closePreview = (file: string) => () =>
    setPreview((current) => (current?.file === file ? null : current));
  const total = steps.length + 1; // rows, then diff chips

  useEffect(() => {
    if (instant || step >= total) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step, total, instant]);

  const toggleRow = (label: string) => {
    /* read from the rendered state, not from inside an updater: two updaters
       would each run twice under StrictMode, and the pane's mount is derived
       from this same decision */
    const opening = !openRows.has(label);
    setOpenRows((current) => {
      const next = new Set(current);
      opening ? next.add(label) : next.delete(label);
      return next;
    });
    if (opening) setDrawnRows((drawn) => (drawn.has(label) ? drawn : new Set(drawn).add(label)));
    onToggleRow?.(label, opening);
  };

  return (
    <div className={`w-full${className ? ` ${className}` : ""}`}>
      {/* collapsed run header.
          ALIGNMENT (host adaptation): `ThinkingState` renders directly above this
          block, so the two headers share one left edge — a 16px glyph box at the
          column origin with a 7px gap puts both labels on the same x. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setManualOpen(next);
          onOpenChange?.(next);
        }}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 text-ui-base text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
        <span className="tabular-nums">{copy.header}</span>
      </button>
      {/* tool call rows — indented into the same tree as the trace rows above:
          5px + 14px gutter, then 5.25px of row padding, so the labels line up. */}
      <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
        <div className="overflow-hidden">
        <div className="ml-[5px] pl-4 pb-1">
        <div className="mt-1.5 flex flex-col gap-1">
          {steps.slice(0, instant ? steps.length : step).map((row) => {
            const rowKey = row.id ?? row.label;
            const rowOpen = openRows.has(rowKey);
            /* a call with nothing to show is not a disclosure. Without this the
               row still offered a chevron and opened onto an empty rule — the
               shell of a detail pane with no detail in it. A structured pane
               counts as something to show even when it has no text lines. */
            const hasPane = Boolean(row.pane && (row.pane.sections.length > 0 || row.pane.args || row.pane.fullOutputPath));
            const hasDetail = row.detail.length > 0 || hasPane;
            return (
            <div key={rowKey} style={{ animation: "fade-up 300ms var(--ease-out-strong-css) both" }}>
              <button
                type="button"
                aria-expanded={hasDetail ? rowOpen : undefined}
                title={row.title}
                onClick={() => {
                  if (hasDetail) toggleRow(rowKey);
                }}
                className="group/row flex h-7 w-full min-w-0 items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-100 hover:bg-hover-2"
              >
                <span className="relative flex size-3.5 shrink-0 items-center justify-center text-ink-3">
                  <svg
                    width="13" height="13" viewBox="0 0 24 24" fill={row.icon === "think" ? "currentColor" : "none"} stroke="currentColor"
                    className={`transition-opacity duration-100 group-hover/row:opacity-0 ${rowOpen ? "opacity-0" : ""} ${row.status === "running" ? "opacity-0" : ""}`}
                  >
                    {Icons[row.icon]}
                  </svg>
                  {/* running: an arc in the tool icon's place. It yields to the
                      chevron on hover like the icon does, so the affordance to
                      open the row is never hidden behind a spinner. */}
                  {row.status === "running" && (
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                      className="spin-fast absolute group-hover/row:opacity-0"
                    >
                      <path d="M12 3a9 9 0 1 0 9 9" />
                    </svg>
                  )}
                  {/* the settle beat: the arc has just become a check, the check
                      holds, then fades to leave the tool icon it was covering.
                      One-shot and CSS-only — a timer per row is how a long run
                      ends up with a hundred pending timeouts. */}
                  {row.status === "done" && (
                    <svg
                      key="settle"
                      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                      className="step-settle pointer-events-none absolute"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {row.status === "error" && (
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                      className="absolute text-red"
                    >
                      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                    </svg>
                  )}
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    className={`absolute transition-[opacity,transform] duration-150 ${hasDetail ? "group-hover/row:opacity-100" : "hidden"} ${rowOpen ? "opacity-100" : "opacity-0"}`}
                    style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
                {/* A fixed label column keeps every chip on the same x, so a
                    column of Read/Terminal rows scans like a table instead of
                    jagging with each label's length. */}
                <span className="w-28 shrink-0 truncate text-ui-caption font-medium text-ink">{row.label}</span>
                <span
                  className={`relative inline-flex h-5.5 min-w-0 max-w-[420px] flex-1 cursor-pointer items-center truncate rounded-chip bg-field px-1.5
                    text-ui-sm text-ink-2 shadow-hairline transition-colors duration-100 hover:bg-hover-2
                    ${row.mono ? "font-mono" : ""} ${row.status === "running" ? "chip-sweep" : ""}`}
                >
                  {row.chip}
                </span>
              </button>

              {/* expanded detail — the rule sits just past the row icon and the
                  text lands on the row label's x, so detail reads as a child.
                  One scroll boundary per row: the structured pane and the plain
                  lines share it instead of each bringing their own. */}
              {hasDetail ? (
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0, transitionTimingFunction: "var(--ease-out-strong-css)" }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div
                    className={`scrollbar-thin mt-0.5 mb-1 ml-[18px] flex flex-col overflow-y-auto border-l border-line py-0.5 pl-[7px] ${
                      hasPane ? "max-h-[440px] gap-2" : "max-h-[320px] gap-0.5"
                    }`}
                  >
                    {/* the pane mounts when the row is first opened and stays
                        mounted after that — see `drawnRows` */}
                    {row.pane && (rowOpen || drawnRows.has(rowKey)) ? (
                      <ToolRowPaneView pane={row.pane} rowKey={rowKey} />
                    ) : null}
                    {row.detail.map((line, lineIndex) => (
                      <span
                        key={`${rowKey}-d${lineIndex}`}
                        className={`truncate text-ui-sm leading-[1.6] ${row.detailMono ? "font-mono" : ""} ${
                          line.tone === "add" ? "text-green" : line.tone === "del" ? "text-red" : "text-ink-2"
                        }`}
                      >
                        {line.text}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              ) : null}
            </div>
            );
          })}
        </div>

      {/* file-diff chips — same left edge as the rows above them. A host group
          that touched no file renders no strip at all. */}
      {(instant || step >= total) && (diffs.length > 0 || copy.more) && (
        <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-line px-1.5 pt-2.5">
          {diffs.map((d, i) => (
            <span
              key={d.file}
              data-diffchip
              className="relative"
              onMouseEnter={openPreview(d.file)}
              onMouseLeave={closePreview(d.file)}
            >
              <button
                type="button"
                aria-expanded={preview?.file === d.file}
                aria-label={`Show diff for ${d.file}`}
                onFocus={openPreview(d.file)}
                onBlur={closePreview(d.file)}
                className="inline-flex h-7 max-w-full items-center gap-2 rounded-chip
                  bg-surface px-2 font-mono text-ui-sm text-ink shadow-btn
                  transition-colors duration-100 hover:bg-hover"
                style={{ animation: `pop-in 250ms var(--ease-out-strong-css) ${i * 80}ms both` }}
              >
                <span className="min-w-0 truncate">{d.file}</span>
                <span className="shrink-0 text-green tabular-nums">+{d.add}</span>
                {d.del > 0 && <span className="shrink-0 text-red tabular-nums">−{d.del}</span>}
              </button>

            </span>
          ))}
          {copy.more ? (
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-chip px-1.5 font-mono text-ui-sm text-ink-3
                underline decoration-transparent underline-offset-2 transition-colors duration-100
                hover:text-ink-2 hover:decoration-current"
              style={{ animation: `fade-in 300ms ease-out ${diffs.length * 80}ms both` }}
            >
              {copy.more}
            </button>
          ) : null}
        </div>
      )}
        </div>
        </div>
      </div>
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 w-72 overflow-hidden rounded-card bg-surface shadow-overlay"
          style={{
            left: preview.x,
            top: preview.top,
            bottom: preview.bottom,
            animation: "pop-in 160ms var(--ease-out-strong-css) both",
            transformOrigin: preview.top === undefined ? "bottom left" : "top left",
          }}
        >
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5 font-mono text-ui-sm">
            <span className="min-w-0 truncate text-ink-2">{preview.file}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-green">+{diffs.find((diff) => diff.file === preview.file)?.add}</span>
              {(diffs.find((diff) => diff.file === preview.file)?.del ?? 0) > 0 && (
                <span className="text-red"> −{diffs.find((diff) => diff.file === preview.file)?.del}</span>
              )}
            </span>
          </div>
          {/* the preview is a code change, so it is coloured as code: the wash
              says which lines moved, the file's own grammar says what they are.
              Flat ink here left the green and red rows as the only colour on
              screen — a preview that never showed what the new line actually
              contains. */}
          <div className="hljs py-1 font-mono text-ui-sm leading-[1.8]">
            {(diffLines[preview.file] ?? []).map((line, index) => {
              const html = highlightCode(line.text, languageFromFilename(preview.file));
              return (
                <div
                  key={index}
                  className={`flex gap-2 px-2.5 whitespace-pre ${
                    line.tone === "add" ? "bg-green-tint" : line.tone === "del" ? "bg-red-tint" : ""
                  }`}
                >
                  <span className="w-3 shrink-0 select-none">{line.tone === "add" ? "+" : line.tone === "del" ? "−" : " "}</span>
                  <span
                    className="min-w-0 truncate"
                    {...(html
                      ? // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
                        { dangerouslySetInnerHTML: { __html: html } }
                      : { children: line.text })}
                  />
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
