import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import {
  MCP_EXPOSURES,
  mcpNamespace,
  validateMcpServerConfig,
  type McpConfigView,
  type McpScope,
  type McpServerView,
} from "../shared/mcp.ts";

/**
 * `mcp.json` — the file both pi and this app read.
 *
 * pi ships the loader and the writers behind it, but none of them are part of the
 * package's public exports, and SDK sessions are exactly the place pi's own MCP
 * extension does not load on its own. So the documented format is implemented
 * here instead: a top-level `mcpServers` object plus an optional
 * `autoEnableCodemode`, read from the agent directory and, for trusted projects,
 * the project's `.pi/` — where a project entry replaces the global one by name.
 *
 * Reading is this app's own view for the management screen; the session itself
 * still reads the file through pi, so a hand-edited file keeps working.
 */
export type { McpConfigView, McpScope, McpServerView };

/* pi's rule, kept in step with it: names reach the model as `mcp__<name>__<tool>`,
   so anything but these characters has no unambiguous spelling there. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

export function mcpFile(cwd: string, agentDir: string, scope: McpScope): string {
  return scope === "global" ? join(agentDir, "mcp.json") : join(cwd, ".pi", "mcp.json");
}

function readDoc(path: string, errors: string[]): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push(`${path}: the top level is not a JSON object`);
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * The document as an edit has to see it: either parsed, or an error.
 *
 * Reading may degrade a broken file to "no servers" so the screen still opens;
 * editing must not. Rewriting a file that failed to parse replaces whatever the
 * user (or another tool) had in it with a config built from nothing — the one
 * way this module could destroy data. pi's own writer lets `JSON.parse` throw
 * here, and so does this.
 */
function readDocForEdit(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}) — fix or move it before saving`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object — fix or move it before saving`);
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.mcpServers !== undefined && (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers))) {
    throw new Error(`${path}: "mcpServers" must be an object — fix or move the file before saving`);
  }
  return doc;
}

function serverEntries(doc: Record<string, unknown>): Record<string, unknown> | null {
  const raw = doc.mcpServers;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * The servers one file defines, in file order, with invalid entries reported.
 *
 * Entries are checked with pi's own rules (see `validateMcpServerConfig`), and a
 * name whose namespace (`mcp__<name>`, with `-` folded to `_`) collides with a
 * server already accepted is reported rather than loaded — two entries that
 * differ only in `-` and `_` would fight over one namespace in the model's tool
 * list. `taken` spans both files, so a project entry can clash with a global one.
 */
function serversOf(
  doc: Record<string, unknown>,
  path: string,
  scope: McpScope,
  errors: string[],
  taken: Map<string, string>,
): McpServerView[] {
  const entries = serverEntries(doc);
  if (entries === null) {
    errors.push(`${path}: mcpServers must be an object`);
    return [];
  }
  const out: McpServerView[] = [];
  for (const [name, value] of Object.entries(entries)) {
    const config = validateMcpServerConfig(name, value);
    if (typeof config === "string") {
      errors.push(`${path}: ${config}`);
      continue;
    }
    const namespace = mcpNamespace(name);
    const clash = [...taken.entries()].find(([other, own]) => other !== name && own === namespace);
    if (clash) {
      errors.push(`${path}: server "${name}" conflicts with "${clash[0]}"`);
      continue;
    }
    taken.set(name, namespace);
    out.push({
      name,
      scope,
      file: path,
      config,
      enabled: config.enabled !== false,
      exposure: config.exposure ?? "codemode",
    });
  }
  return out;
}

/**
 * `deferred` exposure only ever worked through pi's `tool_search` extension,
 * which this build does not register — left in the file it would ask for a
 * tool that does not exist and leave the server's tools unreachable. Rewrite
 * such entries to `codemode` (the other exposure that keeps tools out of the
 * model's declarations) so pi, which reads the file directly, sees a value it
 * can honour. Runs on read so a hand-edited or pre-removal file heals itself.
 */
function migrateDeferredExposure(path: string, doc: Record<string, unknown>): void {
  const servers = serverEntries(doc);
  if (!servers) return;
  let dirty = false;
  for (const entry of Object.values(servers)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.exposure === "deferred") {
      record.exposure = "codemode";
      dirty = true;
    }
    const perTool = record.toolExposure;
    if (perTool && typeof perTool === "object" && !Array.isArray(perTool)) {
      for (const [tool, exposure] of Object.entries(perTool)) {
        if (exposure === "deferred") {
          (perTool as Record<string, unknown>)[tool] = "codemode";
          dirty = true;
        }
      }
    }
  }
  if (dirty) writeDoc(path, doc);
}

