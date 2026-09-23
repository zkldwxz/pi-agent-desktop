import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentsConfig, CatalogItem, DesktopConfig } from "@shared/types";

/**
 * Desktop-local configuration and the installable resource catalogue.
 *
 * Everything here writes under `~/.pi/agent/`, so the Pi CLI sees the same
 * state this app does. Skills are copied from the app bundle into
 * `~/.pi/agent/skills/`; capabilities (the browser and task extensions) are
 * built into this app, so their switch lives in a small desktop config file
 * rather than copying any code around.
 */

const DEFAULT_AGENTS: AgentsConfig = { maxConcurrent: 3, wakeOnCompletion: true };

function coerceAgents(raw: unknown): AgentsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AGENTS };
  const record = raw as { maxConcurrent?: unknown; wakeOnCompletion?: unknown };
  return {
    maxConcurrent:
      typeof record.maxConcurrent === "number" && record.maxConcurrent >= 1 && record.maxConcurrent <= 32
        ? Math.round(record.maxConcurrent)
        : DEFAULT_AGENTS.maxConcurrent,
    wakeOnCompletion: typeof record.wakeOnCompletion === "boolean" ? record.wakeOnCompletion : DEFAULT_AGENTS.wakeOnCompletion,
  };
}

/** The terminal pane's shell choice: a preferred entry by id, or "auto" for
 *  the machine's own order, with an optional custom path that outranks both. */
export interface TerminalConfig {
  /** "auto", or a TerminalShell id discovered on this machine */
  preferred: string;
  /** absolute path; set means it wins whenever it exists */
  customPath?: string;
}

const DEFAULT_TERMINAL: TerminalConfig = { preferred: "auto" };

function coerceTerminal(raw: unknown): TerminalConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TERMINAL };
  const record = raw as { preferred?: unknown; customPath?: unknown };
  return {
    preferred: typeof record.preferred === "string" && record.preferred ? record.preferred : "auto",
    customPath: typeof record.customPath === "string" && record.customPath.trim() ? record.customPath.trim() : undefined,
  };
}

const DEFAULT_CONFIG: DesktopConfig = {
  capabilities: { browser: true, todos: true },
  onboardingDone: false,
  ultra: {},
  agents: { ...DEFAULT_AGENTS },
  terminal: { ...DEFAULT_TERMINAL },
};

function configPath(): string {
  return join(getAgentDir(), "desktop.json");
}

export async function readConfig(): Promise<DesktopConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return {
      capabilities: { ...DEFAULT_CONFIG.capabilities, ...(parsed.capabilities ?? {}) },
      onboardingDone: Boolean(parsed.onboardingDone),
      ultra: parsed.ultra ?? {},
      buildModel:
        parsed.buildModel && typeof parsed.buildModel.provider === "string" && typeof parsed.buildModel.id === "string"
          ? { provider: parsed.buildModel.provider, id: parsed.buildModel.id }
          : undefined,
      agents: coerceAgents(parsed.agents),
      terminal: coerceTerminal(parsed.terminal),
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      agents: { ...DEFAULT_AGENTS },
      terminal: { ...DEFAULT_TERMINAL },
    };
  }
}

let configWrites: Promise<unknown> = Promise.resolve();

export function writeConfig(patch: Partial<DesktopConfig>): Promise<DesktopConfig> {
  const pending = configWrites.then(() => writeConfigNow(patch));
  configWrites = pending.catch(() => undefined);
  return pending;
}

