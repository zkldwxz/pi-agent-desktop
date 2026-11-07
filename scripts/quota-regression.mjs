/**
 * Regression cover for subscription plan quota (src/main/quota.ts).
 *
 * Run: node --test scripts/quota-regression.mjs
 *
 * The two answers are parsed the way baocode reads them — Claude's
 * `five_hour` / `seven_day` windows and Codex's `/wham/usage` — and the cache
 * must hold for five minutes, refetch on force or once a window has reset, and
 * keep the last good windows when a refresh fails.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { parseClaudeUsage, parseCodexUsage, codexAccountId, providerQuota } = await import("../src/main/quota.ts");

test("Claude usage: utilization and ISO reset times per window", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");
  const quota = parseClaudeUsage(
    {
      five_hour: { utilization: 42, resets_at: "2026-11-07T12:30:00Z" },
      seven_day: { utilization: 100, resets_at: "2026-11-09T00:00:00Z" },
      seven_day_opus: null,
      extra_usage: { is_enabled: false },
    },
    now,
  );
  assert.deepEqual(
    quota.windows.map((w) => [w.id, w.usedPercent, w.resetsAt]),
    [
      ["five_hour", 42, Date.parse("2026-11-07T12:30:00Z")],
      ["seven_day", 100, Date.parse("2026-11-09T00:00:00Z")],
    ],
  );
  assert.equal(quota.limited, true, "a full window that has not reset yet limits the plan");
});

test("Codex usage: windows, minutes, reset_at in seconds or reset_after_seconds", () => {
  const now = 1_700_000_000_000;
  const quota = parseCodexUsage(
    {
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 91, limit_window_seconds: 18000, reset_at: 1_700_003_600 },
        secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_after_seconds: 86400 },
      },
      credits: { has_credits: true, unlimited: false, balance: "4.50" },
    },
    now,
  );
  assert.equal(quota.plan, "plus");
  assert.equal(quota.limited, false);
  assert.equal(quota.credits, "4.50");
  assert.deepEqual(quota.windows[0], { id: "primary", usedPercent: 91, minutes: 300, resetsAt: 1_700_003_600_000 });
  assert.deepEqual(quota.windows[1], { id: "secondary", usedPercent: 12, minutes: 10080, resetsAt: now + 86_400_000 });
  assert.equal(parseCodexUsage({ rate_limit: { allowed: false } }, now).limited, true);
});

test("Codex account id comes out of the access token's claims", () => {
  const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } };
  const token = `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
  assert.equal(codexAccountId(token), "acct-123");
  assert.equal(codexAccountId("not-a-jwt"), undefined);
});

test("cache: fresh answers are reused, force refetches, a failure keeps the last windows", async () => {
  let calls = 0;
  let fail = false;
  const fetcher = async (url, init) => {
    calls += 1;
    assert.match(url, /api\.anthropic\.com\/api\/oauth\/usage/);
    assert.equal(init.headers.authorization, "Bearer tok");
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ five_hour: { utilization: 10, resets_at: new Date(Date.now() + 3600e3).toISOString() } }),
    };
  };
  const first = await providerQuota("anthropic", "tok", { fetcher });
  assert.equal(first.windows[0].usedPercent, 10);
  await providerQuota("anthropic", "tok", { fetcher });
  assert.equal(calls, 1, "a fresh answer is served from the cache");
  await providerQuota("anthropic", "tok", { fetcher, force: true });
  assert.equal(calls, 2, "force skips the cache");
  fail = true;
  const failed = await providerQuota("anthropic", "tok", { fetcher, force: true });
  assert.equal(failed.error, "HTTP 503");
  assert.equal(failed.windows[0].usedPercent, 10, "the last good windows survive a failed refresh");
});
