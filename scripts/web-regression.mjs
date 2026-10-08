import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { RequestCache } = await jiti.import("../src/main/web/cache.ts");
const { WebService, pageDocument, validateContent } = await jiti.import("../src/main/web/service.ts");
const { TavilyClient, publicUrl } = await jiti.import("../src/main/web/tavily.ts");
const { assertPublicHost, isPrivateAddress } = await jiti.import("../src/main/web/url.ts");
const { decodeEntities, htmlToMarkdown, looksLikeChallenge } = await jiti.import("../src/main/web/html.ts");
const { parseDuckDuckGoHtml } = await jiti.import("../src/main/web/duckduckgo.ts");
const { SearxngSearchAdapter } = await jiti.import("../src/main/web/searxng.ts");
const { DirectFetchAdapter } = await jiti.import("../src/main/web/reader.ts");
const { TavilySearchAdapter, TavilyFetchAdapter } = await jiti.import("../src/main/web/providers.ts");
const { registerWebTools } = await jiti.import("../src/main/web/extension.ts");

const cache = (now = Date.now) => new RequestCache(100, 2, 8, (value) => value.length, now);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const content = "# Document\n\n" + "A complete paragraph with [links](https://example.com).\n".repeat(20) + "\n```js\nconst x = 1;\n```";
const signal = () => new AbortController().signal;
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

const searchAdapter = (id, search, options = {}) => ({
  id, search,
  available: () => true,
  usesCredentials: () => false,
  scope: () => "test",
  ...options,
});
const fetchAdapter = (id, fetch, options = {}) => ({
  id, fetch,
  available: () => true,
  usesCredentials: () => false,
  scope: () => "test",
  ...options,
});

test("cache: TTL, LRU and byte budget independently evict", async () => {
  let now = 0;
  const c = cache(() => now);
  await c.get("a", async () => "aaa");
  await c.get("b", async () => "bbb");
  assert.equal(c.peek("a"), "aaa");
  await c.get("c", async () => "ccc");
  assert.equal(c.peek("b"), undefined);
  await c.get("d", async () => "dddddd");
  assert.equal(c.peek("a"), undefined);
  assert.equal(c.peek("c"), undefined);
  now = 100;
  assert.equal(c.peek("d"), undefined);
});

test("cache: concurrent misses/refreshes share work, refresh supersedes old value", async () => {
  const c = cache();
  await c.get("a", async () => "old");
  const gate = deferred();
  let calls = 0;
  const load = async () => { calls++; return gate.promise; };
  const first = c.get("a", load, { refresh: true });
  const second = c.get("a", load, { refresh: true });
  const third = c.get("a", load);
  gate.resolve("new");
  const results = await Promise.all([first, second, third]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map((r) => r.value), ["new", "new", "new"]);
  assert.equal(results[1].cache, "shared");
  assert.equal((await c.get("a", load)).cache, "hit");
});

test("cache: failures are retried and oversized values are rejected", async () => {
  const c = cache();
  await assert.rejects(c.get("a", async () => { throw new Error("offline"); }), /offline/);
  assert.equal((await c.get("a", async () => "ok")).value, "ok");
  await assert.rejects(c.get("b", async () => "123456789"), /capacity/);
  assert.equal(c.peek("b"), undefined);
});

test("cache: one cancelled waiter does not cancel another; last waiter aborts transport", async () => {
  const c = cache();
  const gate = deferred();
  let transport;
  const load = async (abortSignal) => { transport = abortSignal; return gate.promise; };
  const a = new AbortController();
  const b = new AbortController();
  const first = c.get("a", load, { signal: a.signal });
  const second = c.get("a", load, { signal: b.signal });
  await Promise.resolve();
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(transport.aborted, false);
  gate.resolve("ok");
  assert.equal((await second).value, "ok");
  const gate2 = deferred();
  const d = new AbortController();
  const cancelled = c.get("b", async (abortSignal) => { transport = abortSignal; return gate2.promise; }, { signal: d.signal });
  await Promise.resolve();
  d.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(transport.aborted, true);
  const retry = c.get("b", async () => "fresh");
  gate2.resolve("stale");
  assert.equal((await retry).value, "fresh");
  assert.equal(c.peek("b"), "fresh");
});

