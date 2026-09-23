import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelEdit } from "@shared/types";

interface RawProvider {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: RawModel[];
  [key: string]: unknown;
}

interface RawModel {
  id?: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
  cost?: Record<string, number>;
  [key: string]: unknown;
}

interface RawModelsFile {
  providers?: Record<string, RawProvider>;
  [key: string]: unknown;
}

export function modelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

/**
 * Write models.json, keeping one backup first.
 *
 * This file is the user's own config, and more than one process can hold a copy
 * of it (the CLI, this app). A backup means a stale writer cannot silently
 * destroy hand-written providers — it showed up in practice while adding a
 * provider, so the insurance is deliberate rather than hypothetical.
 */
function writeModelsFile(file: RawModelsFile): void {
  const target = modelsJsonPath();
  try {
    if (existsSync(target)) copyFileSync(target, `${target}.bak`);
  } catch {
    /* a failed backup must not block the write */
  }
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function readModelsFile(): RawModelsFile {
  const path = modelsJsonPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RawModelsFile;
    if (!parsed.providers) parsed.providers = {};
    return parsed;
  } catch {
    return { providers: {} };
  }
}

/**
 * Merge a model edit into models.json.
 *
 * Built-in providers are not stored here; editing one writes a provider entry
 * that overrides the built-in catalogue for that model id.
 */
export function writeModelEdit(edit: ModelEdit): { providers: string[] } {
  const file = readModelsFile();
  file.providers = file.providers ?? {};
  const provider = file.providers[edit.provider] ?? {};
  provider.models = Array.isArray(provider.models) ? provider.models : [];

  const index = provider.models.findIndex((model) => model.id === edit.id);
  const next: RawModel = {
    ...(index >= 0 ? provider.models[index] : {}),
    id: edit.id,
    name: edit.name,
    reasoning: edit.reasoning,
    input: edit.input,
    contextWindow: edit.contextWindow,
    maxTokens: edit.maxTokens,
  };
  if (edit.thinkingLevelMap) next.thinkingLevelMap = edit.thinkingLevelMap;

  if (index >= 0) provider.models[index] = next;
  else provider.models.push(next);

  file.providers[edit.provider] = provider;
  writeModelsFile(file);
  return { providers: [edit.provider] };
}

/**
 * Drop a model from models.json.
 *
 * The provider entry has to stay composable: pi's `applyModelsJson` rejects an
 * entry that names no `models`, no `baseUrl`, no `headers`, no `compat`, no
 * `modelOverrides`, no key and no `oauth` — so removing the last model removes
 * the `models` field itself, and an entry left with nothing else goes with it.
 * Without this, deleting the only model of a hand-written channel would break
 * the whole file on the next read.
 */
export function removeModelFromFile(providerId: string, modelId: string): void {
  const file = readModelsFile();
  const provider = file.providers?.[providerId];
  if (!provider?.models) return;
  provider.models = provider.models.filter((model) => model.id !== modelId);
  if (!provider.models.length) {
    delete provider.models;
    if (!Object.keys(provider).length) delete file.providers?.[providerId];
  }
  writeModelsFile(file);
}

/** Remove secrets before sending provider info to the renderer. */
export function sanitizeProvider(provider: RawProvider) {
  const { apiKey, ...rest } = provider;
  return rest;
}
