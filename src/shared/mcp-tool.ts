/**
 * MCP calls, as the transcript displays them.
 *
 * pi exposes each MCP tool under a wire name — `mcp__<server>__<tool>`, with
 * every character outside `[A-Za-z0-9_]` folded to `_` and over-long names cut
 * with a hash suffix — and repeats the configured names on the result's
 * `details`. Both are read here, details first: they are the only copy that
 * survives pi's sanitising, so a name like `mcp__a_b__a_b_read` still renders
 * the server and tool the user configured.
 *
 * Results are shaped for the row, not for the model: pi's already-assembled
 * text is told apart as JSON or plain text, content blocks become image and
 * resource rows, and every list carries a bound plus the count it hid. Parsing
 * is memoised because the transcript re-renders on every streamed token, and a
 * long MCP result is the one thing in a tool row that must not be re-parsed
 * each time. The API stays free of React and i18n so the regression script can
 * drive it from plain node.
 */

/** A wire tool name split back into the names the user configured. */
export interface McpToolIdentity {
  server: string;
  tool: string;
}

/**
 * `mcp__server__tool` → its two halves, or `null` for any other tool.
 *
 * The separator is the *first* `__` after the prefix, the same rule pi's own
 * namespace scan uses — a server name may itself contain a single underscore,
 * so splitting on the last separator would invent names that never existed.
 */
export function parseMcpToolName(wireName: string): McpToolIdentity | null {
  if (!wireName.startsWith("mcp__")) return null;
  const rest = wireName.slice("mcp__".length);
  const at = rest.indexOf("__");
  if (at <= 0) return null;
  const tool = rest.slice(at + 2);
  if (!tool) return null;
  return { server: rest.slice(0, at), tool };
}

/** pi's result details: `{ server, tool, fullOutputPath? }` and nothing else it guarantees. */
export function mcpIdentityFromDetails(details: unknown): McpToolIdentity | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  const server = typeof record.server === "string" ? record.server.trim() : "";
  const tool = typeof record.tool === "string" ? record.tool.trim() : "";
  if (!server || !tool) return null;
  return { server, tool };
}

/** Details win over the wire name — see the module comment. */
export function mcpToolIdentity(wireName: string, details?: unknown): McpToolIdentity | null {
  return mcpIdentityFromDetails(details) ?? parseMcpToolName(wireName);
}

/** `read_file` → `Read file`. Identifiers read as words, not as shouting. */
export function mcpDisplayWords(value: string): string {
  const words = value.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (!words) return value;
  return words[0].toUpperCase() + words.slice(1);
}

/**
 * The server, as the row's label says it.
 *
 * A namespaced key (`plugin:<plugin>:<server>`, which some MCP hosts mint) would
 * put internal routing text on screen, so only its last segment is shown.
 */
export function mcpServerLabel(server: string): string {
  const segments = server
    .split(":")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const display =
    segments.length > 1 && segments[0].toLowerCase() === "plugin" ? segments[segments.length - 1] : server;
  return mcpDisplayWords(display);
}

/**
 * The tool, with a server prefix the server itself repeated removed.
 *
 * MCP servers commonly namespace their own tools again (`firebase` offering
 * `firebase_get_environment`); the row already names the server, so repeating it
 * reads as a stutter. The match is mechanical — case and separators — and never
 * guesses beyond that.
 */
export function mcpActionLabel(tool: string, serverLabel: string): string {
  const formatted = mcpDisplayWords(tool);
  const prefix = `${serverLabel} `;
  return formatted.toLowerCase().startsWith(prefix.toLowerCase())
    ? mcpDisplayWords(formatted.slice(prefix.length))
    : formatted;
}

/** Keys whose value says the most about what a call was about, in that order. */
const ARG_KEYS = [
  "query",
  "path",
  "file_path",
  "filePath",
  "url",
  "uri",
  "command",
  "pattern",
  "name",
  "id",
  "prompt",
  "message",
  "text",
  "title",
];

const digestValue = (value: unknown): string => {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

/** One line from the call's arguments, for the row's chip. */
export function mcpArgDigest(args: unknown, max = 48): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length) return "";

  const preferred = keys.length === 1 ? keys : ARG_KEYS.filter((key) => key in record);
  let value = "";
  for (const key of preferred) {
    value = digestValue(record[key]);
    if (value) break;
  }
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Bounded text: what to render, and how many lines did not fit. */
export interface McpTextBlock {
  /** The full text, kept for the clipboard — never shortened here. */
  text: string;
  lines: string[];
  more: number;
}

