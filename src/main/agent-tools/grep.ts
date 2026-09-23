import { createGrepToolDefinition, type GrepToolDetails } from "@earendil-works/pi-coding-agent";
import { BUDGETS, cutHead, formatBudget, formatSize, splitTrailingNotice, truncationDetails } from "./policy";

/**
 * `grep`, over pi's own grep tool.
 *
 * A search result is an index, not an answer: the model is expected to follow a
 * hit with `read`. It therefore gets the smallest budget of the three, applied
 * as a head cut — the first matches are the ones to look at.
 *
 * Everything pi decided about the search is kept, including its own notice
 * block, because those facts stay true after our cut: whether the match limit
 * was reached (and that `limit=N` returns more), whether long lines were
 * truncated (and that `read` shows them whole). Our notice is *appended*, and
 * only says what the desktop's budget did — so the search's semantics are never
 * rewritten from here, and the `context`/`limit`/`glob` arguments are passed
 * through exactly as the model sent them.
 *
 * Nothing is cached: every call re-runs ripgrep, and a pattern that matched
 * before matches again.
 */

export function createAgentGrepTool(cwd: string) {
  const base = createGrepToolDefinition(cwd);

  return {
    ...base,
    executionMode: "parallel" as const,
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or ${formatBudget(BUDGETS.grep.maxBytes)} (whichever is hit first); when the budget cuts it, re-run with a narrower pattern — or read a specific file — for the rest. Long lines are truncated to 500 chars.`,
    promptSnippet: "Search file contents for patterns (respects .gitignore)",

    async execute(...args: Parameters<typeof base.execute>) {
      const result = await base.execute(...args);
      try {
        return tighten(result);
      } catch {
        /* a budget is an optimisation; never let it turn a good search into an error */
        return result;
      }
    },
  };
}

function tighten(result: Awaited<ReturnType<ReturnType<typeof createGrepToolDefinition>["execute"]>>) {
  const block = result.content[0];
  if (!block || block.type !== "text" || !block.text || block.text === "No matches found") return result;

  const { body, notice } = splitTrailingNotice(block.text);
  const cut = cutHead(body, BUDGETS.grep.maxBytes);
  if (!cut.truncated) return result;

  const shown = cut.text === "" ? 0 : cut.text.split("\n").length;
  /* pi's own truncation counted the search's whole result; keeping that total
   * is more honest than reporting the lines that survived pi's 50KB cap. */
  const total = result.details?.truncation?.totalLines ?? cut.totalLines;
  const budget =
    `[The ${formatSize(BUDGETS.grep.maxBytes)} grep budget cut the result after ${shown} of ${total} lines. ` +
    `Re-run with a narrower pattern, or read a specific file, for the rest.]`;
  const text = notice ? `${cut.text}\n\n${notice}\n\n${budget}` : `${cut.text}\n\n${budget}`;
  const details: GrepToolDetails = { ...result.details, truncation: truncationDetails(cut, BUDGETS.grep.maxBytes) };
  return { ...result, content: [{ ...block, text }, ...result.content.slice(1)], details };
}
