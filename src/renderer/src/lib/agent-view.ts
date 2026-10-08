import type { ChatMessage, ToolActivity } from "@shared/types";
import { mcpCallDisplay, parseMcpToolName } from "@shared/mcp-tool";
import { getLocale, t, tf, type Locale } from "./i18n";

/* ─────────────────────────────────────────────────────────
 * Agent view model
 *
 * Turns the raw message log into the shapes the Beautiful UI primitives
 * expect: a thinking trace with the right variant, tool runs with diff
 * chips, an answer split into prose and code, and cited sources.
 * ───────────────────────────────────────────────────────── */

/**
 * The conversation column, ported from ZCode's conversationLayout: not a fixed
 * width but the area minus fixed margins — 6rem each side up to 864px of
 * container, capped at 4xl; 24rem of margin past 1280px, capped at 6xl. The
 * status-panel lean is a CSS variable the conversation container sets from
 * React state: with every right-hand dock closed the container goes full-width,
 * the 1280px breakpoint still fires, and a fixed -translate-x-44 left the
 * prompt bar stranded off-centre — the exact bug this replaced. The timeline
 * and the composer dock MUST render this same class — two different widths
 * would put the prompt bar out of line with the text it answers.
 */
export const CONVERSATION_COLUMN =
  "mx-auto w-full shrink-0 transition-[width,max-width,transform] duration-150 ease-out " +
  "@min-[864px]/conversation:w-[calc(100%_-_6rem)] @min-[864px]/conversation:max-w-4xl " +
  "@min-[1280px]/conversation:w-[calc(100%_-_24rem)] @min-[1280px]/conversation:max-w-6xl " +
  "@min-[1280px]/conversation:translate-x-[var(--conversation-lean,0rem)]";

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string };

export type ToolIcon = "think" | "write" | "run" | "read";

export interface ToolRun {
  toolCallId: string;
  /** the arguments from the assistant's toolCall block — a toolResult has none */
  args?: unknown;
  toolName: string;
  icon: ToolIcon;
  label: string;
  chip: string;
  mono: boolean;
  detailMono: boolean;
  /** `tone` marks a line as an addition or a removal; both carry colour */
  detail: { text: string; tone?: "add" | "del" }[];
  status: "running" | "done" | "error";
  /** the raw path this call touched, when its arguments carried one */
  path?: string;
  file?: string;
  add?: number;
  del?: number;
  /** parsed hunk lines, each carrying the line number it came from */
  diffLines?: DiffLine[];
  /**
   * The result text, and pi's result details, kept for the one row kind whose
   * second layer renders them: MCP calls. Everything else summarises its result
   * into `detail` here and drops the raw text. Both are references already held
   * by the transcript message, so carrying them costs nothing.
   */
  result?: string;
  details?: unknown;
}

export type DiffLineTone = "add" | "del" | "ctx";
/** One row of a parsed unified diff, with its resolved old/new line number. */
export interface DiffLine {
  text: string;
  tone: DiffLineTone;
  old?: number | null;
  cur?: number | null;
}

export type TraceVariant = "Steps" | "Reasoning" | "Search" | "Coding";

/**
 * One beat of a turn, in the order the agent actually produced it.
 *
 * The aggregated fields below (`thinking`, `toolRuns`, `fullText`) are what the
 * panels summarise; the transcript renders `items` instead, so a turn reads
 * thought → search → thought → edit → answer in the order it happened rather
 * than all thinking first and all text last.
 */
export type TurnItem =
  | { kind: "thinking"; key: string; text: string; at: number; durationMs?: number }
  | { kind: "tools"; key: string; runs: ToolRun[]; at: number }
  | { kind: "text"; key: string; text: string; at: number };

/** How a run is bucketed into a summary row. */
export type ToolBucket = "explore" | "edit" | "other";

/**
 * A run of consecutive tool calls of one bucket, as one collapsed row.
 *
 * A working turn is mostly "read this, grep that, run the tests" — a dozen rows
 * that all say the same kind of thing. Collapsing them into one row per bucket
 * ("Explored · 12 files, ran 3 commands") is what keeps the answer visible; the
 * individual calls are one click away.
 */
export interface ToolGroupView {
  key: string;
  bucket: ToolBucket;
  runs: ToolRun[];
  /** the collapsed row's text */
  label: string;
  /** distinct files read, searched or written */
  files: number;
  searches: number;
  commands: number;
  add: number;
  del: number;
  running: boolean;
}

