import { toolSettings } from "./settings";
import { createReadToolDefinition, type ReadToolDetails } from "@earendil-works/pi-coding-agent";
import { BUDGETS, cutHead, formatBudget, formatSize, splitTrailingNotice, truncationDetails } from "./policy";

/**
 * `read`, over pi's own read tool.
 *
 * A file the model asked to read is content it works from, so this tool gets
 * the largest budget and the simplest shape: keep the head, and keep pi's own
 * continuation idea — `offset` — intact. A cut read ends with the offset that
 * continues it, computed from the requested offset plus the lines actually
 * shown, so the file can be read to the end in as many calls as it takes.
 *
 * Two things are deliberately *not* touched:
 *
 * - **Images.** Pi sends them as attachment blocks; the budget applies to text
 *   only, and a result carrying an image passes through untouched — resizing,
 *   mime detection and the non-vision note are pi's business.
 * - **File bytes.** No ANSI stripping and no CR collapsing here: a read returns
 *   what the file contains, and a file that holds escape sequences is a file
 *   whose escape sequences are the content. Only the budget is ours.
 *
 * Cancellation flows to the definition, which checks the signal before and
 * after reading. Nothing is cached — a second read re-reads the file.
 */

export function createAgentReadTool(cwd: string) {
  const base = createReadToolDefinition(cwd);
  const getSettings = toolSettings(cwd);

  return {
    ...base,
    executionMode: "parallel" as const,
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files the output is truncated to ${formatBudget(BUDGETS.read.maxBytes)}; a truncated read ends with the offset that continues it. Use offset/limit for large files, and keep reading with offset until the file is complete.`,
    promptSnippet: "Read file contents",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],

    async execute(...args: Parameters<typeof base.execute>) {
      const settings = getSettings(args[4]?.cwd);
      const configured = createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() });
      const result = await configured.execute(...args);
      try {
        return tighten(result, args[1]);
      } catch {
        /* a budget is an optimisation; never let it turn a good read into an error */
        return result;
      }
    },
  };
}

function tighten(
  result: Awaited<ReturnType<ReturnType<typeof createReadToolDefinition>["execute"]>>,
  params: { path: string; offset?: number; limit?: number },
) {
  /* Images are attachments: the budget is a text budget, and pi's image path
   * (resize, mime note, non-vision note) must reach the model unchanged. */
  if (result.content.some((block) => block.type === "image")) return result;
  const block = result.content.find((part) => part.type === "text");
  if (!block || !block.text) return result;

  const start = params.offset && params.offset > 0 ? params.offset : 1;
  const { body, notice } = splitTrailingNotice(block.text);
  const firstLineBytes = Buffer.byteLength(body.split("\n", 1)[0] ?? "", "utf-8");
  if (firstLineBytes > BUDGETS.read.maxBytes) {
    /* One line, bigger than the whole budget (minified code, a base64 blob).
     * A byte prefix of it would be a lie about offsets, so hand over pi's own
     * escape hatch instead — the line, cut by the shell, on purpose. */
    const quotedPath = `'${params.path.replace(/'/g, `'"'"'`)}'`;
    const text = `[Line ${start} is ${formatSize(firstLineBytes)}, larger than the ${formatSize(BUDGETS.read.maxBytes)} read budget. Use bash: sed -n '${start}p' -- ${quotedPath} | head -c ${BUDGETS.read.maxBytes}]`;
    return { ...result, content: [{ ...block, text }, ...result.content.filter((part) => part !== block)] };
  }

  const cut = cutHead(body, BUDGETS.read.maxBytes);
  if (!cut.truncated) return result;

  const lines = shownLines(cut.text);
  const next = start + lines;
  /* pi's notice counted the file's lines; carrying that total over keeps the
   * "of N" the model uses to judge whether continuing is worth it. Best effort
   * by design: an unfamiliar shape simply omits it. */
  const total = notice ? /of (\d+)/.exec(notice)?.[1] : undefined;
  const text = `${cut.text}\n\n[Showing lines ${start}-${next - 1}${total ? ` of ${total}` : ""} (${formatSize(BUDGETS.read.maxBytes)} read limit). Continue with offset=${next}.]`;
  const details: ReadToolDetails = { truncation: truncationDetails(cut, BUDGETS.read.maxBytes) };
  return {
    ...result,
    content: [{ ...block, text }, ...result.content.filter((part) => part !== block)],
    details,
  };
}

/** Lines a cut body actually shows — the number the next offset is built from. */
function shownLines(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}
