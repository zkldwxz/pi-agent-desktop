import { toolSettings } from "./settings";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashToolDefinition, type BashToolDetails } from "@earendil-works/pi-coding-agent";
import {
  BUDGETS,
  cleanShellOutput,
  cutHeadAndTail,
  cutTail,
  formatBudget,
  formatSize,
  splitTrailingNotice,
  truncationDetails,
  type Cut,
  type HeadTailCut,
} from "./policy";

/**
 * `bash`, over pi's own bash tool.
 *
 * Three things are added to what pi already does, and nothing else:
 *
 * 1. **No colour, ever.** `NO_COLOR` / `TERM=dumb` / `FORCE_COLOR=0` go into the
 *    child environment through pi's own `spawnHook`, so well-behaved tools never
 *    emit escape codes in the first place.
 * 2. **Cleaning.** Whatever they emit anyway is stripped, and CR-overwritten
 *    progress frames collapse to the frame a human would have seen.
 * 3. **A smaller inline budget**, keeping the head *and* the tail: the first
 *    lines say what ran, the last lines say how it ended, the middle of a build
 *    log is repetition.
 *
 * Continuation is pi's own idea, kept intact: the full output is on disk and the
 * notice names the path. When pi spilled the file, that path is reused — it holds
 * the *complete* raw output, so a budget smaller than pi's never loses anything
 * reachable. When pi did not spill (the output fit in 50KB but not in ours), the
 * cleaned full text is written to a fresh file in pi's own temp-file style.
 * Nothing here is cached: the command runs on every call, and the file is a copy
 * for the model to read, not a stored answer.
 *
 * Cancellation is pi's: `signal` goes to the definition untouched, and the local
 * shell backend kills the process tree with it. Failure is pi's too — a non-zero
 * exit throws, so the failure stays an error result; only the message is cleaned
 * and bounded the same way the output is.
 */

const SHELL_ENV = { NO_COLOR: "1", TERM: "dumb", FORCE_COLOR: "0" };

export function createAgentBashTool(cwd: string) {
  const getSettings = toolSettings(cwd);
  const options = {
    spawnHook: (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => ({ ...context, env: { ...context.env, ...SHELL_ENV } }),
  };
  const base = createBashToolDefinition(cwd, options);

  return {
    ...base,
    executionMode: "sequential" as const,
    description: `Execute a bash command in the current working directory. Returns stdout and stderr, cleaned of colour and control codes. Output is truncated to the first ${formatBudget(BUDGETS.bash.headBytes)} and last ${formatBudget(BUDGETS.bash.maxBytes - BUDGETS.bash.headBytes)} (${formatBudget(BUDGETS.bash.maxBytes)} total); when that happens the full output is saved to a temp file and the path is given in the result, so read that file for the rest. Optionally provide a timeout in seconds.`,
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    promptGuidelines: ["You can inspect PI_* environment variables for current model and session details."],

    async execute(...args: Parameters<typeof base.execute>) {
      let result: Awaited<ReturnType<typeof base.execute>>;
      try {
        const settings = getSettings(args[4]?.cwd);
        const configured = createBashToolDefinition(cwd, {
          ...options,
          shellPath: settings.getShellPath(),
          commandPrefix: settings.getShellCommandPrefix(),
        });
        result = await configured.execute(...args);
      } catch (error) {
        throw await tightenError(error);
      }
      const block = result.content[0];
      if (!block || block.type !== "text") return result;

      const cleaned = cleanShellOutput(block.text);
      const { body, notice } = splitTrailingNotice(cleaned);
      /* Pi hands over either the whole output or its own tail of it. Cutting the
       * middle only makes sense in the first case — the "head" of a tail slice
       * is not the beginning of anything, so that text is cut from the end. */
      const piCut = result.details?.truncation?.truncated === true;
      const cut = piCut
        ? cutTail(body, BUDGETS.bash.maxBytes)
        : cutHeadAndTail(body, BUDGETS.bash.maxBytes, BUDGETS.bash.headBytes);
      if (!cut.truncated) {
        return cleaned === block.text
          ? result
          : { ...result, content: [{ ...block, text: cleaned }, ...result.content.slice(1)] };
      }

      const details: BashToolDetails = { ...result.details, truncation: truncationDetails(cut, BUDGETS.bash.maxBytes) };
      const spilled = details.fullOutputPath ?? (await spillFullOutput(cleaned));
      if (!spilled) return { ...result, content: [{ ...block, text: cleaned }, ...result.content.slice(1)] };
      details.fullOutputPath = spilled;
      const where = spilled ? ` Full output: ${spilled}` : "";
      const text = `${cut.text}\n\n[${bashCutNotice(cut, piCut)}${where}]`;
      return {
        ...result,
        content: [{ ...block, text: notice ? `${text}\n\n${notice}` : text }, ...result.content.slice(1)],
        details,
      };
    },
  };
}

/** What was shown, said in the terms of the cut that produced it. */
function bashCutNotice(cut: Cut | HeadTailCut, tailOnly: boolean): string {
  if (tailOnly) {
    return `Showing the last ${formatSize(cut.totalBytes > BUDGETS.bash.maxBytes ? BUDGETS.bash.maxBytes : cut.totalBytes)} of ${formatSize(cut.totalBytes)} (${formatSize(BUDGETS.bash.maxBytes)} budget).`;
  }
  const { headBytes, tailBytes } = cut as HeadTailCut;
  return `Showing the first ${formatSize(headBytes)} and last ${formatSize(tailBytes)} of ${formatSize(cut.totalBytes)}; the middle was omitted within the ${formatSize(BUDGETS.bash.maxBytes)} budget.`;
}

/**
 * The full cleaned output, in pi's own temp-file shape.
 *
 * Only reached when pi's 50KB limit did not trigger, so the text is already
 * complete. A failure to write is not a failure of the command: the notice then
 * just says the middle was omitted.
 */
async function spillFullOutput(text: string): Promise<string | undefined> {
  const path = join(tmpdir(), `pi-bash-clean-${randomBytes(8).toString("hex")}.log`);
  try {
    await writeFile(path, text, "utf-8");
    return path;
  } catch {
    return undefined;
  }
}

/** The same budget for a thrown command's message; the original error is kept when nothing changed. */
async function tightenError(error: unknown): Promise<unknown> {
  if (!(error instanceof Error)) return error;
  const cleaned = cleanShellOutput(error.message);
  const { body, notice } = splitTrailingNotice(cleaned);
  const cut = cutHeadAndTail(body, BUDGETS.bash.maxBytes, BUDGETS.bash.headBytes);
  if (!cut.truncated) {
    if (cleaned === error.message) return error;
    return named(error, cleaned);
  }
  const spilled = await spillFullOutput(cleaned);
  if (!spilled) return named(error, cleaned);
  const text = `${cut.text}\n\n[${bashCutNotice(cut, false)} Full output: ${spilled}]`;
  return named(error, notice ? `${text}\n\n${notice}` : text);
}

/** A new error with the same name and a bounded message. */
function named(error: Error, message: string): Error {
  const next = new Error(message);
  next.name = error.name;
  return next;
}