export interface TurnView {
  key: string;
  /** index among this session's user messages — what fork() addresses */
  userIndex: number;
  timestamp: number;
  /** user prompt */
  prompt?: string;
  /**
   * A boundary an extension drew, and the sentence it drew it with.
   *
   * Plan mode's build is a task of its own: the plan's turn ends when the plan
   * is on screen, and the build's turn opens with this instead of a user
   * prompt. It is not a prompt — there is nothing for the user to edit or fork
   * back to — so it rides along as its own row rather than pretending to be one.
   */
  boundary?: string;
  /** assistant plain text, aggregated across the turn — panels summarise this */
  fullText: string;
  toolRuns: ToolRun[];
  /** the turn in production order — what the transcript renders */
  items: TurnItem[];
  /** the turn's opening prose, kept for outline rows and canvas captions */
  lead: string;
  /** timestamp of the last beat — completion time once the turn settles */
  endedAt: number;
  sources: { name: string; domain: string; href: string; image: string }[];
  followUps: string[];
  streaming: boolean;
  usage?: ChatMessage["usage"];
  error?: boolean;
  notes: { text: string; tone: "compaction" | "branch" }[];
}

/**
 * The custom message that opens a new task without a user prompt.
 *
 * Plan mode sends it when the build starts (`resources/extensions/plan-mode`),
 * so the window can show the plan and the build as the two tasks they are. It
 * is the extension's own type name, not a shape the window invented: the plugin
 * matches on it too, and a second spelling would drift.
 */
const TASK_BOUNDARY = "plan-mode-build";

const SEARCH_TOOLS = new Set(["web_search", "browser_search", "search", "browser_find", "web_fetch"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "browser_snapshot", "browser_open"]);
const WRITE_TOOLS = new Set(["edit", "write", "browser_fill", "browser_click"]);
/** pi runs everything through its shell tool; those are the calls that become "ran N commands". */
const COMMAND_TOOLS = new Set(["bash", "powershell", "shell", "run"]);

function classify(toolName: string): ToolIcon {
  if (SEARCH_TOOLS.has(toolName)) return "think";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (READ_TOOLS.has(toolName)) return "read";
  return "run";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** `/path/to/file.ts` → `file.ts` */
function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

function truncate(value: string, max = 64): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Parse a unified diff into the row shape `CodeBlock` and `ToolChips` render.
 *
 * Handles what `pi`'s edit tool actually emits: `---`/`+++` file headers, hunk
 * markers, `\ No newline at end of file` annotations, and **multiple hunks in one
 * patch**. Line numbers are reconstructed from each hunk's own `@@` header, so a
 * change at line 35 is numbered 35 and not "wherever the previous hunk ended".
 */
export function parseUnifiedDiff(
  patch: string,
  limit = 60,
): { lines: DiffLine[]; add: number; del: number } {
  return parseDiff(patch, limit);
}

function parseDiff(
  patch: string,
  limit = 60,
): { lines: DiffLine[]; add: number; del: number } {
  const lines: DiffLine[] = [];
  let add = 0;
  let del = 0;
  /** running counters, re-based by every `@@` header */
  let oldLine = 0;
  let curLine = 0;

  // drop exactly one trailing newline first: otherwise it leaves an empty final
  // element that renders as a blank row
  const body = patch.endsWith("\n") ? patch.slice(0, -1) : patch;

  for (const raw of body.split("\n")) {
    // file headers carry no content
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) continue;
    // "\ No newline at end of file" annotates the line above it; it is not a row
    if (raw.startsWith("\\")) continue;

    if (raw.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        // the header's numbers are the first line of the hunk, so step back one
        oldLine = Number(match[1]) - 1;
        curLine = Number(match[2]) - 1;
      }
      lines.push({ text: raw, tone: "ctx", old: null, cur: null });
    } else if (raw.startsWith("+")) {
      add += 1;
      curLine += 1;
      lines.push({ text: raw.slice(1), tone: "add", old: null, cur: curLine });
    } else if (raw.startsWith("-")) {
      del += 1;
      oldLine += 1;
      lines.push({ text: raw.slice(1), tone: "del", old: oldLine, cur: null });
    } else {
      oldLine += 1;
      curLine += 1;
      lines.push({ text: raw.startsWith(" ") ? raw.slice(1) : raw, tone: "ctx", old: oldLine, cur: curLine });
    }
    if (lines.length >= limit) break;
  }

  return { lines, add, del };
}

/** `@@ -12,7 +12,9 @@` → `:12` */
function firstHunkLine(patch: string): string | undefined {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(patch);
  return match ? `:${match[1]}` : undefined;
}

