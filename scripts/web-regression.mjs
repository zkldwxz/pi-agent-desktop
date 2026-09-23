import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { RequestCache } = await jiti.import("../src/main/web/cache.ts");
const { WebService, pageDocument, validateContent } = await jiti.import("../src/main/web/service.ts");
const { TavilyClient, publicUrl } = await jiti.import("../src/main/web/tavily.ts");
const { registerWebTools } = await jiti.import("../src/main/web/extension.ts");
const cache = (now = Date.now) => new RequestCache(100, 2, 8, (value) => value.length, now);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const content = "# Document\n\n" + "A complete paragraph with [links](https://example.com).\n".repeat(20) + "\n```js\nconst x = 1;\n```";

function fakeClient() {
  const calls = [];
  let body = content;
  let scope = "anonymous";
  const client = {
    credentials: () => ({ scope }),
    request: async (endpoint, input) => {
      calls.push({ endpoint, input });
      if (endpoint === "extract") return { results: [{ url: input.urls[0], raw_content: body }] };
      return { results: [
        { url: "https://example.com/a#one", title: "First", content: "Top result" },
        { url: "https://example.com/a#two", title: "Duplicate" },
        { url: "https://example.com/a/", title: "Different path" },
        { url: "https://example.com/a?lang=zh", title: "Different query" },
        { url: "javascript:alert(1)", title: "Invalid" },
      ] };
    },
  };
  return { client, calls, setBody: (value) => { body = value; }, setScope: (value) => { scope = value; } };
}

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
  const load = async (signal) => { transport = signal; return gate.promise; };
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
  const cancelled = c.get("b", async (signal) => { transport = signal; return gate2.promise; }, { signal: d.signal });
  await Promise.resolve();
  d.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(transport.aborted, true);
  const retry = c.get("b", async () => "fresh");
  gate2.resolve("stale");
  assert.equal((await retry).value, "fresh");
  assert.equal(c.peek("b"), "fresh");
});

test("search: preserve ranking, conservative URL dedupe, credential isolation", async () => {
  const fake = fakeClient();
  const service = new WebService(fake.client);
  const first = await service.search({ query: "  example  " });
  assert.deepEqual(first.value.map((r) => r.title), ["First", "Different path", "Different query"]);
  assert.equal((await service.search({ query: "example" })).cache, "hit");
  assert.equal(fake.calls.length, 1);
  fake.setScope("account");
  await service.search({ query: "example" });
  assert.equal(fake.calls.length, 2);
  await assert.rejects(service.search({ query: " " }), /Query/);
  await assert.rejects(service.search({ query: "x", max_results: 100 }), /max_results/);
});

test("web fetch: complete Markdown round trip, pages do not refetch and snapshots detect refresh", async () => {
  const fake = fakeClient();
  const service = new WebService(fake.client);
  let result = await service.read({ url: "https://example.com", limit: 41 });
  const snapshot = result.document.snapshot;
  let actual = result.page.text;
  while (result.page.next_offset !== null) {
    result = await service.read({ url: "https://example.com", limit: 41, snapshot, offset: result.page.next_offset });
    actual += result.page.text;
  }
  assert.equal(actual, content);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].input.format, "markdown");
  await assert.rejects(service.read({ url: "https://example.com", offset: 3 }), /snapshot/);
  fake.setBody(content + "\nNew version");
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
  const fake = fakeClient();
  const service = new WebService(fake.client);
  fake.setBody("# Just a moment\n" + "Please wait ".repeat(20));
  await assert.rejects(service.read({ url: "https://example.com" }), /challenge/);
  fake.setBody(content);
  await service.read({ url: "https://example.com" });
  assert.equal(fake.calls.length, 2);
  assert.throws(() => validateContent("blank"), /little/);
  assert.throws(() => validateContent("### Access denied\n" + "Please wait ".repeat(20)), /challenge/);
  assert.throws(() => validateContent("<!doctype html>" + "<div>raw</div>".repeat(20)), /HTML/);
  const failed = new WebService({ credentials: () => ({ scope: "x" }), request: async () => ({ results: [], failed_results: [{ error: "403" }] }) });
  await assert.rejects(failed.read({ url: "https://example.com" }), /could not extract/);
});

test("transport: keyless/keyed auth, status errors and bounded streamed responses", async () => {
  const requests = [];
  let apiKey;
  const client = new TavilyClient(async (_url, init) => {
    requests.push(init);
    return new Response('{"results":[]}');
  }, () => apiKey);
  const signal = new AbortController().signal;
  await client.request("search", {}, signal, client.credentials().key);
  assert.equal(requests[0].headers["X-Tavily-Access-Mode"], "keyless");
  apiKey = "test-secret";
  assert.ok(!client.credentials().scope.includes(apiKey));
  await client.request("search", {}, signal, client.credentials().key);
  assert.equal(requests[1].headers.Authorization, "Bearer test-secret");
  assert.equal(requests[1].headers["X-Tavily-Access-Mode"], undefined);
  const limited = new TavilyClient(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }));
  await assert.rejects(limited.request("search", {}, signal), /Retry after 60/);
  const oversized = new TavilyClient(async () => new Response("a".repeat(5 * 1024 * 1024 + 1)));
  await assert.rejects(oversized.request("extract", {}, signal), /5 MiB/);
  const malformed = new TavilyClient(async () => new Response("not JSON"));
  await assert.rejects(malformed.request("search", {}, signal), /invalid JSON/);
  assert.throws(() => publicUrl("file:///secret"), /HTTP/);
  assert.throws(() => publicUrl("https://user:secret@example.com/"), /credentials/);
});

test("registered tools return usable source references and exact continuation parameters", async () => {
  const tools = new Map();
  registerWebTools({ registerTool: (tool) => tools.set(tool.name, tool) }, new WebService(fakeClient().client));
  assert.equal(tools.get("web_search").executionMode, "parallel");
  assert.equal(tools.get("web_fetch").executionMode, "parallel");
  const searched = await tools.get("web_search").execute("one", { query: "example" });
  assert.match(searched.content[0].text, /\[1\] First\nhttps:\/\/example.com\/a/);
  const first = await tools.get("web_fetch").execute("two", { url: "https://example.com", limit: 30 });
  assert.match(first.content[0].text, /offset=30/);
  assert.equal(first.details.next_offset, 30);
  const end = await tools.get("web_fetch").execute("three", { url: "https://example.com", snapshot: first.details.snapshot, offset: 30 });
  assert.equal(end.details.next_offset, null);
  assert.match(end.content[0].text, /End of extracted content/);
});
