import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WebService } from "./service";

const sharedService = new WebService();

export function registerWebTools(pi: ExtensionAPI, service = sharedService): void {
  pi.registerTool({
    name: "web_search",
    label: "Search web",
    executionMode: "parallel",
    promptSnippet: "Search the web for ranked source links and snippets.",
    description: "Search public web pages. Tavily is used when TAVILY_API_KEY is set; without a key a configured SEARXNG_URL instance, Tavily's keyless mode, or DuckDuckGo serve the query in that order. Returns ranked titles, URLs and snippets; use web_fetch for source text. Results are cached for 5 minutes. Queries leave the machine to the selected provider. Use refresh for current information.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 2000, description: "Focused search query; include site:domain for a preferred source." }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Number of results (default 5)." })),
      refresh: Type.Optional(Type.Boolean({ description: "Fetch fresh results instead of using a cached response." })),
    }),
    async execute(_id, params, signal) {
      const started = performance.now();
      const result = await service.search(params, signal);
      const text = result.value.length
        ? result.value.map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.url}\n${hit.content}`).join("\n\n")
        : "No web results found. Try a more specific or differently worded query.";
      return {
        content: [{ type: "text", text }],
        details: { cache: result.cache, elapsedMs: Math.round(performance.now() - started), provider: result.provider, results: result.value },
      };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Read web page",
    executionMode: "parallel",
    promptSnippet: "Read a web source as paginated Markdown; continue with snapshot and next_offset.",
    description: "Read public page content as Markdown. Tavily extraction is preferred when TAVILY_API_KEY is set; without a key the page is fetched directly and converted locally, falling back to Tavily keyless extraction. The complete extraction is cached for 15 minutes in bounded memory. Continue with the same url, snapshot and next_offset. Cache eviction/expiry requires restarting. Use the browser for pages that cannot be fetched.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute public HTTP(S) URL, without embedded credentials." }),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "UTF-16 character offset; use next_offset from the previous page (default 0)." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 24_000, description: "Maximum characters per page (default 12000)." })),
      snapshot: Type.Optional(Type.String({ description: "Document version returned by the first page. Required for continuation." })),
      refresh: Type.Optional(Type.Boolean({ description: "Refresh the document; omit offset and snapshot when refreshing." })),
    }),
    async execute(_id, params, signal) {
      const started = performance.now();
      const { document, page, cache, provider } = await service.read(params, signal);
      const continuation = page.next_offset === null
        ? "End of extracted content."
        : `Continue web_fetch with url=${JSON.stringify(params.url)}, snapshot=${JSON.stringify(document.snapshot)}, offset=${page.next_offset}.`;
      return {
        content: [{ type: "text", text: `Source: ${document.url}\nSnapshot: ${document.snapshot}\nCharacters ${page.offset}–${page.offset + page.text.length} of ${page.total_chars}\n\n${page.text}\n\n${continuation}` }],
        details: {
          url: document.url, snapshot: document.snapshot, fetchedAt: document.fetchedAt,
          offset: page.offset, next_offset: page.next_offset, total_chars: page.total_chars,
          cache, elapsedMs: Math.round(performance.now() - started), provider,
        },
      };
    },
  });
}