export function buildToolRun(
  name: string,
  args: unknown,
  resultText: string | undefined,
  details: unknown,
  status: "running" | "done" | "error",
  toolCallId: string,
): ToolRun {
  const input = asRecord(args);
  const meta = asRecord(details);
  const icon = classify(name);
  const file = pickString(input, ["file_path", "path", "filePath", "filename", "notebook_path"]);
  const target = pickString(input, ["pattern", "query", "url", "command", "prompt"]);

  const run: ToolRun = {
    toolCallId,
    args,
    toolName: name,
    icon,
    label: name,
    chip: "",
    mono: Boolean(file) || icon === "run",
    detailMono: true,
    detail: [],
    status,
    path: file,
    result: resultText,
    details,
  };

  switch (name) {
    case "read": {
      run.label = t("Read");
      run.chip = file ? `${baseName(file)}${pickString(input, ["offset"]) ? `:${input.offset}` : ""}` : "(no path)";
      break;
    }
    case "write": {
      run.label = t("Write");
      const content = pickString(input, ["content"]) ?? "";
      const lineCount = content ? content.split("\n").length : 0;
      run.label = lineCount ? tf("Write {count} lines", { count: lineCount }) : t("Write");
      run.chip = file ? baseName(file) : "(no path)";
      if (content) {
        run.detail = content
          .split("\n")
          .slice(0, 6)
          .map((text) => ({ text, tone: "add" as const }));
      }
      break;
    }
    case "edit": {
      run.label = t("Edit");
      run.chip = file ? baseName(file) : "(no path)";
      const patch = typeof meta.patch === "string" ? meta.patch : typeof meta.diff === "string" ? meta.diff : "";
      if (patch) {
        // every token rebuilds every run; the patch itself never changes,
        // so the parse is memoized on the patch text
        const parsed = parseDiffCached(patch);
        run.diffLines = parsed.lines;
        run.add = parsed.add;
        run.del = parsed.del;
        run.label = tf("Edit {name}", { name: baseName(file ?? "file") });
        run.file = file ? `${baseName(file)}${firstHunkLine(patch) ?? ""}` : undefined;
        run.detail = parsed.lines
          .filter((line) => line.tone !== "ctx")
          .slice(0, 4)
          .map((line) => ({
            text: `${line.tone === "add" ? "+" : "−"} ${line.text}`,
            tone: line.tone === "add" ? ("add" as const) : ("del" as const),
          }));
      }
      break;
    }
    case "bash":
    case "run":
    case "shell":
    case "powershell": {
      run.label = t("Terminal");
      run.chip = target ? truncate(target) : t("command");
      run.detailMono = true;
      /* the whole point of clicking a run open is seeing what it printed:
       * keep the output (bounded) instead of a four-line teaser */
      if (resultText) {
        const lines = resultText.split("\n");
        const shown = lines.slice(0, 60);
        run.detail = shown.map((text) => ({ text: truncate(text, 400) }));
        if (lines.length > shown.length) {
          run.detail.push({ text: tf("… {count} more lines", { count: lines.length - shown.length }) });
        }
      }
      break;
    }
    case "grep":
    case "find": {
      run.label = name === "grep" ? t("Search") : t("Find");
      run.chip = target ? truncate(target, 40) : "pattern";
      const hits = resultText ? resultText.split("\n").filter(Boolean).length : 0;
      if (hits) run.detail = [{ text: tf("{count} matching lines", { count: hits }) }];
      break;
    }
    case "ls": {
      run.label = t("List");
      run.chip = file ? baseName(file) : ".";
      const entries = resultText ? resultText.split("\n").filter(Boolean).length : 0;
      if (entries) run.detail = [{ text: tf("{count} entries", { count: entries }) }];
      break;
    }
    default: {
      /* MCP tools arrive as `mcp__server__tool`; the row names the server and
         what the tool does instead of showing the wire name. The result parse
         itself happens where the row is rendered, not here — a collapsed group
         must not pay for a result nobody opened. */
      const mcp = mcpCallDisplay({ toolName: name, args: input });
      if (mcp) {
        run.label = tf("MCP · {server}", { server: mcp.serverLabel });
        run.chip = mcp.chip;
        run.mono = true;
      } else if (SEARCH_TOOLS.has(name)) {
        run.label = t("Search the web");
        run.chip = target ? truncate(target, 40) : "web";
      } else {
        // an unrecognised tool (an extension tool) reads as itself;
        // no "call" filler — the row is already a call
        run.label = name;
        run.chip = target ? truncate(target, 40) : "";
      }
      break;
    }
  }

  return run;
}

/** Live tool activity (running / just-finished) mapped to the same row shape. */
export function buildLiveToolRun(activity: ToolActivity): ToolRun {
  return buildToolRun(
    activity.toolName,
    activity.args,
    activity.resultText,
    activity.details,
    activity.status,
    activity.toolCallId,
  );
}

