// Explicit network smoke test: runs the provider chain against real services.
// Logs providers, timings, URLs and cache behavior; never API keys or page bodies.
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { WebService, validateContent } = await jiti.import("../src/main/web/service.ts");
const { TavilyClient } = await jiti.import("../src/main/web/tavily.ts");
const { TavilySearchAdapter, TavilyFetchAdapter } = await jiti.import("../src/main/web/providers.ts");
const { SearxngSearchAdapter } = await jiti.import("../src/main/web/searxng.ts");
const { DuckDuckGoSearchAdapter } = await jiti.import("../src/main/web/duckduckgo.ts");
const { DirectFetchAdapter } = await jiti.import("../src/main/web/reader.ts");

const keyed = Boolean(process.env.TAVILY_API_KEY?.trim());
const searxngConfigured = Boolean(process.env.SEARXNG_URL?.trim());
const noKey = new TavilyClient(fetch, () => undefined);
const suites = [{ name: keyed ? "keyed" : "keyless", service: new WebService() }];
if (keyed) {
  // With a key present, still prove the advertised keyless chain works.
  suites.push({
    name: "keyless",
    service: new WebService({
      search: [new SearxngSearchAdapter(), new TavilySearchAdapter(noKey), new DuckDuckGoSearchAdapter()],
      fetch: [new DirectFetchAdapter(), new TavilyFetchAdapter(noKey)],
    }),
  });
}
console.log(JSON.stringify({ tavilyKeyConfigured: keyed, searxngConfigured }));

const queries = [
  "tokio task spawn_blocking site:docs.rs",
  "React server components site:react.dev",
  "TypeScript satisfies operator site:typescriptlang.org",
];
let failed = 0;
for (const { name, service } of suites) {
  for (const query of queries) {
    try {
      const start = performance.now();
      const cold = await service.search({ query, max_results: 3 });
      const coldMs = Math.round(performance.now() - start);
      const hotStart = performance.now();
      const hot = await service.search({ query, max_results: 3 });
      const hotMs = Math.round((performance.now() - hotStart) * 100) / 100;
      assert.equal(hot.cache, "hit");
      assert.deepEqual(hot.value, cold.value);
      assert.ok(["tavily", "searxng", "duckduckgo"].includes(cold.provider), `unexpected provider ${cold.provider}`);
      if (!cold.value.length) throw new Error("No results returned");
      console.log(JSON.stringify({ suite: name, query, provider: cold.provider, coldMs, hotMs, urls: cold.value.map((row) => row.url) }));
      const url = cold.value[0].url;
      const readStart = performance.now();
      const page = await service.read({ url, limit: 1000 });
      const readMs = Math.round(performance.now() - readStart);
      const readHotStart = performance.now();
      const reread = await service.read({ url, limit: 1000 });
      const readHotMs = Math.round((performance.now() - readHotStart) * 100) / 100;
      assert.equal(reread.cache, "hit");
      assert.ok(["tavily", "direct"].includes(page.provider), `unexpected fetch provider ${page.provider}`);
      if (page.page.next_offset !== null) {
        const next = await service.read({ url, snapshot: page.document.snapshot, offset: page.page.next_offset, limit: 1000 });
        assert.equal(next.cache, "hit");
        assert.equal(next.page.offset, page.page.next_offset);
      }
      console.log(JSON.stringify({
        suite: name, url, fetchProvider: page.provider, readMs, readHotMs,
        chars: page.page.total_chars, nextOffset: page.page.next_offset,
        hasCodeFence: page.document.content.includes("```"), hasMarkdownLink: /\]\(https?:/.test(page.document.content),
      }));
    } catch (error) {
      failed++;
      console.error(JSON.stringify({ suite: name, query, error: String(error) }));
    }
  }
}

// Direct probes for the keyless alternatives: the chain above may have answered
// every query through Tavily, so exercise DuckDuckGo and the local reader too.
const probeSignal = () => AbortSignal.timeout(30_000);

try {
  const start = performance.now();
  const hits = await new DuckDuckGoSearchAdapter().search("tokio spawn_blocking site:docs.rs", 3, probeSignal());
  console.log(JSON.stringify({ probe: "duckduckgo", ms: Math.round(performance.now() - start), urls: hits.map((hit) => hit.url) }));
  if (!hits.length) throw new Error("DuckDuckGo returned no results");
} catch (error) {
  failed++;
  console.error(JSON.stringify({ probe: "duckduckgo", error: String(error) }));
}

try {
  const start = performance.now();
  const document = await new DirectFetchAdapter().fetch("https://docs.rs/tokio/latest/tokio/task", probeSignal());
  const content = validateContent(document.content);
  console.log(JSON.stringify({
    probe: "direct-fetch", ms: Math.round(performance.now() - start), chars: content.length,
    hasCodeFence: content.includes("```"), hasMarkdownLink: /\]\(https?:/.test(content),
  }));
} catch (error) {
  failed++;
  console.error(JSON.stringify({ probe: "direct-fetch", error: String(error) }));
}

if (searxngConfigured) {
  try {
    const start = performance.now();
    const hits = await new SearxngSearchAdapter().search("tokio spawn_blocking site:docs.rs", 3, probeSignal());
    console.log(JSON.stringify({ probe: "searxng", ms: Math.round(performance.now() - start), urls: hits.map((hit) => hit.url) }));
    if (!hits.length) throw new Error("SearXNG returned no results");
  } catch (error) {
    failed++;
    console.error(JSON.stringify({ probe: "searxng", error: String(error) }));
  }
} else {
  console.log(JSON.stringify({ probe: "searxng", skipped: "SEARXNG_URL is not set" }));
}
if (failed) process.exitCode = 1;
