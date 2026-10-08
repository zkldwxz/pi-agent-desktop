/**
 * Regression cover for the shared model-list ordering and search logic.
 *
 * Run: node --test scripts/model-list-regression.mjs
 *
 * The two surfaces that show the model catalogue — Customize ▸ Models and
 * Settings ▸ Models — read the same rows, so what a query answers and where the
 * hand-written rows land is pinned here instead of being eyeballed twice. The
 * module under test is pure, which is why this suite needs no window.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  buildCatalogue,
  channelOfModel,
  customFirst,
  filterCatalogue,
  isCustomChannel,
  isCustomModel,
  modelSections,
  providerIdsCustomFirst,
} = await import("../src/renderer/src/lib/model-list.ts");

const model = (provider, id, name, source, channelId) => ({ provider, id, name, source, channelId });
const channel = (id, name, custom, members, baseUrl) => ({
  id,
  name,
  api: "openai-completions",
  baseUrl,
  members,
  modelCount: 0,
  custom,
});

const CHANNELS = [
  channel("anthropic", "Anthropic", false, ["anthropic"]),
  channel("opcc", "OPCC 中转", true, ["opcc"], "https://relay.example.com/v1"),
  channel("relay-2", "Empty Relay", true, ["relay-2"]),
];

const MODELS = [
  model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", "builtin", "anthropic"),
  /* no channelId: the row still has to find its endpoint by membership */
  model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", "builtin"),
  model("openai", "gpt-5.2", "GPT 5.2", "builtin"),
  model("anthropic", "claude-custom", "Claude Custom", "models.json", "anthropic"),
  model("opcc", "glm-5.3", "GLM 5.3", "models.json", "opcc"),
];

test("customFirst is a stable partition, and only sorts when asked", () => {
  const rows = [
    { id: "a", custom: false },
    { id: "b", custom: true },
    { id: "c", custom: false },
    { id: "d", custom: true },
  ];
  assert.deepEqual(
    customFirst(rows, (row) => row.custom).map((row) => row.id),
    ["b", "d", "a", "c"],
  );
  assert.deepEqual(
    customFirst(
      [{ name: "b", custom: true }, { name: "a", custom: true }, { name: "d", custom: false }, { name: "c", custom: false }],
      (row) => row.custom,
      (a, b) => a.name.localeCompare(b.name),
    ).map((row) => row.name),
    ["a", "b", "c", "d"],
  );
});

test("models.json is the only custom model source", () => {
  assert.equal(isCustomModel({ source: "models.json" }), true);
  assert.equal(isCustomModel({ source: "builtin" }), false);
  assert.equal(isCustomModel({ source: "extension" }), false);
  assert.equal(isCustomChannel({ custom: true }), true);
  assert.equal(isCustomChannel({ custom: false }), false);
});

test("a row finds its channel by the host's fold and by membership", () => {
  assert.equal(channelOfModel({ provider: "anthropic", channelId: "anthropic" }, CHANNELS)?.id, "anthropic");
  assert.equal(channelOfModel({ provider: "anthropic" }, CHANNELS)?.id, "anthropic");
  assert.equal(channelOfModel({ provider: "nobody" }, CHANNELS), undefined);
});

test("the catalogue index carries name, id, provider, channel name and address", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  const haiku = catalogue.rows.find((row) => row.model.id === "claude-haiku-4-5");
  assert.match(haiku.text, /claude haiku 4\.5/);
  assert.match(haiku.text, /claude-haiku-4-5/);
  assert.match(haiku.text, /anthropic/);

  const glm = catalogue.rows.find((row) => row.model.id === "glm-5.3");
  assert.match(glm.text, /opcc 中转/);
  assert.match(glm.text, /relay\.example\.com/);
});

test("filterCatalogue matches case-insensitively and trims the box", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  assert.deepEqual(filterCatalogue(catalogue, "CLAUDE").map((row) => row.model.id), [
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-custom",
  ]);
  /* an empty box is not a filter */
  assert.equal(filterCatalogue(catalogue, "   "), catalogue.rows);
  assert.deepEqual(filterCatalogue(catalogue, "nothing-at-all").map((row) => row.model.id), []);
});

test("a channel-name or address match answers with every model on the endpoint", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  assert.deepEqual(filterCatalogue(catalogue, "中转").map((row) => row.model.id), ["glm-5.3"]);
  assert.deepEqual(filterCatalogue(catalogue, "relay.example").map((row) => row.model.id), ["glm-5.3"]);
});

test("the grouped list puts custom channels first, keeps empty ones, and orphans last", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  const sections = modelSections(catalogue, { grouped: true, query: "" });

  assert.deepEqual(
    sections.map((section) => section.channel?.id ?? null),
    ["relay-2", "opcc", "anthropic", null],
  );
  /* the endpoint just created has no models yet and must still be listed */
  assert.deepEqual(sections[0].rows, []);
  /* a models.json row on a shipped endpoint comes before the shipped rows */
  assert.deepEqual(
    sections[2].rows.map((row) => row.id),
    ["claude-custom", "claude-haiku-4-5", "claude-sonnet-4-5"],
  );
  /* rows the host reported no channel for still land somewhere */
  assert.deepEqual(sections[3].rows.map((row) => row.id), ["gpt-5.2"]);
});

test("while searching, an endpoint stays only when it has an answer or the query names it", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  assert.deepEqual(
    modelSections(catalogue, { grouped: true, query: "glm" }).map((section) => section.channel?.id ?? null),
    ["opcc"],
  );
  /* a channel-name hit answers with the whole endpoint, not one row */
  assert.deepEqual(
    modelSections(catalogue, { grouped: true, query: "中转" })[0].rows.map((row) => row.id),
    ["glm-5.3"],
  );
  /* the endpoint just created has no models; naming it must still show it, or
     the channel looks like it failed to save */
  const named = modelSections(catalogue, { grouped: true, query: "empty relay" });
  assert.equal(named.length, 1);
  assert.equal(named[0].channel?.id, "relay-2");
  assert.deepEqual(named[0].rows, []);

  assert.deepEqual(modelSections(catalogue, { grouped: true, query: "no-such-model" }), []);
});

test("the flat list is one section, custom rows first and each half in catalogue order", () => {
  const catalogue = buildCatalogue(MODELS, CHANNELS);
  const sections = modelSections(catalogue, { grouped: false, query: "" });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].channel, null);
  assert.deepEqual(
    sections[0].rows.map((row) => row.id),
    ["claude-custom", "glm-5.3", "claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5.2"],
  );

  const filtered = modelSections(catalogue, { grouped: false, query: "gpt" });
  assert.deepEqual(filtered[0].rows.map((row) => row.id), ["gpt-5.2"]);
});

test("provider chips read the hand-written endpoints first", () => {
  /* first-seen order is anthropic, openai, opcc; only opcc is custom — the
     anthropic channel is shipped, so its one models.json row does not drag the
     shipped chip up with it */
  assert.deepEqual(providerIdsCustomFirst(MODELS, CHANNELS), ["opcc", "anthropic", "openai"]);
  /* a provider no channel claims is judged by the models it serves */
  assert.deepEqual(
    providerIdsCustomFirst([model("local", "local-large", "Local Large", "models.json")], []),
    ["local"],
  );
  assert.deepEqual(providerIdsCustomFirst([], CHANNELS), []);
});
