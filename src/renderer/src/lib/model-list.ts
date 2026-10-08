import type { ChannelInfo, ModelInfo } from "@shared/types";

/**
 * The row-ordering and search logic the two model lists share.
 *
 * Both Customize ▸ Models and Settings ▸ Models read the same catalogue and are
 * asked the same two questions — which rows answer what was typed, and in what
 * order they read. Answering them here rather than writing them twice (with two
 * chances to drift) is the point; everything in this file is pure and touches
 * nothing but the host's own shapes, which is also what lets the regression
 * script drive it without a window.
 */

/**
 * Stable partition: everything `isCustom` keeps the order it arrived in, and
 * everything else follows, also in its own order.
 *
 * Stability is not a detail — rows must not move on their own when models.json
 * is re-read, and a plain sort would reshuffle equal rows between renders. Pass
 * `compare` only where the view sorts each half (the grouped list has always
 * ordered channels and their rows by name).
 */
export function customFirst<T>(
  items: readonly T[],
  isCustom: (item: T) => boolean,
  compare?: (a: T, b: T) => number,
): T[] {
  const custom: T[] = [];
  const shipped: T[] = [];
  for (const item of items) (isCustom(item) ? custom : shipped).push(item);
  if (compare) {
    custom.sort(compare);
    shipped.sort(compare);
  }
  return [...custom, ...shipped];
}

/** A model the desktop wrote into models.json rather than one pi ships. */
export function isCustomModel(model: Pick<ModelInfo, "source">): boolean {
  return model.source === "models.json";
}

/** A hand-declared endpoint; every provider pi ships is `custom: false`. */
export function isCustomChannel(channel: Pick<ChannelInfo, "custom">): boolean {
  return channel.custom;
}

/**
 * The endpoint a row sits on: the host's fold first (`channelId` is stamped on
 * every row by `collapseToChannels`), with provider membership as the fallback
 * for a catalogue that arrived before the fold.
 */
export function channelOfModel(
  model: Pick<ModelInfo, "provider" | "channelId">,
  channels: readonly ChannelInfo[],
): ChannelInfo | undefined {
  return (
    channels.find((channel) => channel.id === model.channelId) ??
    channels.find((channel) => channel.members.includes(model.provider))
  );
}

/** One lowercased haystack out of the fields a query may hit. */
function haystack(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

export interface IndexedModel {
  model: ModelInfo;
  channel: ChannelInfo | undefined;
  /** lowercased name + id + provider + channel name + channel address */
  text: string;
}

/** The catalogue plus everything the search needs precomputed once. */
export interface ModelCatalogue {
  channels: ChannelInfo[];
  rows: IndexedModel[];
  /** lowercased channel haystack by channel id */
  channelText: Map<string, string>;
}

/**
 * Build the search index for a catalogue.
 *
 * This depends on the models and channels only — never on the query — so the
 * component can memoize it and each keystroke walks prebuilt strings instead of
 * rebuilding one haystack per row.
 */
export function buildCatalogue(models: readonly ModelInfo[], channels: readonly ChannelInfo[]): ModelCatalogue {
  const channelText = new Map<string, string>();
  for (const channel of channels) channelText.set(channel.id, haystack(channel.name, channel.baseUrl));

  const rows = models.map((model) => {
    const channel = channelOfModel(model, channels);
    return {
      model,
      channel,
      text: haystack(model.name, model.id, model.provider, channel?.name, channel?.baseUrl),
    };
  });

  return { channels: [...channels], rows, channelText };
}

/**
 * The rows a query answers.
 *
 * A model matches on its own fields (name, id, provider) and on its channel's
 * name or address; a channel-name match pulls in every model on that endpoint,
 * because "opcc" typed at the top means "show me opcc", not "show me the one
 * row whose id happens to repeat the name".
 */
export function filterCatalogue(catalogue: ModelCatalogue, query: string): IndexedModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalogue.rows;
  return catalogue.rows.filter((row) => {
    if (row.text.includes(needle)) return true;
    if (!row.channel) return false;
    return (catalogue.channelText.get(row.channel.id) ?? "").includes(needle);
  });
}

export interface ModelSection {
  /** null in the flat view, and for rows the host reported no channel for */
  channel: ChannelInfo | null;
  rows: ModelInfo[];
}

/**
 * The list in whichever shape the view asks for, already filtered.
 *
 * Grouped sorts each half by name so a channel's rows land together however the
 * runtime ordered them, and a channel with no models yet still gets a section —
 * otherwise the endpoint just created would look like it had not been saved.
 * That holds while searching too: an endpoint stays when one of its models
 * answers or when the query names the endpoint itself, and drops out otherwise,
 * so "no models match" is only said when nothing at all answered.
 */
export function modelSections(
  catalogue: ModelCatalogue,
  options: { grouped: boolean; query: string },
): ModelSection[] {
  const needle = options.query.trim().toLowerCase();
  const matched = filterCatalogue(catalogue, options.query);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  /** the query names this endpoint, even when no model on it matches */
  const namesChannel = (channel: ChannelInfo) =>
    Boolean(needle) && (catalogue.channelText.get(channel.id) ?? "").includes(needle);

  if (!options.grouped) {
    return [{ channel: null, rows: customFirst(matched.map((row) => row.model), isCustomModel) }];
  }

  const byChannel = new Map<string, ModelInfo[]>();
  const orphans: ModelInfo[] = [];
  for (const row of matched) {
    if (!row.channel) {
      orphans.push(row.model);
      continue;
    }
    const bucket = byChannel.get(row.channel.id);
    if (bucket) bucket.push(row.model);
    else byChannel.set(row.channel.id, [row.model]);
  }

  const sections: ModelSection[] = [];
  for (const channel of customFirst(catalogue.channels, isCustomChannel, byName)) {
    const rows = byChannel.get(channel.id) ?? [];
    if (needle && !rows.length && !namesChannel(channel)) continue;
    sections.push({ channel, rows: customFirst(rows, isCustomModel, byName) });
  }
  if (orphans.length) sections.push({ channel: null, rows: customFirst(orphans, isCustomModel, byName) });
  return sections;
}

/**
 * Provider ids in display order: the hand-written endpoints first, each bucket
 * keeping the order the catalogue listed them in.
 *
 * A provider counts as custom when its channel says so, or — for a provider no
 * channel claims at all — when it serves a model that came from models.json.
 * The channel's word wins deliberately: a shipped provider carrying one
 * overridden model is still a shipped endpoint, and its chip belongs below the
 * endpoints the user declared.
 */
export function providerIdsCustomFirst(
  models: readonly ModelInfo[],
  channels: readonly ChannelInfo[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.provider)) continue;
    seen.add(model.provider);
    ids.push(model.provider);
  }

  const custom = new Set<string>();
  const claimed = new Set<string>();
  for (const channel of channels) {
    for (const member of channel.members) {
      claimed.add(member);
      if (channel.custom) custom.add(member);
    }
  }
  for (const model of models) {
    if (isCustomModel(model) && !claimed.has(model.provider)) custom.add(model.provider);
  }

  return customFirst(ids, (id) => custom.has(id));
}