/**
 * The arguments as pretty JSON, memoised on the arguments object itself.
 *
 * `run.args` is the message's own object, so its identity is stable while the
 * transcript re-renders per token; stringifying a large argument payload on
 * every render is exactly the repeated work this module exists to avoid.
 */
const argsCache = new WeakMap<object, McpTextBlock>();

function argsBlock(args: unknown): McpTextBlock | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  if (!Object.keys(record).length) return undefined;
  const cached = argsCache.get(record);
  if (cached) return cached;
  const block = textBlock(JSON.stringify(record, null, 2), MCP_ARG_LINE_LIMIT);
  argsCache.set(record, block);
  return block;
}

/** Cut-off points. A row the user opened scrolls; it does not render a whole log. */
export const MCP_LINE_LIMIT = 120;
export const MCP_ARG_LINE_LIMIT = 24;

function textBlock(text: string, limit = MCP_LINE_LIMIT): McpTextBlock {
  const all = text.length ? text.split("\n") : [];
  const lines = all.length > limit ? all.slice(0, limit) : all;
  return { text, lines, more: all.length - lines.length };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A JSON object or array, pretty-printed; `undefined` for anything else. */
function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** One block of an MCP result, after display shaping. */
export type McpResultSection =
  | ({ kind: "error" } & McpTextBlock)
  | ({ kind: "json" } & McpTextBlock)
  | ({ kind: "text" } & McpTextBlock)
  | { kind: "image"; mimeType: string; src: string }
  | { kind: "resource"; uri: string; label: string; mimeType?: string; description?: string; text?: string }
  | { kind: "notice"; text: string };

export interface McpResultInput {
  /** pi's joined text blocks — what the transcript carries as `text` */
  resultText?: string;
  /** pi's result details; `content` is read when a host forwards it */
  details?: unknown;
  isError?: boolean;
  /** raw `content` blocks, when the host forwards them. Images and blob
   *  resources cannot be reconstructed from text, so without them they are
   *  simply not shown. */
  content?: unknown;
}

function textSections(text: string): McpResultSection[] {
  const json = parseJson(text);
  if (json !== undefined) {
    const pretty = JSON.stringify(json, null, 2);
    return [{ kind: "json", ...textBlock(pretty) }];
  }
  return text.length ? [{ kind: "text", ...textBlock(text) }] : [];
}

function imageSection(block: Record<string, unknown>): McpResultSection | null {
  const source = asRecord(block.source);
  const mimeType =
    typeof block.mimeType === "string"
      ? block.mimeType
      : typeof block.media_type === "string"
        ? block.media_type
        : typeof source.media_type === "string"
          ? source.media_type
          : "image/png";
  const data = typeof block.data === "string" ? block.data : typeof source.data === "string" ? source.data : "";
  const url = typeof block.url === "string" ? block.url : "";
  if (!data && !url) return null;
  const src = data ? (data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`) : url;
  return { kind: "image", mimeType, src };
}

function resourceSection(block: Record<string, unknown>, linked: boolean): McpResultSection | null {
  const resource = linked ? block : asRecord(block.resource);
  const uri = typeof resource.uri === "string" ? resource.uri : "";
  if (!uri) return null;
  const label =
    (typeof resource.title === "string" && resource.title) ||
    (typeof resource.name === "string" && resource.name) ||
    uri;
  const mimeType = typeof resource.mimeType === "string" ? resource.mimeType : undefined;
  const description = typeof resource.description === "string" ? resource.description : undefined;
  const text = typeof resource.text === "string" ? resource.text : undefined;
  return { kind: "resource", uri, label, mimeType, description, text };
}

/** Blocks pi (or a host forwarding them verbatim) put on a result. */
function contentSections(content: readonly unknown[]): McpResultSection[] {
  const sections: McpResultSection[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (block.type === "text" && typeof block.text === "string") {
      sections.push(...textSections(block.text));
    } else if (block.type === "image") {
      const image = imageSection(block);
      sections.push(image ?? { kind: "notice", text: "" });
    } else if (block.type === "resource") {
      const resource = resourceSection(block, false);
      if (resource) sections.push(resource);
    } else if (block.type === "resource_link") {
      const link = resourceSection(block, true);
      if (link) sections.push(link);
    }
  }
  return sections;
}

const textOfBlocks = (content: readonly unknown[]): string =>
  content
    .map((raw) => {
      const block = asRecord(raw);
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");

/**
 * The bounded, memoised parse behind one MCP row.
 *
 * `owner` is an object whose identity the result is tied to (a forwarded content
 * array, or a details object carrying opaque state); caching under it means a
 * fresh object never reuses a stale parse. Everything else is keyed by the
 * scalar inputs themselves.
 */
function resultCacheKey(input: McpResultInput): { owner: object | null; key: string } {
  const scalar = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
  const flag = input.isError ? "e" : "d";
  if (Array.isArray(input.content)) return { owner: input.content, key: flag };

  const details = input.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    if (Array.isArray(record.content)) return { owner: record.content, key: flag };
    const names = `${scalar(record.server)}|${scalar(record.tool)}|${scalar(record.fullOutputPath)}`;
    if (record.structuredContent !== undefined) {
      return { owner: details, key: `${flag}\u0000${scalar(input.resultText)}\u0000${names}` };
    }
    return { owner: null, key: `${flag}\u0000${scalar(input.resultText)}\u0000${names}` };
  }
  return { owner: null, key: `${flag}\u0000${scalar(input.resultText)}\u0000${scalar(details)}` };
}

const RESULT_CACHE_LIMIT = 200;
const resultCache = new Map<string, McpResultSection[]>();
const ownerCache = new WeakMap<object, Map<string, McpResultSection[]>>();

function buildSections(input: McpResultInput): McpResultSection[] {
  const content = Array.isArray(input.content)
    ? input.content
    : Array.isArray(asRecord(input.details).content)
      ? (asRecord(input.details).content as unknown[])
      : undefined;

  if (input.isError) {
    /* pi turns `isError` results into error content, so the text is the server's
       own failure message; the red surface carries it and the non-text blocks
       (a screenshot of the failure) follow it. */
    const text = input.resultText?.trim() ? input.resultText : content ? textOfBlocks(content) : "";
    const error: McpResultSection[] = [{ kind: "error", ...textBlock(text) }];
    if (content) {
      for (const section of contentSections(content)) {
        if (section.kind !== "text" && section.kind !== "json") error.push(section);
      }
    }
    return error;
  }

  if (content) return contentSections(content);
  return input.resultText ? textSections(input.resultText) : [];
}

/** See {@link McpResultInput}. */
export function mcpResultSections(input: McpResultInput): McpResultSection[] {
  const { owner, key } = resultCacheKey(input);
  if (owner) {
    let map = ownerCache.get(owner);
    if (!map) {
      map = new Map();
      ownerCache.set(owner, map);
    }
    const hit = map.get(key);
    if (hit) return hit;
    const built = buildSections(input);
    map.set(key, built);
    return built;
  }

  const hit = resultCache.get(key);
  if (hit) return hit;
  const built = buildSections(input);
  if (resultCache.size >= RESULT_CACHE_LIMIT) {
    let dropped = 0;
    for (const cached of resultCache.keys()) {
      resultCache.delete(cached);
      dropped += 1;
      if (dropped >= Math.ceil(RESULT_CACHE_LIMIT / 4)) break;
    }
  }
  resultCache.set(key, built);
  return built;
}

export interface McpCallInput {
  toolName: string;
  args?: unknown;
  resultText?: string;
  details?: unknown;
  isError?: boolean;
  content?: unknown;
}

/** Everything the transcript row needs for one MCP call. */
export interface McpCallDisplay {
  server: string;
  tool: string;
  /** friendly server name — the row's label */
  serverLabel: string;
  /** friendly tool name — the row's chip, with the arg digest when there is one */
  actionLabel: string;
  chip: string;
  /** the wire name, for the row's tooltip */
  wireName: string;
  sections: McpResultSection[];
  /** the call's arguments as pretty JSON, when it has any */
  args?: McpTextBlock;
  /** pi saved a truncated middle here; the row points at the file */
  fullOutputPath?: string;
}

/** `null` for anything that is not an MCP tool. */
export function mcpCallDisplay(input: McpCallInput): McpCallDisplay | null {
  const identity = mcpToolIdentity(input.toolName, input.details);
  if (!identity) return null;

  const serverLabel = mcpServerLabel(identity.server);
  const actionLabel = mcpActionLabel(identity.tool, serverLabel);
  const digest = mcpArgDigest(input.args);
  const args = argsBlock(input.args);
  const details = asRecord(input.details);

  return {
    server: identity.server,
    tool: identity.tool,
    serverLabel,
    actionLabel,
    chip: digest ? `${actionLabel} · ${digest}` : actionLabel,
    wireName: input.toolName,
    sections: mcpResultSections(input),
    ...(args ? { args } : {}),
    ...(typeof details.fullOutputPath === "string" ? { fullOutputPath: details.fullOutputPath } : {}),
  };
}
