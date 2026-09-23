import { formatSize, truncateHead, truncateTail, type TruncationResult } from "@earendil-works/pi-coding-agent";

/**
 * What reaches the model, and in what shape.
 *
 * Pi's built-in tools keep everything they can: 2000 lines or 50KB per call,
 * whichever comes first, with the full text spilled to a file only when that
 * limit is hit. The desktop pays per token on every one of those bytes, and a
 * terminal that drew colours, carriage returns and binary noise pays for the
 * escape codes too — pi's *display* path strips those (`getTextOutput`), the
 * tool path does not.
 *
 * So this module is the one place that decides the model-facing budget, and it
 * deliberately does no truncation work of its own: cuts are Pi's `truncateHead`
 * / `truncateTail` (never a partial line except where Pi itself allows one), a
 * cut is applied only when the result is over budget, and the notice that
 * continues it is written here only because a smaller budget moves every
 * continuation marker Pi would have written.
 *
 * Budgets are per content type, not one constant, because the three tools are
 * used differently: a file the model asked to read is content it will work
 * from (largest budget), a command's output is context plus a verdict at the
 * end, and a search result is an index that should be followed up with `read`
 * (smallest). The numbers sit inside the 20–30KB band the model-optimization
 * research recommends and under pi's 50KB, with bash deliberately keeping a
 * head and a tail — a build log's first lines say what ran, its last lines say
 * what happened, and the middle is repetition.
 */

export interface OutputBudget {
  /** bytes of content that may reach the model (the continuation notice is extra) */
  maxBytes: number;
  /** bash only: how much of the budget is spent on the head; the rest keeps the tail */
  headBytes?: number;
}

export const BUDGETS = {
  /** ~600 lines of source, or most of a small file */
  read: { maxBytes: 24 * 1024 },
  /** 6KB of head + 14KB of tail: what ran, and how it ended */
  bash: { maxBytes: 20 * 1024, headBytes: 6 * 1024 },
  /** an index, not an answer — the model is expected to follow up with read */
  grep: { maxBytes: 16 * 1024 },
} as const satisfies Record<string, OutputBudget>;

/**
 * ANSI escape sequences: OSC (`ESC ]` … BEL / `ESC \`) and CSI (`ESC [` … final
 * byte), matching what pi's own `stripAnsi` removes. Pi does not export that
 * helper, so the pattern is restated here rather than deep-importing a file the
 * package's export map does not expose.
 */
const ANSI = /\u001b\][\s\S]*?(?:\u0007|\u001b\\|\u009c)|[\u001b\u009b][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;

export function stripAnsi(text: string): string {
  return text.includes("\u001b") || text.includes("\u009b") ? text.replace(ANSI, "") : text;
}

/**
 * Command output, as a terminal would have left it.
 *
 * A carriage return returns the cursor to column 0, so `10%` + CR + `20%` ends
 * up showing `20%`. Pi's display path erases every CR, which *concatenates*
 * progress frames — the model then pays for all of them. Keeping the last frame
 * of each line is what a human saw, and it is fewer tokens, not more. Control
 * characters other than tab and newline are dropped for the reason pi's
 * `sanitizeBinaryOutput` drops them: they are not text.
 */
export function cleanShellOutput(text: string): string {
  const stripped = stripAnsi(text);
  const collapsed = stripped.includes("\r")
    ? stripped
        .split("\n")
        .map(lastFrame)
        .join("\n")
    : stripped;
  return collapsed.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** The last non-empty segment of a line the carriage return overwrote. */
function lastFrame(line: string): string {
  if (!line.includes("\r")) return line;
  const frames = line.split("\r");
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index] !== "") return frames[index];
  }
  return "";
}

/** A byte-exact prefix, cut at a character boundary. */
function prefixBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf-8");
}

/** A byte-exact suffix, cut at a character boundary. */
function suffixBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.length <= maxBytes) return text;
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString("utf-8");
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.length;
}

export interface Cut {
  /** the content that may reach the model */
  text: string;
  truncated: boolean;
  /** bytes of the input, before the cut */
  totalBytes: number;
  /** lines of the input, before the cut */
  totalLines: number;
}

/**
 * Pi's own continuation notice: a bracketed block closing the result.
 *
 * Every built-in tool ends its truncated result with one (`[Showing lines 1-1000
 * of 5000. Use offset=1001 to continue.]`, `[100 matches limit reached. …]`,
 * `[… Full output: /tmp/pi-bash-….log]`). A re-cut has to move that block: the
 * numbers in it describe Pi's limits, not ours. Splitting it out lets each
 * wrapper decide — carry the facts forward, or replace them with its own.
 */
