import { createHash } from "node:crypto";
import { decodeBytes, readBytes } from "./http";
import { publicUrl } from "./url";
import type { SearchAdapter, SearchHit } from "./providers";

const MAX_JSON_BYTES = 5 * 1024 * 1024;

/**
 * Self-hosted SearXNG exposes a JSON API only when the instance enables
 * `search.formats: json` (docs.searxng.org/dev/search_api.html). Many public
 * instances leave it off, so an HTTP 403 with an HTML body is an expected
 * failure mode and must never be parsed as results.
 */
export class SearxngSearchAdapter implements SearchAdapter {
  readonly id = "searxng" as const;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly getBaseUrl = () => process.env.SEARXNG_URL?.trim(),
    private readonly timeoutMs = 20_000,
  ) {}

  available(): boolean { return Boolean(this.getBaseUrl()); }

  usesCredentials(): boolean { return false; }

  /** The instance URL never enters the cache key or an error message: self-hosted
   * instances are commonly reachable only through a secret path. */
  scope(): string {
    const raw = this.getBaseUrl();
    return raw ? `instance:${createHash("sha256").update(raw).digest("hex").slice(0, 16)}` : "unconfigured";
  }

  async search(query: string, count: number, signal: AbortSignal): Promise<SearchHit[]> {
    const url = new URL("search", this.base());
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");
    url.searchParams.set("language", "auto");
    url.searchParams.set("pageno", "1");
    url.searchParams.set("safesearch", "0");
    const response = await this.fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const hint = response.status === 403
        ? " The instance may have the JSON format disabled (search.formats)."
        : response.status === 429 ? " The instance is rate-limiting requests." : "";
      throw new Error(`SearXNG returned HTTP ${response.status}.${hint}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const text = decodeBytes(await readBytes(response, MAX_JSON_BYTES), contentType);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("SearXNG did not return JSON; enable search.formats: json on the instance.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("SearXNG returned an invalid response.");
    const rows = (data as { results?: unknown }).results;
    if (!Array.isArray(rows)) throw new Error("SearXNG returned no result list.");
    const hits: SearchHit[] = [];
    for (const row of rows.slice(0, 100)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as Record<string, unknown>;
      if (typeof item.url !== "string") continue;
      let hitUrl: string;
      try { hitUrl = publicUrl(item.url); } catch { continue; }
      hits.push({
        url: hitUrl,
        title: typeof item.title === "string" ? item.title : hitUrl,
        content: typeof item.content === "string" ? item.content : "",
      });
    }
    if (rows.length && !hits.length) throw new Error("SearXNG returned no usable HTTP(S) results.");
    return hits;
  }

  private base(): URL {
    const raw = this.getBaseUrl();
    if (!raw) throw new Error("SEARXNG_URL is not set.");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("SEARXNG_URL is not a valid URL.");
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error("SEARXNG_URL must be an HTTP(S) URL without embedded credentials.");
    }
    // A base path such as https://host/searx must keep its segment, so the
    // relative "search" is resolved against a directory-shaped URL.
    return new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
  }
}
