import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn";
import CodeBlock from "./beautiful/primitives/CodeBlock";

/* ─────────────────────────────────────────────────────────
 * ASSISTANT MARKDOWN
 *
 * GFM is on, so tables, task lists, strikethrough, autolinks and footnotes all
 * parse. The overrides below are presentation only, and two of them are load
 * bearing:
 *
 *   · fenced code goes to `CodeBlock`, so it gets the project's syntax colours,
 *     line numbers and copy action instead of a second, worse code style
 *   · tables get the same hairline treatment as the rest of the UI, because the
 *     browser default is a borderless grid that reads as broken
 *
 * The list overrides are deliberately thin. `react-markdown` puts any nested
 * `<ul>` / `<ol>` *inside* the `li`'s children, so replacing the element's
 * children wholesale drops the nesting and the numbering — an ordered list came
 * out as bare dots with no numbers at all. `list-style` draws the markers
 * instead, which leaves the DOM exactly as the parser built it.
 *
 * Not handled, because the parser does not do it: raw inline HTML (`<br>`, `<b>`)
 * arrives escaped, and `$math$` / definition lists are not GFM.
 * ───────────────────────────────────────────────────────── */

const components: Components = {
  p: ({ children }) => <p className="my-2 text-[13px] leading-[21px] text-ink first:mt-0 last:mb-0">{children}</p>,

  h1: ({ children }) => <h3 className="mt-4 mb-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-[14px] font-semibold tracking-[-0.01em] text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-[13px] font-medium text-ink">{children}</h4>,
  /* h5 / h6 used to fall through to the browser default — dark grey, 0.83em,
     bold — which read as unstyled next to the mapped levels above. */
  h5: ({ children }) => <h5 className="mt-3 mb-1.5 text-[12.5px] font-medium text-ink-2">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 mb-1.5 text-[12px] font-medium tracking-[0.3px] text-ink-3">{children}</h6>,

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
    <li className={cn("text-[13px] leading-[21px] text-ink marker:text-ink-3", className)} {...rest}>
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
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-[13px] italic text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-0 border-t border-line" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="my-2 max-h-[360px] max-w-full rounded-card shadow-hairline" />
  ),

  /* inline code only — fenced blocks arrive as `pre` and are handled below.
     File paths and symbols are rendered as blue references, the Cursor way. */
  code: ({ children, className }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) return <code className={className}>{children}</code>;
    const text = String(children ?? "");
    const looksLikePath = /^[\w.@~-]*[\\/][\w.@\\/-]+\.[\w]+$|^[\w.@~-]+\.[\w]{1,10}(:\d+)?$/.test(text);
    return (
      <code
        className={cn(
          "rounded-[4px] px-[3px] py-[1px] font-mono text-[11.5px]",
          looksLikePath
            ? "text-accent-ink hover:underline decoration-accent/40 underline-offset-2"
            : "bg-inset text-ink-2 shadow-hairline",
        )}
      >
        {children}
      </code>
    );
  },

  pre: ({ children }) => {
    // react-markdown hands the fenced block here; pull the raw text back out so
    // CodeBlock can number it
    const child = Array.isArray(children) ? children[0] : children;
    const props = (child as { props?: { className?: string; children?: unknown } })?.props;
    const lang = /language-(\w+)/.exec(props?.className ?? "")?.[1] ?? "";
    const text = String(props?.children ?? "").replace(/\n$/, "");
    if (!text) return null;
    return (
      <div className="my-3">
        <CodeBlock variant="Code" lines={text.split("\n")} code={text} filename={lang ? `snippet.${lang}` : "snippet"} />
      </div>
    );
  },

  table: ({ children }) => (
    <div className="scrollbar-thin my-3 max-w-full overflow-x-auto rounded-card bg-surface shadow-card">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-inset">{children}</thead>,
  /* `style` carries GFM's column alignment (`text-align: right` from `---:`), so
     dropping it made every right-aligned number column read as left-aligned. */
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b border-line px-3 py-2 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-2"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="border-b border-line px-3 py-1.5 text-[12px] text-ink-2 tabular-nums last:border-r-0"
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

export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
