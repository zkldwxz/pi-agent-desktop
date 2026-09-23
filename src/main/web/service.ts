import { createHash } from "node:crypto";
import { RequestCache } from "./cache";
import { publicUrl, TavilyClient } from "./tavily";

export interface SearchHit { title: string; url: string; content: string }
export interface WebDocument { url: string; content: string; snapshot: string; fetchedAt: number }
export interface SearchInput { query: string; max_results?: number; refresh?: boolean }
export interface FetchInput { url: string; offset?: number; limit?: number; snapshot?: string; refresh?: boolean }
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** One process-wide service: parent and child agents share only immutable web data. */
export class WebService {
  private readonly searches = new RequestCache<SearchHit[]>(5 * 60_000, 64, 4 * 1024 * 1024, jsonBytes);
  private readonly documents = new RequestCache<WebDocument>(15 * 60_000, 32, 16 * 1024 * 1024, jsonBytes);

  constructor(private readonly client = new TavilyClient()) {}

  async search(input: SearchInput, signal?: AbortSignal) {
    const query = input.query.trim();
    if (!query || query.length > 2000) throw new Error("Query must contain 1–2000 characters.");
    const count = integer(input.max_results ?? 5, 1, 10, "max_results");
    const credentials = this.client.credentials();
    const key = JSON.stringify([credentials.scope, query, count]);
    return this.searches.get(key, async (requestSignal) => {
      const data = await this.client.request("search", {
        query, max_results: count, search_depth: "basic", topic: "general",
        include_answer: false, include_raw_content: false,
      }, requestSignal, credentials.key);
      if (!Array.isArray(data.results)) throw new Error("Tavily search returned no result list.");
      const results: SearchHit[] = [];
      const seen = new Set<string>();
      for (const row of data.results) {
        if (!row || typeof row !== "object" || typeof row.url !== "string") continue;
        let url: string;
        try { url = publicUrl(row.url); } catch { continue; }
        if (seen.has(url)) continue;
        seen.add(url);
        results.push({
          url,
          title: typeof row.title === "string" ? row.title.slice(0, 300) : url,
          content: typeof row.content === "string" ? row.content.slice(0, 1500) : "",
        });
        if (results.length === count) break;
      }
      // A challenge or a malformed response must not become a successful cache entry.
      if (data.results.length && !results.length) throw new Error("Tavily returned no usable HTTP(S) results.");
      return results;
    }, { refresh: input.refresh, signal });
  }

  async read(input: FetchInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const url = publicUrl(input.url);
    const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = integer(input.limit ?? 12_000, 1, 24_000, "limit");
    if (offset > 0 && !input.snapshot) throw new Error("Continuation requires the snapshot returned by the first web_fetch call.");
    if (input.refresh && (input.snapshot || offset)) throw new Error("Refresh starts a new document; omit snapshot and offset.");
    const credentials = this.client.credentials();
    const key = JSON.stringify([credentials.scope, url]);
    if (input.snapshot) {
      const document = this.documents.peek(key);
      if (!document || document.snapshot !== input.snapshot) {
        throw new Error("The cached document expired, was evicted, or changed. Start again without snapshot and offset.");
      }
      return { document, page: pageDocument(document.content, offset, limit), cache: "hit" as const };
    }
    const result = await this.documents.get(key, async (requestSignal) => {
      const data = await this.client.request("extract", {
        urls: [url], extract_depth: "basic", format: "markdown", timeout: 25,
        include_images: false,
      }, requestSignal, credentials.key);
      const rows = Array.isArray(data.results) ? data.results : [];
      const row = rows.find((item) => {
        try { return item && typeof item.url === "string" && publicUrl(item.url) === url; }
        catch { return false; }
      });
      if (!row || typeof row.raw_content !== "string") {
        throw new Error("Tavily could not extract this URL. Try the browser for a rendered page or use another source.");
      }
      const content = validateContent(row.raw_content);
      return { url, content, snapshot: hash(`${url}\n${content}`), fetchedAt: Date.now() };
    }, { refresh: input.refresh, signal });
    return { document: result.value, page: pageDocument(result.value.content, offset, limit), cache: result.cache };
  }
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
    throw new Error("The source returned a challenge or access-denied page; use another source.");
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
