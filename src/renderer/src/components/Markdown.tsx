import { memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn";
import { highlightCode } from "../lib/highlight";
import { t } from "../lib/i18n";
import { CheckIcon, CopyIcon } from "./icons";

/* ─────────────────────────────────────────────────────────
 * MARKDOWN
 *
 * GFM is on, so tables, task lists, strikethrough, autolinks and footnotes all
 * parse. The overrides below are presentation only, and two of them are load
 * bearing:
 *
 *   · fenced code goes to a code block, so it gets the project's syntax colours
 *     instead of a second, worse code style
 *   · tables get the same hairline treatment as the rest of the UI, because the
 *     browser default is a borderless grid that reads as broken
 *
 * The list overrides are deliberately thin. `react-markdown` puts any nested
 * `<ul>` / `<ol>` *inside* the `li`'s children, so replacing the element's
 * children wholesale drops the nesting and the numbering — an ordered list came
 * out as bare dots with no numbers at all. `list-style` draws the markers
 * instead, which leaves the DOM exactly as the parser built it.
 *
 * TWO VARIANTS, because the same markdown is read in two very different
 * columns. The transcript is 600–900px wide and its prose *is* the interface,
 * so it runs at the interface's own type size — that is `variant="thread"`,
 * the default. A dock panel is a 300–360px tool column: the same metrics there
 * made a plan's `## Notes` heading out-rank the plan's own title in the panel
 * header and left a paragraph three lines of air. `variant="panel"` drops one
 * step on the type scale, tightens the block rhythm, and swaps the transcript's
 * line-numbered card for a bare fenced block — a 34px gutter plus a 44px
 * "snippet.ts" header is a third of that column, and the filename is a lie for
 * a fence in a document that has no file behind it.
 *
 * Not handled, because the parser does not do it: raw inline HTML (`<br>`, `<b>`)
 * arrives escaped, and `$math$` / definition lists are not GFM.
 * ───────────────────────────────────────────────────────── */

const REMARK = [remarkGfm];

/** `src/main/pi-host.ts`, `App.tsx`, `channel.ts:42` — a reference, not a value. */
const PATH_LIKE = /^[\w.@~-]*[\\/][\w.@\\/-]+\.[\w]+$|^[\w.@~-]+\.[\w]{1,10}(:\d+)?$/;

/** The fence's own text and language, pulled back out of the `pre`'s child. */
/**
 * A fenced block inside prose: a quiet tinted panel, no file header, no line
 * numbers — those belong to the file viewer, where code is the subject. Here it
 * is part of an answer (baocode's style). The language and copy sit in the
 * corner and show on hover.
 */
export function ChatCode({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const html = highlightCode(text, lang);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="group/code relative my-3 rounded-card bg-field/70">
      <pre className="hljs scrollbar-thin overflow-x-auto px-3.5 py-3 font-mono text-ui-caption leading-[1.65]">
        {html ? (
          // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{text}</code>
        )}
      </pre>
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-within:opacity-100">
        {lang ? <span className="px-1 font-mono text-ui-xs text-ink-4">{lang}</span> : null}
        <button
          type="button"
          onClick={copy}
          title={copied ? t("Copied") : t("Copy")}
          aria-label={t("Copy")}
          className="pressable flex size-6 items-center justify-center rounded-chip bg-surface text-ink-3 shadow-hairline hover:text-ink"
        >
          {copied ? <CheckIcon size={12} className="text-green" /> : <CopyIcon size={12} />}
        </button>
      </div>
    </div>
  );
}

function fenced(children: ReactNode): { lang: string; text: string } {
  const child = Array.isArray(children) ? children[0] : children;
  const props = (child as { props?: { className?: string; children?: unknown } })?.props;
  return {
    lang: /language-(\w+)/.exec(props?.className ?? "")?.[1] ?? "",
    text: String(props?.children ?? "").replace(/\n$/, ""),
  };
}

/* inline code only — fenced blocks arrive as `pre` and are handled below.
   File paths and symbols are rendered as blue references, the Cursor way. */
const InlineCode: NonNullable<Components["code"]> = ({ children, className }) => {
  const isBlock = Boolean(className?.includes("language-"));
  if (isBlock) return <code className={className}>{children}</code>;
  const text = String(children ?? "");
  return (
    <code
      className={cn(
        "rounded-tiny px-[3px] py-[1px] font-mono text-ui-sm",
        PATH_LIKE.test(text)
          ? "text-accent-ink hover:underline decoration-accent/40 underline-offset-2"
          : "bg-inset text-ink-2 shadow-hairline",
      )}
    >
      {children}
    </code>
  );
};

/**
 * The fenced block a narrow panel can afford.
 *
 * Same syntax colours as the transcript's `CodeBlock` (one highlighter, one
 * theme), without the card: no numbered gutter, no filename header, and the
 * copy action rides in the corner on hover instead of owning a 44px strip.
 * Lines wrap rather than scroll sideways — a horizontal scrollbar inside a
 * 300px column hides the code it exists to reveal, and this column already has
 * the one scrollbar it needs.
 */
function PanelCode({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const html = highlightCode(text, lang);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  };

  return (
    <div className="group/code relative my-2 overflow-hidden rounded-control bg-inset shadow-hairline">
      <pre className="hljs px-2.5 py-2 font-mono text-ui-sm leading-[1.6] break-words whitespace-pre-wrap">
        {html ? (
          // eslint-disable-next-line react/no-danger -- highlight.js escapes its input
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{text}</code>
        )}
      </pre>
      <button
        type="button"
        onClick={copy}
        title={t("Copy code")}
        aria-label={t("Copy code")}
        className={cn(
          "pressable absolute top-1 right-1 flex size-6 items-center justify-center rounded-chip bg-surface text-ink-3 shadow-hairline transition-opacity duration-100 hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100",
          copied
            ? "pointer-events-auto text-green opacity-100"
            : "pointer-events-none opacity-0 group-hover/code:pointer-events-auto group-hover/code:opacity-100",
        )}
      >
        {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
      </button>
    </div>
  );
}

/* ── the transcript ─────────────────────────────────────── */

const threadComponents: Components = {
  p: ({ children }) => <p className="my-2 text-ui-base leading-[21px] text-ink first:mt-0 last:mb-0">{children}</p>,

  h1: ({ children }) => <h3 className="mt-4 mb-2 text-ui-lg font-semibold tracking-[-0.01em] text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-ui-lg font-semibold tracking-[-0.01em] text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-ui-base font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-ui-base font-medium text-ink">{children}</h4>,
  /* h5 / h6 used to fall through to the browser default — dark grey, 0.83em,
     bold — which read as unstyled next to the mapped levels above. */
  h5: ({ children }) => <h5 className="mt-3 mb-1.5 text-ui-caption font-medium text-ink-2">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 mb-1.5 text-ui-caption font-medium tracking-[0.3px] text-ink-3">{children}</h6>,

  ul: ({ children, className }) => (
    <ul className={cn("my-2 flex flex-col gap-1 pl-[18px]", className)} style={{ listStyle: "disc" }}>
      {children}
    </ul>
  ),
  ol: ({ children, className, start }) => (
    <ol className={cn("my-2 flex flex-col gap-1 pl-[22px]", className)} style={{ listStyle: "decimal" }} start={start}>
      {children}
    </ol>
  ),
  li: ({ children, className, node: _node, ...rest }) => (
    // `className` carries "task-list-item" for GFM checkboxes; spreading `rest`
    // keeps the item's own attributes so nesting and `start` keep working.
    // `node` is react-markdown's own hast node and must not reach the DOM —
    // spreading it renders `node="[object Object]"` as an attribute.
    <li className={cn("text-ui-base leading-[21px] text-ink marker:text-ink-3", className)} {...rest}>
      {children}
    </li>
  ),

  /* GFM task list: the checkbox is the marker, so it is sized down and tinted
     instead of rendering as a browser-default control */
  input: ({ checked, node: _node, ...rest }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      disabled
      className="mr-1.5 size-[11px] shrink-0 translate-y-[1px] accent-[var(--accent)] align-middle"
      {...rest}
    />
  ),

  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink">{children}</em>,
  del: ({ children }) => <del className="text-ink-3 line-through">{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-ink underline decoration-[color-mix(in_oklch,var(--accent)_35%,transparent)] underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    /* no italics: CJK has no italic face, and the browser's synthetic slant
       made quoted Chinese look broken */
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-ui-base text-ink-3">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-0 border-t border-line" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="my-2 max-h-[360px] max-w-full rounded-card shadow-hairline" />
  ),

  code: InlineCode,

  pre: ({ children }) => {
    // react-markdown hands the fenced block here; pull the raw text back out so
    // ChatCode can highlight it in one pass
    const { lang, text } = fenced(children);
    if (!text) return null;
    return <ChatCode lang={lang} text={text} />;
  },

  table: ({ children }) => (
    <div className="scrollbar-thin my-3 max-w-full overflow-x-auto rounded-card shadow-hairline">
      <table className="w-full border-collapse text-ui-caption">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-inset">{children}</thead>,
  /* `style` carries GFM's column alignment (`text-align: right` from `---:`), so
     dropping it made every right-aligned number column read as left-aligned. */
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b border-line px-3 py-2 text-left text-ui-sm font-medium whitespace-nowrap text-ink-2"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="border-b border-line px-3 py-1.5 text-ui-caption text-ink-2 tabular-nums last:border-r-0"
    >
      {children}
    </td>
  ),
  /* the "no border on the final row" rule is scoped to the body, so a table with
     only a header keeps its rule */
  tr: ({ children, style }) => (
    <tr style={style} className="[tbody_&:last-child>td]:border-b-0">
      {children}
    </tr>
  ),
};

/* ── the narrow panel ───────────────────────────────────── */

/* A section heading may not out-size the body here. The panel's own title sits
   at 14px, and a `## Notes` drawn at 16px read as a second title above the
   first; weight plus a hairline over the section carries the hierarchy instead,
   which is how the rest of this column separates one group of rows from the
   next. The document's first heading keeps neither: the only thing above it is
   the panel's own toolbar. */
const PANEL_H2 =
  "mt-4 mb-1.5 border-t border-line pt-2.5 text-ui-caption font-semibold tracking-[-0.01em] text-ink first:mt-0 first:border-t-0 first:pt-0";
const PANEL_H3 = "mt-3 mb-1 text-ui-caption font-medium text-ink first:mt-0";
const PANEL_H5 = "mt-2.5 mb-1 text-ui-sm font-medium text-ink-2 first:mt-0";
const PANEL_H6 = "mt-2.5 mb-1 text-ui-sm font-medium tracking-[0.3px] text-ink-3 first:mt-0";

const panelComponents: Components = {
  /* Prose takes its colour from the container rather than naming one, so a
     blockquote (ink-2) mutes the paragraphs inside it — the transcript's `p`
     hard-codes ink, which is why a quote there reads as bright as the text it
     is quoting. */
  p: ({ children }) => <p className="my-1.5 text-ui-caption leading-[19px] first:mt-0 last:mb-0">{children}</p>,

  h1: ({ children }) => <h3 className={PANEL_H2}>{children}</h3>,
  h2: ({ children }) => <h3 className={PANEL_H2}>{children}</h3>,
  h3: ({ children }) => <h4 className={PANEL_H3}>{children}</h4>,
  h4: ({ children }) => <h4 className={PANEL_H3}>{children}</h4>,
  h5: ({ children }) => <h5 className={PANEL_H5}>{children}</h5>,
  h6: ({ children }) => <h6 className={PANEL_H6}>{children}</h6>,

  /* markers are drawn by `list-style`, so the indent is the whole budget: three
     pixels less on each list than the transcript's, and a 3px gap between items
     rather than 4 — at 19px leading, 4px starts reading as a paragraph break */
  ul: ({ children, className }) => (
    <ul className={cn("my-1.5 flex flex-col gap-[3px] pl-[15px]", className)} style={{ listStyle: "disc" }}>
      {children}
    </ul>
  ),
  ol: ({ children, className, start }) => (
    <ol className={cn("my-1.5 flex flex-col gap-[3px] pl-[19px]", className)} style={{ listStyle: "decimal" }} start={start}>
      {children}
    </ol>
  ),
  li: ({ children, className, node: _node, ...rest }) => (
    <li className={cn("text-ui-caption leading-[19px] marker:text-ink-3", className)} {...rest}>
      {children}
    </li>
  ),

  input: ({ checked, node: _node, ...rest }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      disabled
      className="mr-1.5 size-[10px] shrink-0 translate-y-[1px] accent-[var(--accent)] align-middle"
      {...rest}
    />
  ),

  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink">{children}</em>,
  del: ({ children }) => <del className="text-ink-3 line-through">{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-ink underline decoration-[color-mix(in_oklch,var(--accent)_35%,transparent)] underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-line-strong pl-2.5 text-ui-caption leading-[19px] italic text-ink-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2.5 border-0 border-t border-line" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="my-1.5 max-h-[220px] max-w-full rounded-control shadow-hairline" />
  ),

  code: InlineCode,

  pre: ({ children }) => {
    const { lang, text } = fenced(children);
    if (!text) return null;
    return <PanelCode lang={lang} text={text} />;
  },

  table: ({ children }) => (
    <div className="scrollbar-thin my-2 max-w-full overflow-x-auto rounded-control bg-surface shadow-hairline">
      <table className="w-full border-collapse text-ui-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-inset">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="border-b border-line px-2 py-1.5 text-left text-ui-sm font-medium whitespace-nowrap text-ink-2">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-line px-2 py-1 text-ui-sm text-ink-2 tabular-nums last:border-r-0">
      {children}
    </td>
  ),
  tr: ({ children, style }) => (
    <tr style={style} className="[tbody_&:last-child>td]:border-b-0">
      {children}
    </tr>
  ),
};

export const Markdown = memo(function Markdown({
  children,
  className,
  variant = "thread",
}: {
  children: string;
  className?: string;
  /** `thread` is the transcript's own metrics; `panel` is a dock column's */
  variant?: "thread" | "panel";
}) {
  const panel = variant === "panel";
  return (
    /* `break-words` only in the panel: a long path or URL in a 300px column
       would otherwise push the panel wider instead of wrapping. `text-ink` sits
       here, not on every block, so the panel's blockquote can mute its own
       paragraphs. */
    <div className={cn("min-w-0", panel && "break-words text-ink", className)}>
      <ReactMarkdown remarkPlugins={REMARK} components={panel ? panelComponents : threadComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
