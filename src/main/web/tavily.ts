import { createHash } from "node:crypto";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export function publicUrl(raw: string): string {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP(S) URL without embedded credentials.");
  }
  // Fragments do not change the HTTP resource. Paths, queries and schemes do.
  url.hash = "";
  return url.href;
}

export class TavilyClient {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly getKey = () => process.env.TAVILY_API_KEY?.trim()) {}

  credentials(): { key?: string; scope: string } {
    const key = this.getKey();
    return { key, scope: key ? createHash("sha256").update(key).digest("hex") : "keyless" };
  }

  async request(endpoint: "search" | "extract", body: object, signal: AbortSignal, key?: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`https://api.tavily.com/${endpoint}`, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : { "X-Tavily-Access-Mode": "keyless" }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get("retry-after");
      const hint = response.status === 429 || response.status === 432 || response.status === 433
        ? ` Rate limit reached.${retry ? ` Retry after ${retry} seconds.` : ""} Set TAVILY_API_KEY for account limits, or retry later.`
        : response.status === 401 ? " Check TAVILY_API_KEY." : "";
      throw new Error(`Tavily ${endpoint} returned HTTP ${response.status}.${hint}`);
    }
    if (!response.body) throw new Error("Tavily returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error("Tavily response exceeded 5 MiB; narrow the request.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Tavily returned invalid JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Tavily returned an invalid response.");
    return data as Record<string, unknown>;
  }
}
