/**
 * Regression cover for the settings model manager.
 *
 * Run: node --test scripts/model-manager-regression.mjs
 *
 * Two things are worth pinning down without opening the window: that a model
 * write leaves a file pi can still read (an entry with an empty `models` array
 * is rejected outright by `applyModelsJson`), and that the id reader keeps
 * saying what it says — it is the only place a wrong number could reach
 * models.json without a human typing it.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/* model-config resolves the agent directory through the SDK's own env
   override, so the suite writes into a scratch directory and can never touch a
   real ~/.pi/agent/models.json */
const scratch = mkdtempSync(join(tmpdir(), "pi-model-config-"));
process.env.PI_CODING_AGENT_DIR = scratch;

const { inferModelCapabilities } = await import("../src/shared/model-capabilities.ts");
const { removeModelFromFile, writeModelEdit } = await import("../src/main/model-config.ts");

const modelsFile = join(scratch, "models.json");
const read = () => JSON.parse(readFileSync(modelsFile, "utf8"));
const reset = (file) => writeFileSync(modelsFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");

test("a saved model lands in models.json, with a backup beside it", () => {
  reset({ providers: {} });
  writeModelEdit({
    provider: "acme",
    id: "acme-large",
    name: "Acme Large",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
  });

  const file = read();
  assert.equal(file.providers.acme.models.length, 1);
  assert.equal(file.providers.acme.models[0].id, "acme-large");
  assert.deepEqual(file.providers.acme.models[0].input, ["text", "image"]);
  assert.ok(existsSync(`${modelsFile}.bak`), "the previous file is kept as .bak");
});

test("editing the same id updates the record instead of duplicating it", () => {
  writeModelEdit({
    provider: "acme",
    id: "acme-large",
    name: "Acme Large v2",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_000,
  });

  const models = read().providers.acme.models;
  assert.equal(models.length, 1);
  assert.equal(models[0].name, "Acme Large v2");
  assert.equal(models[0].contextWindow, 128_000);
});

test("removing the last model takes the now-empty provider entry with it", () => {
  removeModelFromFile("acme", "acme-large");
  /* what is left would be `{ providers: { acme: {} } }`, which pi rejects on the
     next read with "must specify baseUrl, headers, compat, modelOverrides, or
     models" — so the entry goes too */
  assert.equal(read().providers.acme, undefined);
});

test("a channel that still describes itself keeps its entry when its last model goes", () => {
  reset({
    providers: {
      relay: { baseUrl: "https://relay.test/v1", api: "openai-completions", models: [{ id: "a" }, { id: "b" }] },
    },
  });

  removeModelFromFile("relay", "a");
  const afterOne = read().providers.relay;
  assert.deepEqual(afterOne.models.map((model) => model.id), ["b"]);
  assert.equal(afterOne.baseUrl, "https://relay.test/v1");

  removeModelFromFile("relay", "b");
  const afterBoth = read().providers.relay;
  assert.equal(afterBoth.models, undefined, "an empty models array is dropped");
  assert.equal(afterBoth.baseUrl, "https://relay.test/v1", "the channel survives its models");
});

test("the id reader reports what the family ships", () => {
  assert.deepEqual(inferModelCapabilities({ id: "claude-sonnet-4-5-20250929" }), {
    contextWindow: 200_000,
    maxTokens: 64_000,
    supportsImages: true,
    reasoning: true,
  });
  assert.equal(inferModelCapabilities({ id: "gemini-2.5-pro" }).contextWindow, 1_000_000);
  assert.deepEqual(inferModelCapabilities({ id: "deepseek-reasoner" }), {
    contextWindow: 64_000,
    maxTokens: 8_000,
    reasoning: true,
  });
  assert.equal(inferModelCapabilities({ id: "qwen-vl-max" }).supportsImages, true);
});

test("an explicit size in the id outranks the family default", () => {
  assert.equal(inferModelCapabilities({ id: "claude-opus-4-1m" }).contextWindow, 1_000_000);
  assert.equal(inferModelCapabilities({ id: "gpt-4o-32k" }).contextWindow, 32_000);
});

test("a nickname is resolved through its channel, and an unknown id admits it", () => {
  assert.equal(inferModelCapabilities({ provider: "deepseek", id: "v3" }).contextWindow, 128_000);
  assert.equal(inferModelCapabilities({ provider: "local", id: "some-local-gguf" }), null);
  assert.equal(inferModelCapabilities({ id: "" }), null);
});
