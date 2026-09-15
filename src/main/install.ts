import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CatalogItem, DesktopConfig } from "@shared/types";

/**
 * Desktop-local configuration and the installable resource catalogue.
 *
 * Everything here writes under `~/.pi/agent/`, so the Pi CLI sees the same
 * state this app does. Skills are copied from the app bundle into
 * `~/.pi/agent/skills/`; capabilities (the browser and task extensions) are
 * built into this app, so their switch lives in a small desktop config file
 * rather than copying any code around.
 */

const DEFAULT_CONFIG: DesktopConfig = {
  capabilities: { browser: true, todos: true },
  onboardingDone: false,
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
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(patch: Partial<DesktopConfig>): Promise<DesktopConfig> {
  const current = await readConfig();
  const next: DesktopConfig = {
    capabilities: { ...current.capabilities, ...(patch.capabilities ?? {}) },
    onboardingDone: patch.onboardingDone ?? current.onboardingDone,
  };
  await mkdir(getAgentDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Bundled skills ship beside the app; in dev they live in the repo. */
export function skillsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(app.getAppPath(), "resources", "skills");
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

function skillDir(name: string): string {
  return join(getAgentDir(), "skills", name);
}

async function isSkillInstalled(name: string): Promise<boolean> {
  return existsSync(join(skillDir(name), "SKILL.md"));
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