export function readMcpConfig(cwd: string, agentDir: string): McpConfigView {
  const errors: string[] = [];
  const globalPath = mcpFile(cwd, agentDir, "global");
  const projectPath = mcpFile(cwd, agentDir, "project");
  const globalDoc = readDoc(globalPath, errors);
  const projectDoc = readDoc(projectPath, errors);
  migrateDeferredExposure(globalPath, globalDoc);
  migrateDeferredExposure(projectPath, projectDoc);

  const byName = new Map<string, McpServerView>();
  const taken = new Map<string, string>();
  for (const server of serversOf(globalDoc, globalPath, "global", errors, taken)) byName.set(server.name, server);
  /* a project entry replaces a global one with the same name, exactly as pi merges them */
  for (const server of serversOf(projectDoc, projectPath, "project", errors, taken)) byName.set(server.name, server);

  return {
    servers: [...byName.values()],
    errors,
    autoEnableCodemode:
      typeof projectDoc.autoEnableCodemode === "boolean"
        ? projectDoc.autoEnableCodemode
        : globalDoc.autoEnableCodemode !== false,
  };
}

/**
 * What the file should hold for one server.
 *
 * Keys that only mean the default are dropped rather than written, so a saved
 * entry reads like the documentation's examples instead of like a form dump.
 * `oauth`, `toolExposure` and the rest of the unmodelled keys are carried over by
 * the caller — this only normalises the fields the form owns.
 */
function normalise(config: McpServerConfig): McpServerConfig {
  const next: Record<string, unknown> = { ...(config as unknown as Record<string, unknown>) };
  for (const key of Object.keys(next)) {
    const value = next[key];
    if (value === undefined || value === null || value === "") delete next[key];
  }
  if (next.enabled === true) delete next.enabled;
  if (next.exposure === "codemode") delete next.exposure;
  if (Array.isArray(next.args) && next.args.length === 0) delete next.args;
  return next as unknown as McpServerConfig;
}

/**
 * pi keeps whatever indentation the file already had; so does this.
 *
 * The *string* is kept, not its length: a tab-indented file must stay
 * tab-indented, and `JSON.stringify` with a number would rewrite it as spaces.
 */
function indentOf(text: string): string {
  const match = /^([ \t]+)\S/m.exec(text);
  return match ? match[1] : "  ";
}

function writeDoc(path: string, doc: Record<string, unknown>): void {
  const indent = indentOf(existsSync(path) ? readFileSync(path, "utf8") : "");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, indent)}\n`, "utf8");
}

/**
 * The document with one server's entry changed, other content untouched.
 *
 * Reads through `readDocForEdit`, so a file that is not JSON is a thrown error
 * rather than an empty document — see that function for why.
 */
function editServers(cwd: string, agentDir: string, scope: McpScope, edit: (servers: Record<string, unknown>) => void): void {
  const path = mcpFile(cwd, agentDir, scope);
  const doc = readDocForEdit(path);
  const servers = { ...(serverEntries(doc) ?? {}) };
  edit(servers);
  doc.mcpServers = servers;
  writeDoc(path, doc);
}

export function writeMcpServer(
  cwd: string,
  agentDir: string,
  scope: McpScope,
  name: string,
  config: McpServerConfig,
): McpConfigView {
  if (!SERVER_NAME.test(name)) throw new Error("A server name may contain letters, digits, _ and - only.");
  const entry = normalise(config);
  /* Validate what will actually be written: the form's empty fields are already
     gone, and pi's rules are the ones the CLI will apply at load time. */
  const error = validateMcpServerConfig(name, entry);
  if (typeof error === "string") throw new Error(error);
  editServers(cwd, agentDir, scope, (servers) => {
    servers[name] = entry;
  });
  return readMcpConfig(cwd, agentDir);
}

export function patchMcpServer(
  cwd: string,
  agentDir: string,
  scope: McpScope,
  name: string,
  patch: { enabled?: boolean; exposure?: McpExposure },
): McpConfigView {
  if (patch.exposure !== undefined && !MCP_EXPOSURES.includes(patch.exposure)) {
    throw new Error(`unknown exposure "${patch.exposure}"`);
  }
  editServers(cwd, agentDir, scope, (servers) => {
    const current = servers[name];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`${scope} mcp.json does not define "${name}"`);
    }
    const entry = { ...(current as Record<string, unknown>) };
    if (patch.enabled !== undefined) {
      if (patch.enabled) delete entry.enabled;
      else entry.enabled = false;
    }
    if (patch.exposure !== undefined) {
      if (patch.exposure === "codemode") delete entry.exposure;
      else entry.exposure = patch.exposure;
    }
    servers[name] = entry;
  });
  return readMcpConfig(cwd, agentDir);
}

export function removeMcpServer(cwd: string, agentDir: string, scope: McpScope, name: string): McpConfigView {
  editServers(cwd, agentDir, scope, (servers) => {
    delete servers[name];
  });
  return readMcpConfig(cwd, agentDir);
}
