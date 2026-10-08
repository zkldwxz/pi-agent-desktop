import { createHash } from "node:crypto";
import { RequestCache } from "./cache";
import { CHALLENGE_ERROR } from "./html";
import { publicUrl } from "./url";
import type { FetchAdapter, FetchProviderId, SearchAdapter, SearchHit, SearchProviderId } from "./providers";
import { TavilyFetchAdapter, TavilySearchAdapter } from "./providers";
import { SearxngSearchAdapter } from "./searxng";
import { DuckDuckGoSearchAdapter } from "./duckduckgo";
import { DirectFetchAdapter } from "./reader";

export type { FetchProviderId, SearchHit, SearchProviderId } from "./providers";

export interface WebDocument { url: string; content: string; snapshot: string; fetchedAt: number; provider: FetchProviderId }
export interface SearchInput { query: string; max_results?: number; refresh?: boolean }
export interface FetchInput { url: string; offset?: number; limit?: number; snapshot?: string; refresh?: boolean }
export interface SearchResult { value: SearchHit[]; provider: SearchProviderId; cache: "hit" | "miss" | "shared" }
export interface ReadResult { document: WebDocument; page: ReturnType<typeof pageDocument>; provider: FetchProviderId; cache: "hit" | "miss" | "shared" }

export interface WebServiceOptions {
  /** Adapters are ordered per call from the Tavily key state: keyed access
   * prefers Tavily, keyless access prefers SearXNG then Tavily then DDG. */
  search?: SearchAdapter[];
  fetch?: FetchAdapter[];
  now?: () => number;
  cooldownMs?: number;
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

interface SearchEntry { hits: SearchHit[]; provider: SearchProviderId }

/** Skips a provider for a while after two consecutive failures so a blocked or
 * rate-limited endpoint does not add its timeout to every later request. */
class ProviderHealth {
  private readonly strikes = new Map<string, number>();
  private readonly blockedUntil = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  blocked(id: string, now: number): boolean {
    const until = this.blockedUntil.get(id);
    if (until === undefined) return false;
    if (until > now) return true;
    this.blockedUntil.delete(id);
    return false;
  }

  failed(id: string, now: number): void {
    const strikes = (this.strikes.get(id) ?? 0) + 1;
    if (strikes >= 2) {
      this.strikes.delete(id);
      this.blockedUntil.set(id, now + this.cooldownMs);
    } else {
      this.strikes.set(id, strikes);
    }
  }

  succeeded(id: string): void {
    this.strikes.delete(id);
    this.blockedUntil.delete(id);
  }
}

/** One process-wide service: parent and child agents share only immutable web data. */
export class WebService {
  private readonly searches: RequestCache<SearchEntry>;
  private readonly documents: RequestCache<WebDocument>;
  private readonly searchAdapters: SearchAdapter[];
  private readonly fetchAdapters: FetchAdapter[];
  private readonly now: () => number;
  private readonly health: ProviderHealth;

  constructor(options: WebServiceOptions = {}) {
    this.searchAdapters = options.search ?? [new TavilySearchAdapter(), new SearxngSearchAdapter(), new DuckDuckGoSearchAdapter()];
    this.fetchAdapters = options.fetch ?? [new TavilyFetchAdapter(), new DirectFetchAdapter()];
    this.now = options.now ?? Date.now;
    this.health = new ProviderHealth(options.cooldownMs ?? 120_000);
    this.searches = new RequestCache<SearchEntry>(5 * 60_000, 64, 4 * 1024 * 1024, jsonBytes, this.now);
    this.documents = new RequestCache<WebDocument>(15 * 60_000, 32, 16 * 1024 * 1024, jsonBytes, this.now);
  }

  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchResult> {
    const query = input.query.trim();
    if (!query || query.length > 2000) throw new Error("Query must contain 1–2000 characters.");
    const count = integer(input.max_results ?? 5, 1, 10, "max_results");
    const key = JSON.stringify([this.adapterScope(this.searchAdapters), query, count]);
    const result = await this.searches.get(key, async (requestSignal) => {
      const chain = this.searchChain();
      if (!chain.length) throw new Error("No web search provider is available. Set TAVILY_API_KEY or SEARXNG_URL.");
      const failures: string[] = [];
      for (const adapter of chain) {
        const healthKey = `search:${adapter.id}`;
        if (this.health.blocked(healthKey, this.now())) {
          failures.push(`${adapter.id}: temporarily skipped after repeated failures`);
          continue;
        }
        try {
          const hits = normalizeHits(await adapter.search(query, count, requestSignal), count);
          this.health.succeeded(healthKey);
          return { hits, provider: adapter.id };
        } catch (error) {
          // A cancelled request must not mark its provider unhealthy, and must
          // never be cached: RequestCache only stores fulfilled values.
          if (requestSignal.aborted) throw error;
          this.health.failed(healthKey, this.now());
          failures.push(`${adapter.id}: ${errorText(error)}`);
        }
      }
      throw new Error(`Web search failed. ${failures.join("; ")}`);
    }, { refresh: input.refresh, signal });
    return { value: result.value.hits, provider: result.value.provider, cache: result.cache };
  }

