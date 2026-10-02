import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ChannelEdit, ModelEdit } from "@shared/types";

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

/* ── channels ───────────────────────────────────────────────────────────────
 *
 * pi holds one credential per provider id, so a channel the user thinks of as
 * "this endpoint, with these three keys" cannot be stored that way. It is
 * stored as three provider entries that share `api` and `baseUrl`, and a
 * channel is what they have in common. Nothing else in the app gets to invent
 * a second identity for the same endpoint: grouping is read off the file, so
 * a channel hand-written in the CLI shows up here unchanged, and two keys are
 * never merged into one just because they were added at different times.
 */

/* Channel identity lives in `src/shared/channel`, which the host's grouping and
 * the browser preview resolve against as well. Imported by relative path rather
 * than the `@shared` alias because this module is loaded directly by
 * `scripts/model-manager-regression.mjs`, and only vite knows the alias. */
import { channelIdOf, endpointId } from "../shared/channel.ts";

/** Every provider id sharing an endpoint with `providerId`, primary first. */
export function channelPeers(file: RawModelsFile, providerId: string): string[] {
  const providers = file.providers ?? {};
  const own = providers[providerId];
  if (!own) return [providerId];
  const channelId = channelIdOf(own, providerId);
  const peers = Object.keys(providers)
    .filter((id) => channelIdOf(providers[id], id) === channelId)
    .sort();
  return peers.length ? peers : [providerId];
}

/** `My Proxy` → `my-proxy`, which is how pi will address the provider. */
function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "channel";
}

/** The first id in `base`, `base-2`, `base-3`… that nothing else is using. */
function freeId(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Write a channel: one provider entry per key, all of them carrying the same
 * model list.
 *
 * Existing members are reused in id order rather than deleted and rewritten, so
 * a session pointed at `my-proxy` survives adding a second key, and a rename
 * touches only the display name — the endpoint is the identity.
 */
export function writeChannel(edit: ChannelEdit): string[] {
  const file = readModelsFile();
  file.providers = file.providers ?? {};
  const providers = file.providers;

  const name = edit.name.trim();
  const baseUrl = edit.baseUrl.trim();
  const keys = edit.keys.map((key) => key.trim()).filter(Boolean);
  if (!name || !baseUrl || !keys.length) return [];

  const channelId = endpointId(edit.api, baseUrl);
  const members = Object.keys(providers)
    .filter((id) => channelIdOf(providers[id], id) === channelId)
    .sort();
  /* the model list belongs to the endpoint, so any member can supply it — and a
     channel that is being re-keyed keeps whatever models it already had */
  const models = providers[members[0]]?.models ?? [];

  const base = slugify(name);
  const taken = new Set(Object.keys(providers));
  for (const id of members) taken.delete(id);

  const ids: string[] = [];
  keys.forEach((key, index) => {
    const id = members[index] ?? freeId(taken, index === 0 ? base : `${base}-${index + 1}`);
    taken.add(id);
    ids.push(id);
    providers[id] = { name, baseUrl, api: edit.api, apiKey: key, models };
  });

  /* keys removed from the list take their provider entries with them */
  for (const stale of members.slice(keys.length)) delete providers[stale];

  writeModelsFile(file);
  return ids;
}

/** Drop a whole endpoint, every key of it. */
export function deleteChannel(channelId: string): void {
  const file = readModelsFile();
  const providers = file.providers ?? {};
  for (const id of Object.keys(providers)) {
    if (channelIdOf(providers[id], id) === channelId) delete providers[id];
  }
  writeModelsFile(file);
}

/** One more key on an existing endpoint, carrying its models too. */
export function addChannelKey(channelId: string, key: string): string | undefined {
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  const file = readModelsFile();
  const providers = file.providers ?? {};
  const members = Object.keys(providers)
    .filter((id) => channelIdOf(providers[id], id) === channelId)
    .sort();
  const template = providers[members[0]];
  if (!template) return undefined;

  const taken = new Set(Object.keys(providers));
  /* numbered off the primary id rather than the display name, so a renamed
     channel keeps handing out ids that still read as its own */
  const base = members[0] ?? slugify(String(template.name ?? "channel"));
  const id = freeId(taken, `${base}-${members.length + 1}`);
  providers[id] = { ...template, apiKey: trimmed };
  writeModelsFile(file);
  return id;
}

/**
 * Forget one key.
 *
 * The other members of the endpoint keep working, and the channel disappears
 * only when its last key does — which is the whole point of storing a key per
 * provider rather than one field per endpoint.
 */
export function removeChannelKey(providerId: string): void {
  const file = readModelsFile();
  delete file.providers?.[providerId];
  writeModelsFile(file);
}

/**
 * Merge a model edit into models.json.
 *
 * Built-in providers are not stored here; editing one writes a provider entry
 * that overrides the built-in catalogue for that model id. A channel writes it
 * into every member, because a model the second key cannot serve is a model
 * that silently fails the moment that key is selected.
 */
export function writeModelEdit(edit: ModelEdit): { providers: string[] } {
  const file = readModelsFile();
  file.providers = file.providers ?? {};
  const targets = channelPeers(file, edit.provider);

  for (const providerId of targets) {
    const provider: RawProvider = file.providers[providerId] ?? {};
    provider.models = Array.isArray(provider.models) ? provider.models : [];

    const index = provider.models.findIndex((model) => model.id === edit.id);
    const next: RawModel = {
      ...(index >= 0 ? provider.models[index] : {}),
      id: edit.id,
      name: edit.name,
      reasoning: edit.reasoning,
      input: edit.input,
    };
    /* A blank field reads back as 0, and 0 means "nobody said" — writing
       `contextWindow: 0` over a real number asks pi to compose a model with no
       window at all, which shows up as the model vanishing the moment the list
       refreshes. So an unspecified size leaves the stored one alone. */
    if (edit.contextWindow > 0) next.contextWindow = edit.contextWindow;
    if (edit.maxTokens > 0) next.maxTokens = edit.maxTokens;
    if (edit.thinkingLevelMap) next.thinkingLevelMap = edit.thinkingLevelMap;

    if (index >= 0) provider.models[index] = next;
    else provider.models.push(next);

    file.providers[providerId] = provider;
  }

  writeModelsFile(file);
  return { providers: targets };
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
 *
 * It applies to every member of the channel, so the model leaves all of them.
 */
export function removeModelFromFile(providerId: string, modelId: string): void {
  const file = readModelsFile();
  for (const id of channelPeers(file, providerId)) {
    const provider = file.providers?.[id];
    if (!provider?.models) continue;
    provider.models = provider.models.filter((model) => model.id !== modelId);
    if (!provider.models.length) {
      delete provider.models;
      if (!Object.keys(provider).length) delete file.providers?.[id];
    }
  }
  writeModelsFile(file);
}

/** Remove secrets before sending provider info to the renderer. */
export function sanitizeProvider(provider: RawProvider) {
  const { apiKey, ...rest } = provider;
  return rest;
}
