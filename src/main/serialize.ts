import type { ChatBlock, ChatMessage, ModelInfo, SessionListItem, SessionStatus } from "@shared/types";

/** Structural stand-in for pi's message type (kept local so the desktop build
 *  does not depend on pi's nested workspace packages). */
type AgentMessageLike = unknown;

interface ModelLike {
  id: string;
  name: string;
  provider: string;
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

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const item = asRecord(block);
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "thinking" && typeof item.thinking === "string") return item.thinking;
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

  if (role === "toolResult") {
    chat.toolName = typeof record.toolName === "string" ? record.toolName : undefined;
    chat.toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
    chat.isError = Boolean(record.isError);
    chat.toolDetails = record.details;
    if (!chat.text) chat.text = textFromContent(record.content);
  }

  if (role === "bashExecution") {
    const command = typeof record.command === "string" ? record.command : "";
    const output = typeof record.output === "string" ? record.output : "";
    chat.text = command ? `$ ${command}\n${output}` : output;
    chat.toolName = "bash";
  }

  if (typeof usage.input === "number" || typeof usage.output === "number") {
    chat.usage = {
      input: Number(usage.input ?? 0),
      output: Number(usage.output ?? 0),
      total: Number(usage.totalTokens ?? Number(usage.input ?? 0) + Number(usage.output ?? 0)),
      cacheRead: Number(usage.cacheRead ?? 0),
      model: typeof record.model === "string" ? record.model : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
    };
  }

  return chat;
}

export function serializeMessages(messages: readonly unknown[], streamingMessage?: unknown): ChatMessage[] {
  const items = messages.map((message, index) => serializeMessage(message, index));
  if (streamingMessage) {
    items.push(serializeMessage(streamingMessage, items.length, true));
  }
  return items;
}

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function thinkingLevelsFor(model: ModelLike): string[] {
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  if (!map) return LEVELS;
  const levels = LEVELS.filter((level) => level === "off" || map[level] === undefined || map[level] !== null);
  return levels.length ? levels : ["off"];
}

export function serializeModel(model: ModelLike | null | undefined): ModelInfo | null {
  if (!model) return null;
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    providerName: model.provider,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: Boolean(model.reasoning),
    input: model.input ?? ["text"],
    supportsImages: (model.input ?? []).includes("image"),
    thinkingLevels: thinkingLevelsFor(model),
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
