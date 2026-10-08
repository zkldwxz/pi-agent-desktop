import { CHALLENGE_ERROR, htmlToMarkdown, looksLikeChallenge } from "./html";
import { decodeBytes, readBytes } from "./http";
import type { FetchAdapter, FetchedDocument } from "./providers";
import { assertPublicHost, publicUrl, type HostLookup } from "./url";

export interface DirectFetchOptions {
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxChars?: number;
}

const REQUEST_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.8,zh-CN;q=0.7",
  // Honest product UA; sites that block it are reported as errors, not faked.
  "User-Agent": "pi-agent-desktop/0.1 web_fetch",
};

/**
 * Fetches a page without a third-party key and converts it to Markdown locally.
 * Because the URL is model-supplied this adapter is the SSRF boundary: every
 * hop is resolved and checked, redirects are followed manually, downgrades to
 * plain HTTP are refused, and response parsing is byte-bounded.
 */
export class DirectFetchAdapter implements FetchAdapter {
  readonly id = "direct" as const;

  constructor(private readonly options: DirectFetchOptions = {}) {}

  available(): boolean { return true; }

  usesCredentials(): boolean { return false; }

  scope(): string { return "public"; }

  async fetch(url: string, signal: AbortSignal): Promise<FetchedDocument> {
    const fetcher = this.options.fetcher ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const maxBytes = this.options.maxBytes ?? 4 * 1024 * 1024;
    const maxRedirects = this.options.maxRedirects ?? 5;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let current = new URL(publicUrl(url));
    const visited = new Set<string>([current.href]);
    for (let hop = 0; ; hop++) {
      if (hop > maxRedirects) throw new Error(`The page redirected more than ${maxRedirects} times.`);
      await assertPublicHost(current, this.options.lookup);
      const response = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        headers: REQUEST_HEADERS,
        signal: deadline,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error(`The page returned HTTP ${response.status} without a redirect target.`);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("The page redirected to an invalid address.");
        }
        if (!/^https?:$/.test(next.protocol) || next.username || next.password) {
          throw new Error("The page redirected to a non-HTTP(S) address.");
        }
        if (current.protocol === "https:" && next.protocol === "http:") {
          throw new Error("The page redirected to an insecure HTTP address.");
        }
        next.hash = "";
        if (visited.has(next.href)) throw new Error("The page redirects in a loop.");
        visited.add(next.href);
        current = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`The page returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      const text = decodeBytes(await readBytes(response, maxBytes), contentType);
      return { url: current.href, content: toMarkdown(text, contentType, current.href, this.options.maxChars ?? 400_000) };
    }
  }
}

function toMarkdown(text: string, contentType: string, baseUrl: string, maxChars: number): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const looksLikeHtml = type === "text/html" || type === "application/xhtml+xml" || (type === "" && /^\s*</.test(text));
  if (looksLikeHtml) {
    if (looksLikeChallenge(text)) throw new Error(CHALLENGE_ERROR);
    return htmlToMarkdown(text, baseUrl, maxChars);
  }
  if (type === "" || type === "text/plain" || type === "text/markdown" || type === "text/x-markdown" || type === "application/xml" || type === "text/xml") {
    return text.replace(/\r\n?/g, "\n").trim();
  }
  if (type === "application/json" || type.endsWith("+json")) {
    return `\`\`\`json\n${text.trim()}\n\`\`\``;
  }
  throw new Error(`The page returned unsupported content type "${type || "unknown"}"; try another source.`);
}
