import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";

export type { McpExposure, McpServerConfig };

/**
 * The MCP server shape, as the main process hands it to the window.
 *
 * pi's own `McpServerConfig` is reused rather than restated — it is the format
 * `mcp.json` already holds, and any second spelling of it would drift. Only the
 * type is imported, so this file stays loadable from a plain node script.
 */

/** Which `mcp.json` a server is written to. */
export type McpScope = "global" | "project";

export interface McpServerView {
  name: string;
  scope: McpScope;
  /** the file that defines it; a change has to go back to this one */
  file: string;
  config: McpServerConfig;
  /** false only when the entry says `"enabled": false` */
  enabled: boolean;
  /** defaults to `codemode` when the entry does not say */
  exposure: McpExposure;
}

export interface McpConfigView {
  servers: McpServerView[];
  /** entries that could not be read, named by file */
  errors: string[];
  /** the codemode auto-activation switch, global or overridden per project */
  autoEnableCodemode: boolean;
}

/** How a server's tools reach the model, weakest exposure first. */
export const MCP_EXPOSURES: McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

/** pi's name rule, kept in step with it: names reach the model as `mcp__<name>__<tool>`. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** Older exposure names, replaced by their current spelling when validated. */
const MCP_EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = { "codemode-deferred": "codemode" };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && (MCP_EXPOSURES as string[]).includes(value);
}

/** The exposure an alias stands for; other values are returned unchanged. */
function resolveExposureAlias(value: unknown): unknown {
  return typeof value === "string" ? (MCP_EXPOSURE_ALIASES[value] ?? value) : value;
}

function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
  const { exposure, toolExposure } = value;
  const resolved: Record<string, unknown> = { ...value };
  if (exposure !== undefined) resolved.exposure = resolveExposureAlias(exposure);
  if (isRecord(toolExposure)) {
    resolved.toolExposure = Object.fromEntries(
      Object.entries(toolExposure).map(([tool, entry]) => [tool, resolveExposureAlias(entry)]),
    );
  }
  return resolved;
}

/** Whether a redirect URI can be served by pi's loopback callback server. */
function isLoopbackRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname) && url.search === "" && url.hash === "";
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "oauth must be an object";
  if (value.clientId !== undefined && typeof value.clientId !== "string") return "oauth.clientId must be a string";
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
    return "oauth.clientSecret must be a string";
  }
  const port = value.callbackPort;
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    return "oauth.callbackPort must be a port number";
  }
  if (value.callbackUrl !== undefined) {
    if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUri(value.callbackUrl)) {
      return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
    }
    const urlPort = new URL(value.callbackUrl).port;
    if (urlPort && port !== undefined && Number(urlPort) !== port) {
      return "oauth.callbackUrl and oauth.callbackPort name different ports";
    }
  }
  if (value.scope !== undefined && typeof value.scope !== "string") return "oauth.scope must be a string";
  if (value.clientName !== undefined && (typeof value.clientName !== "string" || !value.clientName.trim())) {
    return "oauth.clientName must be a non-empty string";
  }
  const metadataUrl = value.authServerMetadataUrl;
  if (metadataUrl !== undefined) {
    const url = typeof metadataUrl === "string" && URL.canParse(metadataUrl) ? new URL(metadataUrl) : undefined;
    if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname)))) {
      return "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
    }
  }
  return undefined;
}


/**
 * The rules `mcp.json` entries must satisfy, ported from pi's own
 * `validateMcpServerConfig` (`src/core/mcp-servers.ts` upstream).
 *
 * pi ships the validator but not through the package's public exports, and this
 * app writes the same file the CLI reads — a second, looser set of rules here
 * would let the window store an entry the agent silently refuses to load. The
 * port is deliberately literal, including the error wording, so a regression
 * against this side is a regression against what pi will do with the file.
 */
export function validateMcpServerConfig(name: string, raw: unknown): McpServerConfig | string {
  if (!SERVER_NAME.test(name)) return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if (!isRecord(raw)) return `server "${name}" must be an object`;
  const value = resolveExposureAliases(raw);
  const { type, exposure, enabled, timeout, toolExposure, description } = value;
  const exposures = MCP_EXPOSURES.map((entry) => `"${entry}"`).join(", ");
  if (exposure !== undefined && !isExposure(exposure)) {
    return `server "${name}": exposure must be one of ${exposures}`;
  }
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) return `server "${name}": toolExposure must map tool names to exposures`;
    for (const [tool, entry] of Object.entries(toolExposure)) {
      if (!isExposure(entry)) return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") return `server "${name}": enabled must be a boolean`;
  if (description !== undefined && typeof description !== "string") {
    return `server "${name}": description must be a string`;
  }
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return `server "${name}": timeout must be a positive number of seconds`;
  }
  if (type === "sse") return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;

  if (typeof value.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!URL.canParse(value.url) || !/^https?:$/.test(new URL(value.url).protocol)) {
      return `server "${name}": url must be an http or https URL`;
    }
    if (value.headers !== undefined && !isStringRecord(value.headers)) {
      return `server "${name}": headers must map names to strings`;
    }
    const oauthError = validateOAuth(value.oauth);
    if (oauthError) return `server "${name}": ${oauthError}`;
    if (value.auth !== undefined) {
      if (!isRecord(value.auth) || typeof value.auth.provider !== "string" || !value.auth.provider) {
        return `server "${name}": auth.provider must be a provider name`;
      }
      const url = new URL(value.url);
      if (url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)) {
        return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
      }
    }
    return value as unknown as McpServerConfig;
  }

  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (value.args !== undefined && !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))) {
      return `server "${name}": args must be an array of strings`;
    }
    if (value.env !== undefined && !isStringRecord(value.env)) return `server "${name}": env must map names to strings`;
    if (value.cwd !== undefined && typeof value.cwd !== "string") return `server "${name}": cwd must be a string`;
    return value as unknown as McpServerConfig;
  }

  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

/** Namespace of a server's tools: `mcp__<server>` with `-` replaced by `_`, as pi spells it. */
export function mcpNamespace(server: string): string {
  return `mcp__${server.replace(/-/g, "_")}`;
}