  async read(input: FetchInput, signal?: AbortSignal): Promise<ReadResult> {
    signal?.throwIfAborted();
    const url = publicUrl(input.url);
    const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = integer(input.limit ?? 12_000, 1, 24_000, "limit");
    if (offset > 0 && !input.snapshot) throw new Error("Continuation requires the snapshot returned by the first web_fetch call.");
    if (input.refresh && (input.snapshot || offset)) throw new Error("Refresh starts a new document; omit snapshot and offset.");
    const key = JSON.stringify([this.adapterScope(this.fetchAdapters), url]);
    if (input.snapshot) {
      const document = this.documents.peek(key);
      if (!document || document.snapshot !== input.snapshot) {
        throw new Error("The cached document expired, was evicted, or changed. Start again without snapshot and offset.");
      }
      return { document, page: pageDocument(document.content, offset, limit), provider: document.provider, cache: "hit" as const };
    }
    const result = await this.documents.get(key, async (requestSignal) => {
      const chain = this.fetchChain();
      if (!chain.length) throw new Error("No web fetch provider is available.");
      const failures: string[] = [];
      for (const adapter of chain) {
        const healthKey = `fetch:${adapter.id}`;
        if (this.health.blocked(healthKey, this.now())) {
          failures.push(`${adapter.id}: temporarily skipped after repeated failures`);
          continue;
        }
        try {
          const fetched = await adapter.fetch(url, requestSignal);
          const content = validateContent(fetched.content);
          this.health.succeeded(healthKey);
          return {
            url: fetched.url,
            content,
            snapshot: hash(`${fetched.url}\n${content}`),
            fetchedAt: this.now(),
            provider: adapter.id,
          } satisfies WebDocument;
        } catch (error) {
          if (requestSignal.aborted) throw error;
          this.health.failed(healthKey, this.now());
          failures.push(`${adapter.id}: ${errorText(error)}`);
        }
      }
      throw new Error(`Web fetch failed. ${failures.join("; ")}`);
    }, { refresh: input.refresh, signal });
    return { document: result.value, page: pageDocument(result.value.content, offset, limit), provider: result.value.provider, cache: result.cache };
  }

  private searchChain(): SearchAdapter[] {
    const tavily = this.searchAdapters.find((adapter) => adapter.id === "tavily");
    const searxng = this.searchAdapters.find((adapter) => adapter.id === "searxng");
    const duckduckgo = this.searchAdapters.find((adapter) => adapter.id === "duckduckgo");
    const ordered = tavily?.usesCredentials() ? [tavily, searxng, duckduckgo] : [searxng, tavily, duckduckgo];
    return ordered.filter((adapter): adapter is SearchAdapter => Boolean(adapter?.available()));
  }

  private fetchChain(): FetchAdapter[] {
    const tavily = this.fetchAdapters.find((adapter) => adapter.id === "tavily");
    const direct = this.fetchAdapters.find((adapter) => adapter.id === "direct");
    const ordered = tavily?.usesCredentials() ? [tavily, direct] : [direct, tavily];
    return ordered.filter((adapter): adapter is FetchAdapter => Boolean(adapter?.available()));
  }

  /** Cache identity of the provider configuration. Adapter scopes must be
   * digests, never raw keys or instance URLs. */
  private adapterScope(adapters: Array<{ id: string; scope(): string }>): string {
    return adapters.map((adapter) => `${adapter.id}=${adapter.scope()}`).join("|");
  }
}

function normalizeHits(hits: SearchHit[], count: number): SearchHit[] {
  const results: SearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    let url: string;
    try { url = publicUrl(hit.url); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: typeof hit.title === "string" ? hit.title.slice(0, 300) || url : url,
      content: typeof hit.content === "string" ? hit.content.slice(0, 1500) : "",
    });
    if (results.length === count) break;
  }
  return results;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

export function validateContent(raw: string): string {
  const content = raw.replace(/\r\n?/g, "\n").trim();
  const heading = content.slice(0, 300).trim();
  if (content.replace(/\s/g, "").length < 80) throw new Error("The extracted page has too little readable content; try the browser or another source.");
  if (/^(?:<!doctype\s+html|<html\b)/i.test(heading)) throw new Error("The extraction returned HTML instead of readable Markdown.");
  if (/^(?:#{1,6}\s*)?(?:just a moment[.!…]*|access denied|verify (?:that )?you are human|checking your browser|请稍候|安全验证)(?:\s|$)/i.test(heading)) {
    throw new Error(CHALLENGE_ERROR);
  }
  return content;
}

/** Offsets count UTF-16 code units, just like JS slice; never split a surrogate pair. */
export function pageDocument(content: string, offset: number, limit: number) {
  if (offset > content.length) throw new Error("offset is beyond the end of this document.");
  if (offset && /[\uDC00-\uDFFF]/.test(content[offset] ?? "") && /[\uD800-\uDBFF]/.test(content[offset - 1])) {
    throw new Error("offset splits a Unicode character; use the returned next_offset.");
  }
  let end = Math.min(content.length, offset + limit);
  if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
  if (end === offset && end < content.length) end = Math.min(content.length, offset + 2);
  return { text: content.slice(offset, end), offset, next_offset: end < content.length ? end : null, total_chars: content.length };
}
