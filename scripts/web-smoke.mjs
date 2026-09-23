// Explicit network smoke test: three public queries and their first source.
// Logs timings, URLs and cache behavior, never API keys or full page bodies.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { WebService } = await jiti.import("../src/main/web/service.ts");
const service = new WebService();
const queries = [
  "tokio task spawn_blocking site:docs.rs",
  "React server components site:react.dev",
  "TypeScript satisfies operator site:typescriptlang.org",
];
let failed = 0;
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
    console.log(JSON.stringify({ query, coldMs, hotMs, urls: cold.value.map((row) => row.url) }));
    if (!cold.value.length) throw new Error("No results returned");
    const url = cold.value[0].url;
    const readStart = performance.now();
    const page = await service.read({ url, limit: 1000 });
    const readMs = Math.round(performance.now() - readStart);
    const readHotStart = performance.now();
    const reread = await service.read({ url, limit: 1000 });
    const readHotMs = Math.round((performance.now() - readHotStart) * 100) / 100;
    assert.equal(reread.cache, "hit");
    if (page.page.next_offset !== null) {
      const next = await service.read({ url, snapshot: page.document.snapshot, offset: page.page.next_offset, limit: 1000 });
      assert.equal(next.cache, "hit");
      assert.equal(next.page.offset, page.page.next_offset);
    }
    console.log(JSON.stringify({ url, readMs, readHotMs, chars: page.page.total_chars, nextOffset: page.page.next_offset, hasCodeFence: page.document.content.includes("```"), hasMarkdownLink: /\]\(https?:/.test(page.document.content) }));
  } catch (error) {
    failed++;
    console.error(JSON.stringify({ query, error: String(error) }));
  }
}
if (failed) process.exitCode = 1;