/**
 * The working label for the beat the transcript itself cannot show.
 *
 * A running tool speaks for itself — its row carries the spinner, the verb and
 * the command/file chip — so this answers `null` while one is running and the
 * line stays out of the way. What is left is the gap *after* a result lands and
 * before the model speaks again: nothing in the transcript moves there, and
 * without this the run looks finished. `null` also covers the beats that signal
 * themselves (a streaming answer has its caret, an open trace shimmers).
 */
export function liveStatusLabel(turn: TurnView, live: boolean): string | null {
  if (!live) return null;
  const last = turn.items.at(-1);
  if (!last) return null; // the loader below the thread owns the pre-first-token beat
  if (last.kind === "text" || last.kind === "thinking") return null;
  if (last.runs.some((run) => run.status === "running")) return null;
  return t("Thinking");
}

/**
 * The detail lines a call row shows when it is expanded.
 *
 * A live call with nothing to show yet gets no child rows at all: its row
 * already carries the spinner, the verb and the argument chip, and a generic
 * `running…` under it only repeated the row in weaker words. A *settled* call
 * with nothing to show still needs its outcome, or opening it presents an
 * empty box.
 */
export function toolDetailLines(run: ToolRun): ToolRun["detail"] {
  if (run.detail.length) return run.detail;
  if (run.status === "running") return [];
  return [{ text: run.status === "error" ? t("failed") : t("done") }];
}

/** `${count} files` — the count carries the key, so each language can order it. */
const plural = (count: number, one: string, many = `${one}s`) =>
  tf(`{count} ${count === 1 ? one : many}`, { count });

/** Which summary row a call belongs to: file edits, exploration, or anything else. */
function bucketOf(run: ToolRun): ToolBucket {
  if (WRITE_TOOLS.has(run.toolName)) return "edit";
  if (READ_TOOLS.has(run.toolName) || SEARCH_TOOLS.has(run.toolName) || COMMAND_TOOLS.has(run.toolName)) {
    return "explore";
  }
  return "other";
}

/**
 * One tally for a whole run segment, the collapsed-summary row's numbers:
 * reads, searches, terminals and edits counted separately — ZCode keeps a
 * terminal and an edit as their own kinds even when one turn fires several.
 */
export function summarizeWork(runs: ToolRun[]): {
  reads: number;
  searches: number;
  commands: number;
  edits: number;
  calls: number;
} {
  let reads = 0;
  let searches = 0;
  let commands = 0;
  let edits = 0;
  for (const run of runs) {
    if (WRITE_TOOLS.has(run.toolName)) edits += 1;
    else if (COMMAND_TOOLS.has(run.toolName)) commands += 1;
    else if (SEARCH_TOOLS.has(run.toolName)) searches += 1;
    else if (READ_TOOLS.has(run.toolName)) reads += 1;
  }
  return { reads, searches, commands, edits, calls: runs.length };
}

/**
 * Collapse a turn's tool calls into summary rows.
 *
 * Consecutive calls of one bucket merge, so a turn reads as "Thought" →
 * "Explored · 12 files, ran 3 commands" → "Edited app.tsx ×3 +74 −41" → the
 * answer, instead of fourteen rows of `Read`.
 *
 * A merged bucket leads with its kind: exploration counts files, searches and
 * commands, edits count files and carry the +/− totals, and anything a tool
 * group does not recognise counts calls.
 */
export function buildToolGroups(turn: TurnView): ToolGroupView[] {
  return groupRuns(turn.toolRuns);
}

/** Group one run of consecutive calls — see `buildToolGroups`. */
export function groupRuns(runs: ToolRun[]): ToolGroupView[] {
  const groups: ToolGroupView[] = [];

  for (const run of runs) {
    const bucket = bucketOf(run);
    const last = groups.at(-1);
    if (last && last.bucket === bucket) {
      last.runs.push(run);
      continue;
    }
    groups.push({
      key: run.toolCallId || `${bucket}-${groups.length}`,
      bucket,
      runs: [run],
      label: "",
      files: 0,
      searches: 0,
      commands: 0,
      add: 0,
      del: 0,
      running: false,
    });
  }

  for (const group of groups) {
    const paths = new Set<string>();
    for (const run of group.runs) {
      if (run.path) paths.add(run.path);
      if (COMMAND_TOOLS.has(run.toolName)) group.commands += 1;
      else if (SEARCH_TOOLS.has(run.toolName) || run.toolName === "grep" || run.toolName === "find" || run.toolName === "ls") {
        group.searches += 1;
      }
      group.add += run.add ?? 0;
      group.del += run.del ?? 0;
      if (run.status === "running") group.running = true;
    }
    group.files = paths.size;
    group.label = groupLabel(group);
  }

  return groups;
}

