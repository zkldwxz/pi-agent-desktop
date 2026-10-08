import { decodeBytes, readBytes } from "./http";
import { decodeEntities } from "./html";
import { publicUrl } from "./url";
import type { SearchAdapter, SearchHit } from "./providers";

const ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export const DUCKDUCKGO_BLOCKED_ERROR = "DuckDuckGo blocked this automated search; retry later or configure SEARXNG_URL.";

/**
 * DuckDuckGo publishes no web-results API; only the Instant Answer API is
 * official, and its results are not a general web search. The no-JS HTML
 * endpoint is an undocumented interface with bot protection, so this adapter
 * treats "no anchors", anomaly pages and unusual status codes as failures.
 * A storefront UA is sent because the endpoint serves anomalies to plain
 * library clients more aggressively than to browsers.
 */
export class DuckDuckGoSearchAdapter implements SearchAdapter {
  readonly id = "duckduckgo" as const;

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 15_000) {}

  available(): boolean { return true; }

  usesCredentials(): boolean { return false; }

  scope(): string { return "public"; }

  async search(query: string, count: number, signal: AbortSignal): Promise<SearchHit[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("kl", "wt-wt");
    const response = await this.fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
    }
    const text = decodeBytes(await readBytes(response, MAX_HTML_BYTES), response.headers.get("content-type") ?? "");
    return parseDuckDuckGoHtml(text, count, url.href);
  }
}

/** Exported separately so fixtures can exercise the parser without network. */
export function parseDuckDuckGoHtml(html: string, count: number, baseUrl: string): SearchHit[] {
  const lower = html.toLowerCase();
  if (lower.includes("anomaly-modal") || lower.includes("unfortunately, bots use duckduckgo")) {
    throw new Error(DUCKDUCKGO_BLOCKED_ERROR);
  }
  const titleAnchors: Array<{ end: number; href: string | null; title: string }> = [];
  const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR.exec(html)) !== null) {
    const className = classAttribute(match[1]);
    if (!/(?:^|\s)result__a(?:\s|$)/.test(className) && !/(?:^|\s)result-link(?:\s|$)/.test(className)) continue;
    titleAnchors.push({
      end: ANCHOR.lastIndex,
      href: decodeDuckDuckGoUrl(attribute(match[1], "href"), baseUrl),
      title: stripText(match[2]),
    });
    if (titleAnchors.length >= Math.max(count, 1) * 3) break; // bound work past the requested count
  }
  const snippets = snippetPositions(html);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const anchor of titleAnchors) {
    if (!anchor.href || !anchor.title || seen.has(anchor.href)) continue;
    seen.add(anchor.href);
    const snippet = snippets.find((candidate) => candidate.start >= anchor.end);
    hits.push({ url: anchor.href, title: anchor.title, content: snippet ? stripText(snippet.html) : "" });
    if (hits.length === count) break;
  }
  if (hits.length) return hits;
  // A genuine empty result page is a valid answer; anything else is a wall.
  if (/\bno results\b/.test(lower)) return [];
  throw new Error("DuckDuckGo returned no parseable search results.");
}

/** Both the HTML and the lite endpoints redirect through /l/?uddg=<target>. */
function decodeDuckDuckGoUrl(raw: string, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname === "/l/") {
      const target = url.searchParams.get("uddg");
      return target ? publicUrl(target) : null;
    }
    return publicUrl(url.href);
  } catch {
    return null;
  }
}

/** Collects snippet elements by opening tag. Matching whole containers with a
 * paired-tag regex swallows nested anchors, so each candidate is closed with an
 * explicit search for its own end tag. */
function snippetPositions(html: string): Array<{ start: number; html: string }> {
  const positions: Array<{ start: number; html: string }> = [];
  const lower = html.toLowerCase();
  const opening = /<(a|td|div|span)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(html)) !== null) {
    const className = classAttribute(match[2]);
    if (!/(?:^|\s)result__snippet(?:\s|$)/.test(className) && !/(?:^|\s)result-snippet(?:\s|$)/.test(className)) continue;
    const end = lower.indexOf(`</${match[1].toLowerCase()}>`, opening.lastIndex);
    if (end === -1) continue;
    positions.push({ start: match.index, html: html.slice(opening.lastIndex, end) });
  }
  return positions;
}

function stripText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function classAttribute(attributes: string): string {
  const match = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  return match?.[1] ?? match?.[2] ?? "";
}

function attribute(attributes: string, name: string): string {
  const quoted = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attributes);
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  return new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attributes)?.[1] ?? "";
}
