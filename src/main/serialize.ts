import type { ChatBlock, ChatMessage, ModelInfo, SessionListItem, SessionStatus, UltraMode } from "@shared/types";
import { THINKING_LEVELS } from "../shared/thinking.ts";

/** Structural stand-in for pi's message type (kept local so the desktop build
 *  does not depend on pi's nested workspace packages). */
type AgentMessageLike = unknown;

interface ModelLike {
  id: string;
  name: string;
  provider: string;
  /** the wire protocol the runtime reached this model over */
  api?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input?: string[];
  thinkingLevelMap?: Record<string, string | null>;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

interface SessionInfoLike {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * The message's own prose: text blocks joined, thinking excluded.
 *
 * Thinking content must NOT land here. `text` is the transcript's fallback
 * prose for an assistant message whose blocks carry no text block, and it feeds
 * every preview in the shell (canvas captions, outline rows, session lists);
 * reasoning dumped into it renders a second time as the answer itself — the
 * trace shows it, then the reply repeats it. Reasoning lives in `blocks`.
 */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const item = asRecord(block);
      if (item.type === "text" && typeof item.text === "string") return item.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function blocksFromContent(content: unknown): ChatBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: ChatBlock[] = [];
  for (const raw of content) {
    const item = asRecord(raw);
    if (item.type === "text" && typeof item.text === "string") {
      blocks.push({ type: "text", text: item.text });
    } else if (item.type === "thinking" && typeof item.thinking === "string") {
      blocks.push({ type: "thinking", text: item.thinking });
    } else if (item.type === "toolCall") {
      blocks.push({
        type: "toolCall",
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "tool",
        arguments: asRecord(item.arguments),
      });
    } else if (item.type === "image" && typeof item.mimeType === "string") {
      blocks.push({ type: "image", mimeType: item.mimeType });
    }
  }
  return blocks;
}

export function serializeMessage(message: AgentMessageLike, index: number, streaming = false): ChatMessage {
  const record = asRecord(message);
  const role = typeof record.role === "string" ? record.role : "custom";
  const timestamp = typeof record.timestamp === "number" ? record.timestamp : Date.now();
  const content = "content" in record ? record.content : undefined;
  const roleName = role === "compactionSummary" ? "compaction" : role === "branchSummary" ? "branch" : role;
  const text = textFromContent(content) || (typeof record.summary === "string" ? record.summary : "");
  const usage = asRecord(record.usage);
  const chat: ChatMessage = {
    key: `${roleName}-${timestamp}-${index}`,
    role: roleName as ChatMessage["role"],
    timestamp,
    text,
    blocks: blocksFromContent(content),
    streaming,
  };

  if (role === "custom") {
    /* Custom messages are the only ones an extension labels, and the label is
     * what the transcript keys its turn boundaries on — a `custom` message that
     * lost its type here would be indistinguishable from an anonymous one. */
    chat.customType = typeof record.customType === "string" ? record.customType : undefined;
  }

  if (role === "toolResult") {
    chat.toolName = typeof record.toolName === "string" ? record.toolName : undefined;
    chat.toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
    chat.isError = Boolean(record.isError);
    // MCP images/resources otherwise disappear at the IPC boundary: text-only
    // flattening loses the blocks the card needs. Forward only display content,
    // bounded independently from the SDK message and its model context.
    chat.toolDetails = chat.toolName?.startsWith("mcp__")
      ? toolDisplayDetails(record.details, content)
      : record.details;
    if (!chat.text) chat.text = textFromContent(record.content);
  }

  if (role === "bashExecution") {
    const command = typeof record.command === "string" ? record.command : "";
    const output = typeof record.output === "string" ? record.output : "";
    chat.text = command ? `$ ${command}\n${output}` : output;
    chat.toolName = "bash";
    /* The two halves stay separate on the way out. Flattening them into `text`
       is what made a terminal row render its own command as the summary chip —
       the row wants the command, and the output wants to be the detail you open
       the row to read. */
    chat.toolDetails = { command, output };
  }

  if (typeof usage.input === "number" || typeof usage.output === "number") {
    chat.usage = {
      input: Number(usage.input ?? 0),
      output: Number(usage.output ?? 0),
      total: Number(usage.totalTokens ?? Number(usage.input ?? 0) + Number(usage.output ?? 0)),
      cacheRead: Number(usage.cacheRead ?? 0),
      cacheWrite: Number(usage.cacheWrite ?? 0),
      model: typeof record.model === "string" ? record.model : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
    };
  }

  return chat;
}

export function toolDisplayDetails(details: unknown, content: unknown): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [];
  let budget = 4 * 1024 * 1024;
  for (const raw of Array.isArray(content) ? content.slice(0, 20) : []) {
    const block = asRecord(raw);
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.slice(0, Math.min(budget, 128 * 1024)); budget -= text.length; blocks.push({ type: "text", text });
    } else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string" && /^image\/(?:png|jpeg|gif|webp)$/.test(block.mimeType) && block.data.length <= budget) {
      budget -= block.data.length; blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else if (block.type === "resource_link" && typeof block.uri === "string") {
      blocks.push({ type: "resource_link", uri: block.uri, name: block.name, mimeType: block.mimeType });
    } else if (block.type === "resource") {
      const resource = asRecord(block.resource);
      if (typeof resource.uri === "string") blocks.push({ type: "resource", resource: { uri: resource.uri, mimeType: resource.mimeType, text: typeof resource.text === "string" ? resource.text.slice(0, 128 * 1024) : undefined } });
    }
    if (budget <= 0) break;
  }
  return { ...asRecord(details), content: blocks };
}

