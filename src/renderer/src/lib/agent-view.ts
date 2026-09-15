import type { ChatMessage, ToolActivity } from "@shared/types";

/* ─────────────────────────────────────────────────────────
 * Agent view model
 *
 * Turns the raw message log into the shapes the Beautiful UI primitives
 * expect: a thinking trace with the right variant, tool runs with diff
 * chips, an answer split into prose and code, and cited sources.
 * ───────────────────────────────────────────────────────── */

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
  /** assistant segments (prose + code fences) */
  segments: TextSegment[];
  /** assistant plain text, used for the streaming pass */
  fullText: string;
  thinking: string;
  toolRuns: ToolRun[];
  traceVariant: TraceVariant | null;
  sources: { name: string; domain: string; href: string; image: string }[];
  followUps: string[];
  streaming: boolean;
  usage?: ChatMessage["usage"];
  error?: boolean;
  notes: { text: string; tone: "compaction" | "branch" }[];
}

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
  };

  switch (name) {
    case "read": {
      run.label = "Read";
      run.chip = file ? `${baseName(file)}${pickString(input, ["offset"]) ? `:${input.offset}` : ""}` : "(no path)";
      break;
    }
    case "write": {
      run.label = "Write";
      const content = pickString(input, ["content"]) ?? "";
      const lineCount = content ? content.split("\n").length : 0;
      run.label = lineCount ? `Write ${lineCount} lines` : "Write";
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
      run.label = "Edit";
      run.chip = file ? baseName(file) : "(no path)";
      const patch = typeof meta.patch === "string" ? meta.patch : typeof meta.diff === "string" ? meta.diff : "";
      if (patch) {
        const parsed = parseUnifiedDiff(patch, 40);
        run.diffLines = parsed.lines;
        run.add = parsed.add;
        run.del = parsed.del;
        run.label = `Edit ${baseName(file ?? "file")}`;
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
    case "powershell": {
      run.label = icon === "run" ? "Run" : name;
      run.chip = target ? truncate(target) : "command";
      run.detailMono = true;
      if (resultText) {
        run.detail = resultText
          .split("\n")
          .filter(Boolean)
          .slice(0, 4)
          .map((text) => ({ text: truncate(text, 90) }));
      }
      break;
    }
    case "grep":
    case "find": {
      run.label = name === "grep" ? "Search" : "Find";
      run.chip = target ? truncate(target, 40) : "pattern";
      const hits = resultText ? resultText.split("\n").filter(Boolean).length : 0;
      if (hits) run.detail = [{ text: `${hits} matching lines` }];
      break;
    }
    case "ls": {
      run.label = "List";
      run.chip = file ? baseName(file) : ".";
      const entries = resultText ? resultText.split("\n").filter(Boolean).length : 0;
      if (entries) run.detail = [{ text: `${entries} entries` }];
      break;
    }
    default: {
      if (SEARCH_TOOLS.has(name)) {
        run.label = "Search the web";
        run.chip = target ? truncate(target, 40) : "web";
      } else {
        run.label = name;
        run.chip = target ? truncate(target, 40) : "call";
      }
      break;
    }
  }

  if (!run.chip) run.chip = target ? truncate(target, 40) : name;
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

function thinkingVariant(thinking: string): TraceVariant | null {
  // The trace carries the *thinking*, and nothing else. Tool calls used to be
  // listed here as well (Coding / Steps / Search rows), which printed the same
  // Read / Edit / Run rows a second time — once in the trace and again in the
  // tool run below it. Those rows now live in `buildToolGroups`, collapsed.
  return thinking.trim() ? "Reasoning" : null;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Which summary row a call belongs to: file edits, exploration, or anything else. */
function bucketOf(run: ToolRun): ToolBucket {
  if (WRITE_TOOLS.has(run.toolName)) return "edit";
  if (READ_TOOLS.has(run.toolName) || SEARCH_TOOLS.has(run.toolName) || COMMAND_TOOLS.has(run.toolName)) {
    return "explore";
  }
  return "other";
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
  const groups: ToolGroupView[] = [];

  for (const run of turn.toolRuns) {
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
  if (runs.length === 1) {
    const run = runs[0];
    return run.chip && !run.label.includes(run.chip) ? `${run.label} ${run.chip}` : run.label;
  }

  if (bucket === "edit") {
    if (group.files === 1) {
      const name = (runs.find((run) => run.path)?.path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      if (name) return `Edited ${name} ×${runs.length}`;
    }
    return `Edited ${plural(group.files || runs.length, "file")}`;
  }

  if (bucket === "other") return `${plural(runs.length, "call")}`;

  const parts: string[] = [];
  if (group.files) parts.push(plural(group.files, "file"));
  if (group.searches) parts.push(plural(group.searches, "search", "searches"));
  if (group.commands) parts.push(`ran ${plural(group.commands, "command")}`);
  if (!parts.length) return "Explored";
  if (!group.files && !group.searches) return `Ran ${plural(group.commands, "command")}`;
  return `Explored · ${parts.join(", ")}`;
}

/** Rows for the ThinkingState trace — the reasoning prose, nothing else. */
export function traceRows(turn: TurnView): { id?: string; primary: string; secondary?: string; mono?: boolean; add?: number; del?: number; href?: string }[] {
  if (turn.traceVariant === "Reasoning") {
    return turn.thinking
      .split(/\n{2,}/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((primary, index) => ({ id: `reason-${index}`, primary }));
  }
  if (turn.traceVariant === "Search") {
    return turn.sources.map((source) => ({
      id: source.domain,
      primary: source.name,
      secondary: source.domain,
      href: source.href,
    }));
  }
  return turn.toolRuns.map((run) => ({
    id: run.toolCallId || `${run.toolName}-${run.chip}`,
    primary: run.label,
    secondary: run.chip,
    mono: run.mono,
    add: run.add,
    del: run.del,
  }));
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
export function buildTurns(messages: ChatMessage[], live: ToolActivity[]): TurnView[] {
  const turns: TurnView[] = [];
  let current: TurnView | null = null;
  const runsById = new Map<string, ToolRun>();

  // a turn's fork address is the count of prompts before it
  let promptCount = 0;
  const ensure = (timestamp: number, key: string): TurnView => {
    if (current) return current;
    current = {
      key,
      userIndex: Math.max(0, promptCount - 1),
      timestamp,
      segments: [],
      fullText: "",
      thinking: "",
      toolRuns: [],
      traceVariant: null,
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
        segments: [],
        fullText: "",
        thinking: "",
        toolRuns: [],
        traceVariant: null,
        sources: [],
        followUps: [],
        streaming: false,
        notes: [],
      };
      turns.push(current);
      promptCount += 1;
      continue;
    }

    if (message.role === "compaction" || message.role === "branch") {
      const turn = ensure(message.timestamp, message.key);
      turn.notes.push({ text: message.text, tone: message.role });
      continue;
    }

    if (message.role === "toolResult") {
      const turn = ensure(message.timestamp, message.key);
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
        turn.toolRuns.push(rebuilt);
        runsById.set(rebuilt.toolCallId, rebuilt);
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
      turn.toolRuns.push(
        buildToolRun("bash", undefined, message.text, undefined, "done", message.key),
      );
      continue;
    }

    if (message.role !== "assistant") continue;

    const turn = ensure(message.timestamp, message.key);
    for (const block of message.blocks) {
      if (block.type === "thinking") {
        turn.thinking = turn.thinking ? `${turn.thinking}\n\n${block.text}` : block.text;
      } else if (block.type === "toolCall") {
        const run = buildToolRun(block.name, block.arguments, undefined, undefined, "running", block.id);
        turn.toolRuns.push(run);
        runsById.set(block.id, run);
      }
    }
    const text = message.blocks
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    const body = text || message.text;
    if (body) {
      turn.fullText = turn.fullText ? `${turn.fullText}\n\n${body}` : body;
    }
    if (message.streaming) turn.streaming = true;
    if (message.usage) turn.usage = message.usage;
  }

  // live tools that have not reached the transcript yet
  if (live.length) {
    const turn =
      current ??
      ensure(Date.now(), `live-${live[0].toolCallId}`);
    for (const activity of live) {
      if (turn.toolRuns.some((run) => run.toolCallId === activity.toolCallId)) continue;
      turn.toolRuns.push(buildLiveToolRun(activity));
    }
    if (!current) turn.streaming = true;
  }

  for (const turn of turns) {
    turn.segments = splitSegments(turn.fullText);
    turn.traceVariant = thinkingVariant(turn.thinking);
    if (turn.traceVariant === "Search") {
      turn.followUps = [];
    }
  }

  return turns;
}

/** Which ThinkingState variant fits the run, falling back to the step list. */
export function traceLabel(variant: TraceVariant | null, streaming: boolean, count: number): { active: string; done: string } {
  switch (variant) {
    case "Search":
      return { active: "Searching the web", done: `Searched the web` };
    case "Coding":
      return { active: "Running tools", done: `Ran ${count} tool${count === 1 ? "" : "s"}` };
    case "Reasoning":
      return { active: "Thinking", done: streaming ? "Thinking" : "Thought" };
    case "Steps":
      return { active: "Thinking", done: `Thought · ${count} steps` };
    default:
      return { active: "Thinking", done: "Thought" };
  }
}

/** Parsed diff lines → the row shape `CodeBlock` renders in Diff view.
 *
 * The parser already resolved every line's old/new number from the hunk headers,
 * so the rows carry that straight through. Recomputing them here is what made a
 * change at line 35 show up as 35 in a single-hunk patch and 38 in a multi-hunk
 * one — the second hunk's numbers restarted from where the first one ended. */
export function toDiffRows(lines: DiffLine[]): {
  old: number | null;
  cur: number | null;
  type: "add" | "del" | "ctx";
  pieces: { text: string }[];
}[] {
  let oldLine = 0;
  let curLine = 0;
  return lines.map((line) => {
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
}