function groupLabel(group: ToolGroupView): string {
  const { runs, bucket } = group;

  // one call explains itself without a count
  if (runs.length === 1) return rowText(runs[0]);

  /* A live group collapses to the call it is on right now — ZCode's explore
   * block shows the latest child and its action kind while running, and the
   * counts only once the run stops changing. The header's call count still
   * says how many are in flight. Edits keep their file-and-count tense
   * ("Editing app.tsx ×3"), which is already the concrete thing. */
  const live = latestRunning(runs);
  if (live && bucket !== "edit") return rowText(live);

  if (bucket === "edit") {
    const editing = group.running;
    if (group.files === 1) {
      const name = (runs.find((run) => run.path)?.path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      if (name) return tf(editing ? "Editing {name} ×{count}" : "Edited {name} ×{count}", { name, count: runs.length });
    }
    return `${t(editing ? "Editing" : "Edited")} ${plural(group.files || runs.length, "file")}`;
  }

  if (bucket === "other") {
    /* a run of MCP calls is still one family; saying "3 calls" would hide the
       only thing the header is for */
    if (runs.every((run) => parseMcpToolName(run.toolName))) {
      return tf("MCP · {count} calls", { count: runs.length });
    }
    return plural(runs.length, "call");
  }

  const parts: string[] = [];
  if (group.files) parts.push(plural(group.files, "file"));
  if (group.searches) parts.push(plural(group.searches, "search", "searches"));
  if (group.commands) parts.push(`${t("ran")} ${plural(group.commands, "command")}`);
  if (!parts.length) return t("Explored");
  return `${t("Explored")} · ${parts.join(", ")}`;
}

/** The row text one call would render on its own — "Terminal npm test". */
function rowText(run: ToolRun): string {
  return run.chip && !run.label.includes(run.chip) ? `${run.label} ${run.chip}` : run.label;
}

/** The newest call still in flight — what a live group's summary is about. */
function latestRunning(runs: ToolRun[]): ToolRun | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index].status === "running") return runs[index];
  }
  return undefined;
}

const FENCE = /```([a-zA-Z0-9+-]*)\n([\s\S]*?)(?:```|$)/g;

/**
 * Bounded memo for the hot string transforms.
 *
 * The messages array is a fresh object on every streamed token, so `buildTurns`
 * re-runs over the whole history each time. Only the message that is actively
 * streaming has new text, so keying on the input string makes every settled
 * message a hit. Measured on a 600-message session at 60 tok/s, this takes the
 * per-token cost from ~3.7ms to ~0.11ms.
 */
/** Patch text → parsed diff. The transcript rebuilds runs on every token and
 *  a session can carry hundreds of hunks; the patch is immutable, so parse once. */
const parseDiffCached = memoizeByInput((patch: string) => parseDiff(patch, 40), 300);

function memoizeByInput<T>(compute: (input: string) => T, limit = 400): (input: string) => T {
  const cache = new Map<string, T>();
  return (input: string) => {
    const hit = cache.get(input);
    if (hit !== undefined) return hit;
    const value = compute(input);
    if (cache.size >= limit) {
      // evict oldest insertions; Map preserves insertion order
      let dropped = 0;
      const target = Math.ceil(limit / 4);
      for (const key of cache.keys()) {
        cache.delete(key);
        dropped += 1;
        if (dropped >= target) break;
      }
    }
    cache.set(input, value);
    return value;
  };
}

/** Split assistant prose into text and fenced code, so code renders in CodeBlock. */
export function splitSegments(text: string): TextSegment[] {
  return splitSegmentsCached(text);
}

function splitSegmentsUncached(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  FENCE.lastIndex = 0;
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0;
    if (index > last) {
      const prose = text.slice(last, index).trimEnd();
      if (prose) segments.push({ kind: "text", text: prose });
    }
    const code = match[2]?.replace(/\n$/, "") ?? "";
    if (code.trim()) segments.push({ kind: "code", lang: match[1] ?? "", code });
    last = index + match[0].length;
  }
  const rest = text.slice(last).trimEnd();
  if (rest) segments.push({ kind: "text", text: rest });
  if (!segments.length && text.trim()) segments.push({ kind: "text", text: text.trim() });
  return segments;
}

/** Pull cited sources out of whatever the search tool returned. */
function harvestSourcesUncached(text: string | undefined): TurnView["sources"] {
  if (!text) return [];
  const seen = new Set<string>();
  const sources: TurnView["sources"] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)) {
    const href = match[0].replace(/[.,;:]+$/, "");
    let domain: string;
    try {
      domain = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    const palette = ["#1f7a5f", "#2f6fec", "#e56d24", "#8a5cf0", "#3cb8c8"];
    const color = palette[sources.length % palette.length];
    sources.push({
      name: domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()),
      domain,
      href,
      image: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='${encodeURIComponent(
        color,
      )}'/%3E%3Cpath d='M14 40h36M20 40V26m8 14V20m8 20V30m8 10V24' stroke='%23fff' stroke-width='5' stroke-linecap='round'/%3E%3C/svg%3E`,
    });
    if (sources.length >= 6) break;
  }
  return sources;
}