test("search: preserve ranking, conservative URL dedupe, field caps and key isolation", async () => {
  const calls = [];
  const adapter = searchAdapter("duckduckgo", async (query, count) => {
    calls.push({ query, count });
    return [
      { url: "https://example.com/a#one", title: "First", content: "Top result" },
      { url: "https://example.com/a#two", title: "Duplicate" },
      { url: "https://example.com/a/", title: "Different path" },
      { url: "https://example.com/a?lang=zh", title: "Different query" },
      { url: "javascript:alert(1)", title: "Invalid" },
      { url: "https://example.com/long", title: "T".repeat(400), content: "C".repeat(2000) },
    ];
  });
  const service = new WebService({ search: [adapter] });
  const first = await service.search({ query: "  example  " });
  assert.deepEqual(first.value.map((r) => r.title), ["First", "Different path", "Different query", "T".repeat(300)]);
  assert.equal(first.provider, "duckduckgo");
  assert.equal(first.value.at(-1).content.length, 1500);
  assert.equal((await service.search({ query: "example" })).cache, "hit");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { query: "example", count: 5 });
  assert.equal((await service.search({ query: "example", max_results: 2 })).cache, "miss");
  assert.equal(calls.length, 2);
  await assert.rejects(service.search({ query: " " }), /Query/);
  await assert.rejects(service.search({ query: "x", max_results: 100 }), /max_results/);
});

test("search: keyless chain is searxng → tavily → duckduckgo, keyed prefers tavily", async () => {
  const calls = [];
  const adapters = [
    searchAdapter("tavily", async () => { calls.push("tavily"); throw new Error("offline"); }),
    searchAdapter("searxng", async () => { calls.push("searxng"); throw new Error("HTTP 403"); }, { scope: () => "instance:abc" }),
    searchAdapter("duckduckgo", async () => { calls.push("duckduckgo"); return [{ url: "https://example.com/ddg", title: "DDG", content: "" }]; }),
  ];
  const service = new WebService({ search: adapters });
  const result = await service.search({ query: "q" });
  assert.equal(result.provider, "duckduckgo");
  assert.deepEqual(calls, ["searxng", "tavily", "duckduckgo"]);
  calls.length = 0;
  const keyed = new WebService({ search: [
    searchAdapter("tavily", async () => { calls.push("tavily"); return [{ url: "https://example.com/tavily", title: "T", content: "" }]; }, { usesCredentials: () => true }),
    searchAdapter("duckduckgo", async () => { calls.push("duckduckgo"); return []; }),
  ] });
  assert.equal((await keyed.search({ query: "q" })).provider, "tavily");
  assert.deepEqual(calls, ["tavily"]);
});

test("search: provider cooldown skips repeated failures and recovers; errors never cache", async () => {
  let now = 1_000;
  const calls = [];
  const failing = searchAdapter("tavily", async () => { calls.push("tavily"); throw new Error("timed out after 35s"); });
  const working = searchAdapter("duckduckgo", async () => { calls.push("duckduckgo"); return [{ url: `https://example.com/${calls.length}`, title: "ok", content: "" }]; });
  const service = new WebService({ search: [failing, working], now: () => now, cooldownMs: 5_000 });
  await service.search({ query: "q1" });
  await service.search({ query: "q2" });
  const third = await service.search({ query: "q3" });
  assert.equal(third.provider, "duckduckgo");
  assert.equal(calls.filter((id) => id === "tavily").length, 2);
  now += 5_001;
  await service.search({ query: "q4" });
  assert.equal(calls.filter((id) => id === "tavily").length, 3);

  let attempts = 0;
  const broken = new WebService({ search: [searchAdapter("tavily", async () => { attempts++; throw new Error("down"); })], now: () => now, cooldownMs: 60_000 });
  await assert.rejects(broken.search({ query: "same" }), /tavily: down/);
  await assert.rejects(broken.search({ query: "same" }), /tavily: down/);
  assert.equal(attempts, 2);
  await assert.rejects(broken.search({ query: "other" }), /temporarily skipped/);
  assert.equal(attempts, 2);
});