export function splitTrailingNotice(text: string): { body: string; notice?: string } {
  const at = text.lastIndexOf("\n\n[");
  if (at === -1) return { body: text };
  const block = text.slice(at + 2);
  if (!block.endsWith("]")) return { body: text };
  const inner = block.slice(1, -1);
  const isNotice =
    /^(Showing (?:lines|the last) |Line \d+ is |\d+ more lines |\d+ matches limit reached|[^\]]*\blimit reached\b|Some lines truncated)/.test(
      inner,
    );
  return isNotice ? { body: text.slice(0, at), notice: block } : { body: text };
}

/**
 * The tail of `text` that is already accounted for by a cut, in bytes.
 */


function untouched(text: string): Cut {
  return {
    text,
    truncated: false,
    totalBytes: Buffer.byteLength(text, "utf-8"),
    totalLines: lineCount(text),
  };
}

/**
 * Keep the head. Pi's line-aware head truncation is used as-is; a single line
 * longer than the whole budget (minified output, base64) is cut at a byte
 * boundary instead of Pi's `firstLineExceedsLimit` empty result, which would
 * hand the model nothing to act on.
 */
export function cutHead(text: string, maxBytes: number): Cut {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return untouched(text);
  const head = truncateHead(text, { maxBytes, maxLines: Number.MAX_SAFE_INTEGER });
  return {
    text: head.firstLineExceedsLimit ? prefixBytes(text, maxBytes) : head.content,
    truncated: true,
    totalBytes: Buffer.byteLength(text, "utf-8"),
    totalLines: lineCount(text),
  };
}

/**
 * Keep the tail. For text pi has *already* truncated, this is the honest cut:
 * pi hands over the end of the output, and the end is the part worth keeping.
 */
export function cutTail(text: string, maxBytes: number): Cut {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return untouched(text);
  const tail = truncateTail(text, { maxBytes, maxLines: Number.MAX_SAFE_INTEGER });
  return {
    text: tail.lastLinePartial ? suffixBytes(text, maxBytes) : tail.content,
    truncated: true,
    totalBytes: Buffer.byteLength(text, "utf-8"),
    totalLines: lineCount(text),
  };
}

/**
 * Keep the head and the tail, drop the middle — the shape a build log wants.
 *
 * The head is capped at `headBytes`; the tail gets whatever is left of the
 * budget after it, so the two never overlap and never exceed the budget. The
 * marker between them is extra, the same way Pi's own continuation notice is.
 */
export interface HeadTailCut extends Cut {
  /** bytes kept from the head */
  headBytes: number;
  /** bytes kept from the tail */
  tailBytes: number;
}

export function cutHeadAndTail(text: string, maxBytes: number, headBytes: number): HeadTailCut {
  const total = Buffer.byteLength(text, "utf-8");
  if (total <= maxBytes) return { ...untouched(text), headBytes: Buffer.byteLength(text, "utf-8"), tailBytes: 0 };
  const head = truncateHead(text, { maxBytes: Math.min(headBytes, maxBytes), maxLines: Number.MAX_SAFE_INTEGER });
  const headText = head.firstLineExceedsLimit ? prefixBytes(text, Math.min(headBytes, maxBytes)) : head.content;
  const keptHeadBytes = Buffer.byteLength(headText, "utf-8");
  const tail = truncateTail(text, {
    maxBytes: Math.max(1, maxBytes - keptHeadBytes),
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const tailText = tail.lastLinePartial ? suffixBytes(text, maxBytes - keptHeadBytes) : tail.content;
  const keptTailBytes = Buffer.byteLength(tailText, "utf-8");
  const omitted = Math.max(0, total - keptHeadBytes - keptTailBytes);
  return {
    text: `${headText}\n\n[… ${formatSize(omitted)} omitted …]\n\n${tailText}`,
    truncated: true,
    totalBytes: total,
    totalLines: lineCount(text),
    headBytes: keptHeadBytes,
    tailBytes: keptTailBytes,
  };
}

/**
 * A `TruncationResult` for a cut we made, in Pi's own shape.
 *
 * The details field of each built-in tool is part of its contract — the CLI's
 * renderers read it — so an override reports its cut the same way instead of
 * inventing a second shape.
 */
export function truncationDetails(cut: Cut, maxBytes: number): TruncationResult {
  return {
    content: cut.text,
    truncated: true,
    truncatedBy: "bytes",
    totalLines: cut.totalLines,
    totalBytes: cut.totalBytes,
    outputLines: lineCount(cut.text),
    outputBytes: Buffer.byteLength(cut.text, "utf-8"),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes,
  };
}

/** Pi's own size formatting, re-exported so every notice is written in one idiom. */
export { formatSize };

/**
 * `24KB` for whole kilobytes, `1.5MB` otherwise — how pi's own tool descriptions
 * name their limits. The notices keep the precise form; a description reads
 * better without the decimal.
 */
export function formatBudget(bytes: number): string {
  return bytes % 1024 === 0 ? `${bytes / 1024}KB` : formatSize(bytes);
}