const splitSegmentsCached = memoizeByInput(splitSegmentsUncached);
const harvestSourcesCached = memoizeByInput(harvestSourcesUncached);

/** Cached source extraction — see `memoizeByInput`. */
function harvestSources(text: string | undefined): TurnView["sources"] {
  return text ? harvestSourcesCached(text) : [];
}

/**
 * Group the flat message log into conversational turns.
 * A turn is one user prompt plus everything the agent produced for it.
 */
/**
 * Cache on the message log itself.
 *
 * Every derived view in the shell reads the same log — the transcript, the
 * composer, the changes list, the canvas, the outline, the next-step card —
 * and each used to re-parse the whole conversation on every streamed token.
 * The state array's identity is stable between updates, so one cache keyed on
 * it (plus the live-activity array) collapses all of those rebuilds into one,
 * and skips the rebuild entirely for updates that did not touch the log.
 */
let turnsCache = new WeakMap<ChatMessage[], Map<ToolActivity[] | null, TurnView[]>>();

/** A cached turn carries its tool labels, so the rows cannot outlive a language switch. */
let turnsLocale: Locale = getLocale();

export function buildTurns(messages: ChatMessage[], live: ToolActivity[]): TurnView[] {
  if (turnsLocale !== getLocale()) {
    turnsLocale = getLocale();
    turnsCache = new WeakMap();
  }
  let byLive = turnsCache.get(messages);
  if (!byLive) {
    byLive = new Map();
    turnsCache.set(messages, byLive);
  }
  const key = live.length ? live : null;
  const hit = byLive.get(key);
  if (hit) return hit;
  const built = buildTurnsUncached(messages, live);
  byLive.set(key, built);
  return built;
}

/**
 * A cheap content signature of the *work* in a turn log — the tool calls and
 * their results, not the prose. The changes, canvas and task panels derive
 * from this and only from this, so keying their memos on it means a streaming
 * answer (pure text) no longer re-renders them at all.
 */
export function toolSignature(turns: TurnView[]): string {
  let out = String(turns.length);
  for (const turn of turns) {
    // whether a turn has spoken at all matters to the canvas caption; it flips
    // once per turn, not once per token
    out += `|${turn.toolRuns.length}${turn.fullText ? "t" : "-"}`;
    for (const run of turn.toolRuns) {
      out += `${run.status === "running" ? "r" : run.status === "error" ? "e" : "d"}${run.add ?? ""}.${run.del ?? ""}`;
    }
  }
  return out;
}