export function serializeMessages(messages: readonly unknown[], streamingMessage?: unknown): ChatMessage[] {
  const items = messages.map((message, index) => serializeMessage(message, index));
  if (streamingMessage) {
    items.push(serializeMessage(streamingMessage, items.length, true));
  }
  return items;
}


export function thinkingLevelsFor(model: ModelLike): string[] {
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  if (!map) return THINKING_LEVELS;
  const levels = THINKING_LEVELS.filter((level) => level === "off" || map[level] === undefined || map[level] !== null);
  return levels.length ? levels : ["off"];
}

/**
 * Ultra borrows Max's request — same wire level, longer run — so it is only
 * offered to a model that already has both steps. A model that stops at
 * `xhigh` cannot be promised a depth it has nowhere to send.
 */
export function supportsUltra(levels: readonly string[]): boolean {
  return levels.includes("xhigh") && levels.includes("max");
}

/** Add the desktop's Ultra step to a model's own levels. */
export function withUltra(levels: string[], mode: UltraMode | undefined): string[] {
  if (!mode || !supportsUltra(levels)) return levels;
  return mode === "replace"
    ? levels.map((level) => (level === "max" ? "ultra" : level))
    : levels.flatMap((level) => (level === "max" ? ["max", "ultra"] : [level]));
}

export function serializeModel(model: ModelLike | null | undefined, ultra?: UltraMode): ModelInfo | null {
  if (!model) return null;
  const base = thinkingLevelsFor(model);
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    providerName: model.provider,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: Boolean(model.reasoning),
    input: model.input ?? ["text"],
    supportsImages: (model.input ?? []).includes("image"),
    thinkingLevels: withUltra(base, ultra),
    supportsUltra: supportsUltra(base),
    thinkingLevelMap: model.thinkingLevelMap,
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: model.cost?.cacheRead ?? 0,
      cacheWrite: model.cost?.cacheWrite ?? 0,
    },
    source: "builtin",
  };
}

function firstLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

export function serializeSessionList(
  sessions: readonly SessionInfoLike[],
  activePath?: string,
  streaming = false,
): SessionListItem[] {
  return sessions.map((session) => {
    const isActive = Boolean(activePath && session.path === activePath);
    let status: SessionStatus = "done";
    if (isActive && streaming) status = "running";
    else if (!session.messageCount) status = "idle";
    return {
      path: session.path,
      id: session.id,
      cwd: session.cwd,
      name: session.name,
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: firstLine(session.name || session.firstMessage || "New session"),
      status,
    };
  });
}