test("search: a rotated Tavily key misses the cache and never appears in scope or errors", async () => {
  const requests = [];
  let key = "key-one";
  const client = new TavilyClient(async (_url, init) => {
    requests.push(init);
    return new Response(JSON.stringify({ results: [{ url: "https://example.com/", title: "Hit", content: "" }] }));
  }, () => key);
  const service = new WebService({ search: [new TavilySearchAdapter(client)] });
  await service.search({ query: "example" });
  assert.equal((await service.search({ query: "example" })).cache, "hit");
  key = "key-two";
  await service.search({ query: "example" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, "Bearer key-one");
  assert.equal(requests[1].headers.Authorization, "Bearer key-two");
  const adapter = new TavilySearchAdapter(new TavilyClient(fetch, () => "key-three"));
  assert.ok(!adapter.scope().includes("key-three"));
  const failing = new WebService({ search: [new TavilySearchAdapter(new TavilyClient(async () => new Response("no", { status: 401 }), () => "key-four"))] });
  await assert.rejects(failing.search({ query: "x" }), (error) => !error.message.includes("key-four"));
});

test("searxng: JSON mapping, digest scope, JSON-disabled and malformed responses fail", async () => {
  const json = JSON.stringify({ results: [
    { url: "https://example.com/a#x", title: "A", content: "snippet" },
    { url: "https://example.com/a", title: "dup" },
    { url: "ftp://example.com/file", title: "bad" },
  ] });
  const adapter = new SearxngSearchAdapter(async () => new Response(json, { headers: { "content-type": "application/json" } }), () => "http://127.0.0.1:8888/searx/");
  assert.equal(adapter.available(), true);
  assert.ok(!adapter.scope().includes("127.0.0.1"));
  const hits = await adapter.search("q", 5, signal());
  assert.deepEqual(hits.map((hit) => hit.url), ["https://example.com/a", "https://example.com/a"]);
  const forbidden = new SearxngSearchAdapter(async () => new Response("<html>403</html>", { status: 403, headers: { "content-type": "text/html" } }), () => "http://localhost:8888/");
  await assert.rejects(forbidden.search("q", 5, signal()), /HTTP 403.*JSON format/s);
  const notJson = new SearxngSearchAdapter(async () => new Response("<html>hi</html>", { headers: { "content-type": "text/html" } }), () => "http://localhost:8888/");
  await assert.rejects(notJson.search("q", 5, signal()), /did not return JSON/);
  const badShape = new SearxngSearchAdapter(async () => new Response('{"results":{}}'), () => "http://localhost:8888/");
  await assert.rejects(badShape.search("q", 5, signal()), /no result list/);
  const allInvalid = new SearxngSearchAdapter(async () => new Response('{"results":[{"url":"javascript:alert(1)"}]}'), () => "http://localhost:8888/");
  await assert.rejects(allInvalid.search("q", 5, signal()), /no usable HTTP/);
  const invalidUrl = new SearxngSearchAdapter(async () => new Response("{}"), () => "not a url");
  assert.equal(invalidUrl.available(), true);
  await assert.rejects(invalidUrl.search("q", 5, signal()), /not a valid URL/);
  assert.equal(new SearxngSearchAdapter(fetch, () => undefined).available(), false);
});

test("duckduckgo: HTML and lite fixtures parse, redirects decode, walls and empties differ", async () => {
  const base = "https://html.duckduckgo.com/html/?q=x";
  const html = `<html><body>
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fx%3D1&amp;rut=abc">Example &amp; Docs</a>
      <a class="result__snippet" href="https://example.com/docs?x=1">A <b>useful</b> snippet &hellip;</a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fx%3D1">Duplicate</a>
      <a class="result__snippet">dup</a>
    </div>
    <div class="result"><a class="result__a" href="javascript:alert(1)">Invalid</a></div>
    <div class="result"><a class='result-link' href='https://example.com/plain'>Plain</a></div>
  </body></html>`;
  const hits = parseDuckDuckGoHtml(html, 5, base);
  assert.deepEqual(hits.map((hit) => [hit.title, hit.url]), [
    ["Example & Docs", "https://example.com/docs?x=1"],
    ["Plain", "https://example.com/plain"],
  ]);
  assert.equal(hits[0].content, "A useful snippet …");
  assert.equal(parseDuckDuckGoHtml(html, 1, base).length, 1);
  assert.throws(() => parseDuckDuckGoHtml('<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>', 5, base), /blocked/);
  assert.throws(() => parseDuckDuckGoHtml("<html><body>nothing here</body></html>", 5, base), /no parseable/);
  assert.deepEqual(parseDuckDuckGoHtml("<html><body><div class='no-results'>No results.</div></body></html>", 5, base), []);
});

test("html: bounded Markdown conversion keeps structure and drops active content", () => {
  const html = `<!doctype html><html><head><style>body{color:red}</style><script>alert(1)</script></head>
    <body><h1>Title &amp; more</h1>
    <p>Hello <a href="/docs?x=1&amp;y=2">docs</a> and <a href="javascript:alert(1)">bad</a>.</p>
    <ul><li>One</li><li>Two</li></ul>
    <pre><code class="language-js">const a = 1 &lt; 2;
if (a) console.log("x");</code></pre>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>`;
  const markdown = htmlToMarkdown(html, "https://example.com/base/index.html");
  assert.match(markdown, /# Title & more/);
  assert.match(markdown, /\[docs\]\(https:\/\/example\.com\/docs\?x=1&y=2\)/);
  assert.ok(!markdown.includes("javascript:"));
  assert.match(markdown, /- One/);
  assert.match(markdown, /- Two/);
  assert.match(markdown, /```\nconst a = 1 < 2;/);
  assert.match(markdown, /\| A\s+\| B/);
  assert.ok(!markdown.includes("alert(1)") && !markdown.includes("color:red"));
  assert.equal(decodeEntities("&#65;&#x42;&unknown;&amp;"), "AB&unknown;&");
  assert.equal(decodeEntities("&#xD800;"), "&#xD800;");
  assert.equal(htmlToMarkdown("<p>" + "word ".repeat(5000) + "</p>", "https://example.com/", 100).length, 100);
  assert.ok(looksLikeChallenge("<html><head><title>Just a moment...</title></head><body>cf-chl</body></html>"));
  assert.ok(!looksLikeChallenge("<html><body><h1>Normal documentation</h1></body></html>"));
});

test("url: private literals, DNS answers and blocked suffixes are rejected", async () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "198.18.0.26", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:0a00:0001::", "2001:0000::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "192.0.3.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  // Transparent proxies answer public names with 198.18.0.0/15 fake IPs; that
  // is allowed for resolved answers but never for a literal address.
  assert.equal(isPrivateAddress("198.18.0.26"), true);
  await assertPublicHost(new URL("http://example.com/"), async () => [{ address: "198.18.0.26" }]);
  await assert.rejects(assertPublicHost(new URL("http://localhost/")), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://10.0.0.1/")), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://[::1]/")), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://2130706433/")), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://0x7f000001/")), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://example.com/"), async () => [{ address: "10.0.0.1" }]), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://example.com/"), async () => [{ address: "93.184.216.34" }, { address: "192.168.0.1" }]), /local or private/);
  await assert.rejects(assertPublicHost(new URL("http://example.com/"), async () => { throw new Error("ENOTFOUND"); }), /Could not resolve/);
  await assertPublicHost(new URL("http://example.com/"), async () => [{ address: "93.184.216.34" }]);
});

test("reader: converts HTML, follows checked redirects, refuses downgrades, walls and types", async () => {
  const htmlPage = async () => new Response("<html><body><h1>Hello</h1><p>Body text here with <a href='/x'>link</a>.</p></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
  const reader = new DirectFetchAdapter({ fetcher: htmlPage, lookup: PUBLIC_LOOKUP });
  const document = await reader.fetch("https://example.com/page", signal());
  assert.equal(document.url, "https://example.com/page");
  assert.match(document.content, /# Hello/);
  assert.match(document.content, /\[link\]\(https:\/\/example\.com\/x\)/);

  const hops = [];
  const redirecting = async (url) => {
    hops.push(String(url));
    if (hops.length === 1) return new Response(null, { status: 302, headers: { location: "/moved" } });
    return new Response("<html><body><p>final page</p></body></html>", { headers: { "content-type": "text/html" } });
  };
  const followed = await new DirectFetchAdapter({ fetcher: redirecting, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/a", signal());
  assert.equal(followed.url, "https://example.com/moved");
  assert.equal(hops.length, 2);

  const privateRedirect = async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: privateRedirect, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /local or private/);
  const downgrade = async () => new Response(null, { status: 302, headers: { location: "http://example.com/" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: downgrade, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /insecure/);
  const loop = async () => new Response(null, { status: 302, headers: { location: "https://example.com/" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: loop, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /loop/);
  const challenge = async () => new Response("<html><head><title>Just a moment...</title></head><body>cf-chl</body></html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: challenge, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /challenge/);
  const unsupported = async () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: unsupported, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /unsupported content type/);
  const oversized = async () => new Response("a".repeat(1024), { headers: { "content-type": "text/plain" } });
  await assert.rejects(new DirectFetchAdapter({ fetcher: oversized, lookup: PUBLIC_LOOKUP, maxBytes: 100 }).fetch("https://example.com/", signal()), /exceeds/);
  const missing = async () => new Response("nope", { status: 404 });
  await assert.rejects(new DirectFetchAdapter({ fetcher: missing, lookup: PUBLIC_LOOKUP }).fetch("https://example.com/", signal()), /HTTP 404/);
});

test("web fetch: keyless prefers direct, keyed prefers Tavily, failures are never cached", async () => {
  const calls = [];
  const direct = fetchAdapter("direct", async (url) => { calls.push("direct"); throw new Error("challenge page"); });
  const tavily = fetchAdapter("tavily", async (url) => { calls.push("tavily"); return { url, content }; });
  const keyless = new WebService({ fetch: [tavily, direct] });
  assert.equal((await keyless.read({ url: "https://example.com/" })).provider, "tavily");
  assert.deepEqual(calls, ["direct", "tavily"]);
  calls.length = 0;
  const keyed = new WebService({ fetch: [fetchAdapter("tavily", async (url) => { calls.push("tavily"); return { url, content }; }, { usesCredentials: () => true }), direct] });
  const keyedFirst = await keyed.read({ url: "https://example.com/" });
  assert.equal(keyedFirst.provider, "tavily");
  assert.deepEqual(calls, ["tavily"]);

  let attempts = 0;
  const failing = new WebService({ fetch: [fetchAdapter("direct", async () => { attempts++; throw new Error("boom"); })] });
  await assert.rejects(failing.read({ url: "https://example.com/" }), /direct: boom/);
  await assert.rejects(failing.read({ url: "https://example.com/" }), /direct: boom/);
  assert.equal(attempts, 2);
});

test("web fetch: complete Markdown round trip, pages do not refetch and snapshots detect refresh", async () => {
  let body = content;
  const calls = [];
  const adapter = fetchAdapter("direct", async (url) => { calls.push(url); return { url, content: body }; });
  const service = new WebService({ fetch: [adapter] });
  let result = await service.read({ url: "https://example.com", limit: 41 });
  const snapshot = result.document.snapshot;
  let actual = result.page.text;
  while (result.page.next_offset !== null) {
    result = await service.read({ url: "https://example.com", limit: 41, snapshot, offset: result.page.next_offset });
    actual += result.page.text;
  }
  assert.equal(actual, content);
  assert.equal(calls.length, 1);
  assert.equal(result.provider, "direct");
  await assert.rejects(service.read({ url: "https://example.com", offset: 3 }), /snapshot/);
  body = content + "\nNew version";
  await service.read({ url: "https://example.com", refresh: true });
  await assert.rejects(service.read({ url: "https://example.com", snapshot, offset: 41 }), /changed/);
  await assert.rejects(service.read({ url: "https://example.com", snapshot, refresh: true }), /Refresh/);
});

test("page cursor advances on long lines, Unicode and exact end", () => {
  const value = "a😀".repeat(100);
  let offset = 0;
  let output = "";
  while (offset !== null) {
    const page = pageDocument(value, offset, 1);
    output += page.text;
    assert.ok(page.text.length > 0);
    offset = page.next_offset;
  }
  assert.equal(output, value);
  assert.equal(pageDocument(value, value.length, 1).next_offset, null);
  assert.throws(() => pageDocument(value, value.length + 1, 1), /beyond/);
  assert.throws(() => pageDocument(value, 2, 1), /Unicode/);
});

test("extraction failures, challenge pages and invalid content are never cached", async () => {
  let calls = 0;
  let body = "# Just a moment\n" + "Please wait ".repeat(20);
  const service = new WebService({ fetch: [fetchAdapter("direct", async (url) => { calls++; return { url, content: body }; })] });
  await assert.rejects(service.read({ url: "https://example.com" }), /challenge/);
  body = content;
  await service.read({ url: "https://example.com" });
  assert.equal(calls, 2);
  assert.throws(() => validateContent("blank"), /little/);
  assert.throws(() => validateContent("### Access denied\n" + "Please wait ".repeat(20)), /challenge/);
  assert.throws(() => validateContent("<!doctype html>" + "<div>raw</div>".repeat(20)), /HTML/);
  const failed = new WebService({ fetch: [fetchAdapter("tavily", async () => { throw new Error("could not extract"); })] });
  await assert.rejects(failed.read({ url: "https://example.com" }), /could not extract/);
});

test("transport: keyless/keyed auth, status errors and bounded streamed responses", async () => {
  const requests = [];
  let apiKey;
  const client = new TavilyClient(async (_url, init) => {
    requests.push(init);
    return new Response('{"results":[]}');
  }, () => apiKey);
  const abortSignal = signal();
  await client.request("search", {}, abortSignal, client.credentials().key);
  assert.equal(requests[0].headers["X-Tavily-Access-Mode"], "keyless");
  apiKey = "test-secret";
  assert.ok(!client.credentials().scope.includes(apiKey));
  await client.request("search", {}, abortSignal, client.credentials().key);
  assert.equal(requests[1].headers.Authorization, "Bearer test-secret");
  assert.equal(requests[1].headers["X-Tavily-Access-Mode"], undefined);
  const limited = new TavilyClient(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }));
  await assert.rejects(limited.request("search", {}, abortSignal), /Retry after 60/);
  const oversized = new TavilyClient(async () => new Response("a".repeat(5 * 1024 * 1024 + 1)));
  await assert.rejects(oversized.request("extract", {}, abortSignal), /5 MiB/);
  const malformed = new TavilyClient(async () => new Response("not JSON"));
  await assert.rejects(malformed.request("search", {}, abortSignal), /invalid JSON/);
  assert.throws(() => publicUrl("file:///secret"), /HTTP/);
  assert.throws(() => publicUrl("https://user:secret@example.com/"), /credentials/);
});

test("registered tools keep stable descriptions and exact continuation parameters", async () => {
  const tools = new Map();
  const service = new WebService({
    search: [searchAdapter("duckduckgo", async () => [{ url: "https://example.com/a", title: "First", content: "Top result" }])],
    fetch: [fetchAdapter("direct", async (url) => ({ url, content }))],
  });
  registerWebTools({ registerTool: (tool) => tools.set(tool.name, tool) }, service);
  const search = tools.get("web_search");
  const fetchTool = tools.get("web_fetch");
  assert.equal(search.executionMode, "parallel");
  assert.equal(fetchTool.executionMode, "parallel");
  const snapshotOf = (map) => JSON.stringify([map.get("web_search"), map.get("web_fetch")].map((tool) => [tool.description, tool.promptSnippet, Object.keys(tool.parameters.properties)]));
  const stable = snapshotOf(tools);
  process.env.TAVILY_API_KEY = "descriptions-must-not-depend-on-env";
  const other = new Map();
  registerWebTools({ registerTool: (tool) => other.set(tool.name, tool) }, new WebService({}));
  delete process.env.TAVILY_API_KEY;
  assert.equal(snapshotOf(other), stable);
  const searched = await search.execute("one", { query: "example" });
  assert.match(searched.content[0].text, /\[1\] First\nhttps:\/\/example.com\/a/);
  assert.equal(searched.details.provider, "duckduckgo");
  const first = await fetchTool.execute("two", { url: "https://example.com", limit: 30 });
  assert.match(first.content[0].text, /offset=30/);
  assert.equal(first.details.provider, "direct");
  assert.equal(first.details.next_offset, 30);
  const end = await fetchTool.execute("three", { url: "https://example.com", snapshot: first.details.snapshot, offset: 30 });
  assert.equal(end.details.next_offset, null);
  assert.match(end.content[0].text, /End of extracted content/);
});