function buildTurnsUncached(messages: ChatMessage[], live: ToolActivity[]): TurnView[] {
  const turns: TurnView[] = [];
  let current: TurnView | null = null;
  const runsById = new Map<string, ToolRun>();

  /** Append one beat to the turn's timeline, merging with the previous beat
   *  when it is the same kind — consecutive tool calls stay one group. */
  const appendItem = (turn: TurnView, item: TurnItem): void => {
    const last = turn.items.at(-1);
    if (last && last.kind === item.kind) {
      if (last.kind === "thinking" && item.kind === "thinking") {
        last.text = last.text ? `${last.text}\n\n${item.text}` : item.text;
      } else if (last.kind === "text" && item.kind === "text") {
        last.text = last.text ? `${last.text}\n${item.text}` : item.text;
      } else if (last.kind === "tools" && item.kind === "tools") {
        last.runs.push(...item.runs);
      }
      return;
    }
    turn.items.push(item);
  };

  // a turn's fork address is the count of prompts before it
  let promptCount = 0;
  const ensure = (timestamp: number, key: string): TurnView => {
    if (current) return current;
    current = {
      key,
      userIndex: Math.max(0, promptCount - 1),
      timestamp,
      fullText: "",
      toolRuns: [],
      items: [],
      lead: "",
      endedAt: timestamp,
      sources: [],
      followUps: [],
      streaming: false,
      notes: [],
    };
    turns.push(current);
    return current;
  };

  for (const message of messages) {
    if (message.role === "user") {
      current = {
        key: message.key,
        userIndex: promptCount,
        timestamp: message.timestamp,
        prompt: message.text,
        fullText: "",
        toolRuns: [],
        items: [],
        lead: "",
        endedAt: message.timestamp,
        sources: [],
        followUps: [],
        streaming: false,
        notes: [],
      };
      turns.push(current);
      promptCount += 1;
      continue;
    }

    if (message.role === "custom" && message.customType === TASK_BOUNDARY) {
      /* Start the next task here. `promptCount` deliberately does not move: the
       * boundary is not a prompt, so fork/rewind addresses stay the ones the
       * user's own turns have always had. */
      current = {
        key: message.key,
        userIndex: Math.max(0, promptCount - 1),
        timestamp: message.timestamp,
        boundary: message.text,
        fullText: "",
        toolRuns: [],
        items: [],
        lead: "",
        endedAt: message.timestamp,
        sources: [],
        followUps: [],
        streaming: false,
        notes: [],
      };
      turns.push(current);
      continue;
    }

    if (message.role === "compaction" || message.role === "branch") {
      const turn = ensure(message.timestamp, message.key);
      turn.notes.push({ text: message.text, tone: message.role });
      continue;
    }

    if (message.role === "toolResult") {
      const turn = ensure(message.timestamp, message.key);
      turn.endedAt = message.timestamp;
      const run = message.toolCallId ? runsById.get(message.toolCallId) : undefined;
      const rebuilt = buildToolRun(
        message.toolName ?? "tool",
        // reuse the arguments captured from the toolCall block
        run?.args,
        message.text,
        message.toolDetails,
        message.isError ? "error" : "done",
        message.toolCallId ?? message.key,
      );
      if (run) {
        Object.assign(run, rebuilt);
      } else {
        // a result whose call block never reached us (history resumed mid-turn):
        // it still needs a timeline home, appended to the latest tool group
        turn.toolRuns.push(rebuilt);
        runsById.set(rebuilt.toolCallId, rebuilt);
        appendItem(turn, { kind: "tools", key: rebuilt.toolCallId, runs: [rebuilt], at: message.timestamp });
      }
      const harvested = harvestSources(message.text);
      if (harvested.length) {
        const seen = new Set(turn.sources.map((source) => source.domain));
        for (const source of harvested) {
          if (!seen.has(source.domain)) turn.sources.push(source);
        }
      }
      continue;
    }

    if (message.role === "bashExecution") {
      const turn = ensure(message.timestamp, message.key);
      turn.endedAt = message.timestamp;
      /* The command goes in where the arguments go, so the row's chip is the
         command and its detail is what it printed. Both halves used to arrive
         fused in `message.text`, which put `$ ls -la …` in the summary chip and
         left the literal English word "command" in its place. */
      const meta = (message.toolDetails ?? {}) as { command?: string; output?: string };
      const command = meta.command ?? "";
      const output = meta.output ?? message.text.replace(/^\$ [^\n]*\n?/, "");
      const run = buildToolRun("bash", command ? { command } : undefined, output, undefined, "done", message.key);
      turn.toolRuns.push(run);
      appendItem(turn, { kind: "tools", key: run.toolCallId, runs: [run], at: message.timestamp });
      continue;
    }

    if (message.role !== "assistant") continue;

    const turn = ensure(message.timestamp, message.key);
    turn.endedAt = message.timestamp;
    // Blocks arrive in production order; flush pending prose at every
    // thinking/tool boundary so the timeline keeps that order.
    let prose = "";
    const flushProse = (fallback = ""): void => {
      const body = prose || fallback;
      prose = "";
      if (!body.trim()) return;
      appendItem(turn, { kind: "text", key: `${message.key}-x${turn.items.length}`, text: body, at: message.timestamp });
      turn.fullText = turn.fullText ? `${turn.fullText}\n\n${body}` : body;
      if (!turn.lead) turn.lead = body;
    };
    for (const block of message.blocks) {
      if (block.type === "thinking") {
        flushProse();
        appendItem(turn, {
          kind: "thinking",
          key: `${message.key}-t${turn.items.length}`,
          text: block.text,
          at: message.timestamp,
        });
      } else if (block.type === "toolCall") {
        flushProse();
        const run = buildToolRun(block.name, block.arguments, undefined, undefined, "running", block.id);
        turn.toolRuns.push(run);
        runsById.set(block.id, run);
        appendItem(turn, { kind: "tools", key: block.id, runs: [run], at: message.timestamp });
      } else if (block.type === "text") {
        prose = prose ? `${prose}\n${block.text}` : block.text;
      }
    }
    // a message with no text block still carries its prose in `text`
    flushProse(message.blocks.some((block) => block.type === "text") ? "" : message.text);
    if (message.streaming) turn.streaming = true;
    if (message.usage) turn.usage = message.usage;
  }

  // live tools that have not reached the transcript yet. The id check is
  // global, not per-turn: a finished activity that lingers in the host's
  // activity table must never be re-attached to the turn that follows it.
  if (live.length) {
    const turn =
      current ??
      ensure(Date.now(), `live-${live[0].toolCallId}`);
    for (const activity of live) {
      if (runsById.has(activity.toolCallId)) continue;
      if (turn.toolRuns.some((run) => run.toolCallId === activity.toolCallId)) continue;
      const run = buildLiveToolRun(activity);
      turn.toolRuns.push(run);
      appendItem(turn, { kind: "tools", key: run.toolCallId, runs: [run], at: activity.startedAt ?? Date.now() });
    }
    if (!current) turn.streaming = true;
  }

  /* how long each reasoning beat took: from the message that produced it to
   * the next beat (or the end of the turn) — the "Thought 20s" line both
   * Cursor and Zed put on a settled trace */
  for (const turn of turns) {
    turn.items.forEach((item, index) => {
      if (item.kind !== "thinking") return;
      const next = turn.items[index + 1];
      item.durationMs = Math.max(0, (next?.at ?? turn.endedAt) - item.at);
    });
  }

  return turns;
}