async function writeConfigNow(patch: Partial<DesktopConfig>): Promise<DesktopConfig> {
  const current = await readConfig();
  const next: DesktopConfig = {
    capabilities: { ...current.capabilities, ...(patch.capabilities ?? {}) },
    onboardingDone: patch.onboardingDone ?? current.onboardingDone,
    ultra: patch.ultra ?? current.ultra,
    /* the model the last Build ran with — written once per build, read on every
       boot, so the plan panel opens on the choice you made last time */
    buildModel: "buildModel" in patch ? patch.buildModel : current.buildModel,
    agents: patch.agents ? coerceAgents({ ...current.agents, ...patch.agents }) : current.agents,
    terminal: patch.terminal ? coerceTerminal({ ...current.terminal, ...patch.terminal }) : current.terminal,
  };
  await mkdir(getAgentDir(), { recursive: true });
  const temporary = `${configPath()}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, configPath());
  return next;
}

/** Bundled skills ship beside the app; in dev they live in the repo. */
export function skillsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(app.getAppPath(), "resources", "skills");
}

/** The same deal for extensions this app ships: plan mode, today. */
export function extensionsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "extensions")
    : join(app.getAppPath(), "resources", "extensions");
}

const SKILL_META: Record<string, { name: string; description: string }> = {
  "browser-design": {
    name: "Browser design",
    description: "Pick a component in the browser and anchor a change to it — selector, React component, styles, cropped screenshot.",
  },
  "browser-ops": {
    name: "Browser ops",
    description: "Drive the embedded browser: snapshot, click, fill, search text, screenshot.",
  },
  "plan-with-tasks": {
    name: "Task planning",
    description: "Keep the sidebar task list current through multi-step work.",
  },
};

/**
 * The extensions this app ships, installed as ordinary plugins.
 *
 * They land in `~/.pi/agent/extensions/`, which is where pi looks and where the
 * app's own Plugins view lists them — so the same file serves the CLI and this
 * window, and disabling it is the same toggle in either place.
 */
const EXTENSION_META: Record<string, { name: string; description: string }> = {
  "plan-mode": {
    name: "Plan mode",
    description:
      "A read-only planning phase with a reviewable plan, then a build that tracks its own steps. Adds the /plan command and the create_plan tool.",
  },
  "agent-team": {
    name: "Agent team",
    description:
      "Codex-style sub-agents: spawn_agent, wait_agent, list_agents and interrupt_agent backed by real in-process sessions with their own context windows. Required for Ultra's proactive delegation.",
  },
};

function skillDir(name: string): string {
  return join(getAgentDir(), "skills", name);
}

function extensionDir(name: string): string {
  return join(getAgentDir(), "extensions", name);
}

async function isSkillInstalled(name: string): Promise<boolean> {
  return existsSync(join(skillDir(name), "SKILL.md"));
}

function isExtensionInstalled(name: string): boolean {
  return existsSync(join(extensionDir(name), "index.ts"));
}

export async function catalog(): Promise<CatalogItem[]> {
  const config = await readConfig();
  const items: CatalogItem[] = [];

  const names = existsSync(skillsRoot()) ? await readdir(skillsRoot()) : [];
  for (const name of names) {
    const meta = SKILL_META[name];
    if (!meta) continue;
    items.push({
      id: `skill:${name}`,
      kind: "skill",
      name: meta.name,
      description: meta.description,
      installed: await isSkillInstalled(name),
    });
  }

  const extensions = existsSync(extensionsRoot()) ? await readdir(extensionsRoot()) : [];
  for (const name of extensions) {
    const meta = EXTENSION_META[name];
    if (!meta) continue;
    items.push({
      id: `extension:${name}`,
      kind: "extension",
      name: meta.name,
      description: meta.description,
      installed: isExtensionInstalled(name),
    });
  }

  items.push(
    {
      id: "capability:browser",
      kind: "capability",
      name: "Browser",
      description:
        "An embedded Chromium panel with 7 tools (open, snapshot, click, fill, find, screenshot, design pick).",
      installed: config.capabilities.browser,
      needsReload: true,
    },
    {
      id: "capability:todos",
      kind: "capability",
      name: "Task list",
      description: "Lets the agent maintain a task list, shown live in the side panel.",
      installed: config.capabilities.todos,
      needsReload: true,
    },
  );

  return items;
}

export async function applyCatalog(ids: string[]): Promise<{ config: DesktopConfig; installed: string[] }> {
  const wanted = new Set(ids);
  const installed: string[] = [];

  // skills: copy in or remove, so the checkbox is a real toggle
  const names = existsSync(skillsRoot()) ? await readdir(skillsRoot()) : [];
  for (const name of names) {
    if (!SKILL_META[name]) continue;
    const target = skillDir(name);
    const want = wanted.has(`skill:${name}`);
    const present = await isSkillInstalled(name);
    if (want && !present) {
      await mkdir(target, { recursive: true });
      await cp(join(skillsRoot(), name), target, { recursive: true });
      installed.push(name);
    } else if (!want && present) {
      await rm(target, { recursive: true, force: true });
    }
  }

  // extensions: copied into the agent's own plugin folder, so pi (CLI or app)
  // loads one and the same file
  const extensionNames = existsSync(extensionsRoot()) ? await readdir(extensionsRoot()) : [];
  for (const name of extensionNames) {
    if (!EXTENSION_META[name]) continue;
    const target = extensionDir(name);
    const want = wanted.has(`extension:${name}`);
    const present = isExtensionInstalled(name);
    if (want && !present) {
      await mkdir(target, { recursive: true });
      await cp(join(extensionsRoot(), name), target, { recursive: true });
      installed.push(name);
    } else if (!want && present) {
      await rm(target, { recursive: true, force: true });
    }
  }

  const config = await writeConfig({
    capabilities: {
      browser: wanted.has("capability:browser"),
      todos: wanted.has("capability:todos"),
    },
  });

  return { config, installed };
}

export async function markOnboardingDone(): Promise<DesktopConfig> {
  return writeConfig({ onboardingDone: true });
}

/** True when at least one bundled skill is present in the catalogue. */
export async function catalogAvailable(): Promise<boolean> {
  try {
    return (await stat(skillsRoot())).isDirectory();
  } catch {
    return false;
  }
}
