import { publicUrl } from "./url";
import { TavilyClient } from "./tavily";

export type SearchProviderId = "tavily" | "searxng" | "duckduckgo";
export type FetchProviderId = "tavily" | "direct";

export interface SearchHit { title: string; url: string; content: string }
export interface FetchedDocument { url: string; content: string }

/** One remote capability. `scope()` must be deterministic per configuration and
 * must never contain a credential, because it participates in cache keys. */
export interface SearchAdapter {
  readonly id: SearchProviderId;
  available(): boolean;
  usesCredentials(): boolean;
  scope(): string;
  search(query: string, count: number, signal: AbortSignal): Promise<SearchHit[]>;
}

export interface FetchAdapter {
  readonly id: FetchProviderId;
  available(): boolean;
  usesCredentials(): boolean;
  scope(): string;
  fetch(url: string, signal: AbortSignal): Promise<FetchedDocument>;
}

export class TavilySearchAdapter implements SearchAdapter {
  readonly id = "tavily" as const;

  constructor(private readonly client = new TavilyClient()) {}

  // Tavily works with or without a key: keyless access is an official mode.
  available(): boolean { return true; }

  usesCredentials(): boolean { return Boolean(this.client.credentials().key); }

  scope(): string {
    const { key, scope } = this.client.credentials();
    return key ? `keyed:${scope}` : "keyless";
  }

  async search(query: string, count: number, signal: AbortSignal): Promise<SearchHit[]> {
    const credentials = this.client.credentials();
    const data = await this.client.request("search", {
      query, max_results: count, search_depth: "basic", topic: "general",
      include_answer: false, include_raw_content: false,
    }, signal, credentials.key);
    if (!Array.isArray(data.results)) throw new Error("Tavily search returned no result list.");
    const hits: SearchHit[] = [];
    for (const row of data.results) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as Record<string, unknown>;
      if (typeof item.url !== "string") continue;
      let url: string;
      try { url = publicUrl(item.url); } catch { continue; }
      hits.push({
        url,
        title: typeof item.title === "string" ? item.title : url,
        content: typeof item.content === "string" ? item.content : "",
      });
    }
    // A challenge or a malformed response must not become a successful provider result.
    if (data.results.length && !hits.length) throw new Error("Tavily returned no usable HTTP(S) results.");
    return hits;
  }
}

export class TavilyFetchAdapter implements FetchAdapter {
  readonly id = "tavily" as const;

  constructor(private readonly client = new TavilyClient()) {}

  available(): boolean { return true; }

  usesCredentials(): boolean { return Boolean(this.client.credentials().key); }

  scope(): string {
    const { key, scope } = this.client.credentials();
    return key ? `keyed:${scope}` : "keyless";
  }

  async fetch(url: string, signal: AbortSignal): Promise<FetchedDocument> {
    const credentials = this.client.credentials();
    const data = await this.client.request("extract", {
      urls: [url], extract_depth: "basic", format: "markdown", timeout: 25,
      include_images: false,
    }, signal, credentials.key);
    const rows = Array.isArray(data.results) ? data.results : [];
    const row = rows.find((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const candidate = (item as Record<string, unknown>).url;
      try { return typeof candidate === "string" && publicUrl(candidate) === url; }
      catch { return false; }
    }) as Record<string, unknown> | undefined;
    if (!row || typeof row.raw_content !== "string") {
      throw new Error("The extractor could not read this URL. Try the browser for a rendered page or use another source.");
    }
    return { url, content: row.raw_content };
  }
}