/** A run of a diff line: `change` marks the part of it that actually changed. */
export type DiffPiece = { text: string; change?: "add" | "del" };
/** One row of the diff `CodeBlock` renders. */
export type DiffRowView = {
  old: number | null;
  cur: number | null;
  type: "add" | "del" | "ctx";
  pieces: DiffPiece[];
};

/** Words, whitespace, single punctuation — and whole quoted strings, so that
 *  `"-14C"` against `"-16C"` washes the literal and not the quote marks. */
const DIFF_TOKEN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|[A-Za-z0-9_$]+|\s+|[^\s]/g;

/** One replaced line, split into shared head / changed middle / shared tail. */
function splitChange(before: string, after: string): { del: DiffPiece[]; add: DiffPiece[] } {
  const a = before.match(DIFF_TOKEN) ?? [];
  const b = after.match(DIFF_TOKEN) ?? [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;

  /* An edit that kept little of the old line is a rewrite, not an edit: washing
     three scattered words would read as noise, so the row tint carries it. */
  if (head + tail < Math.min(a.length, b.length) * 0.4) {
    return { del: [{ text: before }], add: [{ text: after }] };
  }

  const cut = (tokens: string[], change: "add" | "del"): DiffPiece[] => {
    const out: DiffPiece[] = [];
    if (head) out.push({ text: tokens.slice(0, head).join("") });
    const middle = tokens.slice(head, tokens.length - tail).join("");
    if (middle) out.push({ text: middle, change });
    if (tail) out.push({ text: tokens.slice(tokens.length - tail).join("") });
    return out;
  };
  return { del: cut(a, "del"), add: cut(b, "add") };
}

/** Pair each run of removals with the additions that replaced it, so the words
 *  that survived the edit are not washed as though they had changed. */
function markChangedWords(rows: DiffRowView[]): DiffRowView[] {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].type !== "del") continue;
    let delEnd = i;
    while (delEnd < rows.length && rows[delEnd].type === "del") delEnd += 1;
    let addEnd = delEnd;
    while (addEnd < rows.length && rows[addEnd].type === "add") addEnd += 1;

    const pairs = Math.min(delEnd - i, addEnd - delEnd);
    for (let k = 0; k < pairs; k += 1) {
      const before = rows[i + k].pieces.map((piece) => piece.text).join("");
      const after = rows[delEnd + k].pieces.map((piece) => piece.text).join("");
      const split = splitChange(before, after);
      rows[i + k].pieces = split.del;
      rows[delEnd + k].pieces = split.add;
    }
    i = addEnd - 1;
  }
  return rows;
}

/** Parsed diff lines → the row shape `CodeBlock` renders in Diff view.
 *
 * The parser already resolved every line's old/new number from the hunk headers,
 * so the rows carry that straight through. Recomputing them here is what made a
 * change at line 35 show up as 35 in a single-hunk patch and 38 in a multi-hunk
 * one — the second hunk's numbers restarted from where the first one ended. */
export function toDiffRows(lines: DiffLine[]): DiffRowView[] {
  let oldLine = 0;
  let curLine = 0;
  const rows = lines.map((line) => {
    // fall back to counting only for callers that pass bare {text, tone}
    if (line.old === undefined && line.cur === undefined) {
      if (line.tone === "add") curLine += 1;
      else if (line.tone === "del") oldLine += 1;
      else {
        oldLine += 1;
        curLine += 1;
      }
      return {
        old: line.tone === "add" ? null : oldLine,
        cur: line.tone === "del" ? null : curLine,
        type: line.tone,
        pieces: [{ text: line.text }],
      };
    }
    return {
      old: line.old ?? null,
      cur: line.cur ?? null,
      type: line.tone,
      pieces: [{ text: line.text }],
    };
  });
  return markChangedWords(rows);
}
