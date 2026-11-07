import type { PlanQuota, QuotaWindow } from "../shared/quota.ts";

/**
 * Plan quota for the subscription providers pi signs in to.
 *
 * - Claude (pi provider `anthropic`, OAuth): `GET api.anthropic.com/api/oauth/usage`,
 *   the endpoint behind Claude Code's `/usage` — `five_hour`, `seven_day`,
 *   `seven_day_opus`, `seven_day_sonnet`, each `{ utilization, resets_at }`.
 * - ChatGPT (pi provider `openai-codex`, OAuth): `GET chatgpt.com/backend-api/wham/usage`,
 *   as baocode asks it (`codex_api.dart`): `rate_limit.primary_window` /
 *   `secondary_window` with `used_percent`, `limit_window_seconds`, `reset_at`
 *   or `reset_after_seconds`; `plan_type`; `credits`.
 *
 * Answers are cached for five minutes (baocode's `usageMaxAge`); a forced
 * refresh skips the cache. Only one request per provider is in flight.
 */

export const QUOTA_PROVIDERS = ["anthropic", "openai-codex"] as const;
const MAX_AGE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 12_000;

/** Codex's client identity, as baocode sends it (codex_api.dart). */
const CODEX_VERSION = "0.159.0";
const CODEX_HEADERS = {
  originator: "codex-tui",
  "user-agent": `codex-tui/${CODEX_VERSION} (codex-tui; ${CODEX_VERSION})`,
};

type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const cache = new Map<string, PlanQuota>();
const inflight = new Map<string, Promise<PlanQuota>>();

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** epoch seconds, epoch ms or an ISO string → epoch ms */
function toMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const n = num(value);
  if (n === undefined) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

export function parseClaudeUsage(json: unknown, now: number): Omit<PlanQuota, "fetchedAt"> {
  const root = record(json) ?? {};
  const windows: QuotaWindow[] = [];
  for (const id of ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"]) {
    const window = record(root[id]);
    const used = num(window?.utilization);
    if (!window || used === undefined) continue;
    windows.push({ id, usedPercent: used, resetsAt: toMs(window.resets_at) });
  }
  const limited = windows.some((window) => window.usedPercent >= 100 && (window.resetsAt ?? Infinity) > now);
  return { provider: "anthropic", label: "Claude", windows, limited };
}

export function parseCodexUsage(json: unknown, now: number): Omit<PlanQuota, "fetchedAt"> {
  const root = record(json) ?? {};
  const limits = record(root.rate_limit);
  const windows: QuotaWindow[] = [];
  for (const [id, key] of [
    ["primary", "primary_window"],
    ["secondary", "secondary_window"],
  ] as const) {
    const window = record(limits?.[key]);
    const used = num(window?.used_percent);
    if (!window || used === undefined) continue;
    const seconds = num(window.limit_window_seconds);
    const after = num(window.reset_after_seconds);
    windows.push({
      id,
      usedPercent: used,
      minutes: seconds && seconds > 0 ? Math.round(seconds / 60) : undefined,
      resetsAt: toMs(window.reset_at) ?? (after !== undefined ? now + after * 1000 : undefined),
    });
  }
  const credits = record(root.credits);
  return {
    provider: "openai-codex",
    label: "ChatGPT",
    plan: typeof root.plan_type === "string" && root.plan_type ? root.plan_type : undefined,
    windows,
    limited: limits?.limit_reached === true || limits?.allowed === false,
    credits:
      credits?.unlimited === true
        ? "unlimited"
        : credits?.has_credits === true && credits.balance !== undefined
          ? String(credits.balance)
          : undefined,
  };
}

/** The ChatGPT workspace id inside a Codex access token (its JWT claims). */
export function codexAccountId(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = record(claims["https://api.openai.com/auth"]);
    const id = auth?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

async function request(provider: string, token: string, fetcher: Fetcher): Promise<Omit<PlanQuota, "fetchedAt">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const now = Date.now();
    if (provider === "anthropic") {
      const response = await fetcher("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseClaudeUsage(await response.json(), now);
    }
    const accountId = codexAccountId(token);
    const response = await fetcher("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        authorization: `Bearer ${token}`,
        ...(accountId ? { "chatgpt-account-id": accountId } : {}),
        ...CODEX_HEADERS,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseCodexUsage(await response.json(), now);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One provider's quota: from the cache while it is fresh (and no window has
 * reset since), else asked again. A failure keeps the previous windows and
 * carries the error, so the UI can say "last updated …" instead of going blank.
 */
export async function providerQuota(
  provider: string,
  token: string,
  options: { force?: boolean; fetcher?: Fetcher } = {},
): Promise<PlanQuota> {
  const now = Date.now();
  const cached = cache.get(provider);
  const stale =
    !cached ||
    now - cached.fetchedAt > MAX_AGE_MS ||
    cached.windows.some((window) => window.resetsAt !== undefined && window.resetsAt <= now);
  if (cached && !stale && !options.force) return cached;

  const running = inflight.get(provider);
  if (running) return running;

  const fetcher = options.fetcher ?? (globalThis.fetch as unknown as Fetcher);
  const job = request(provider, token, fetcher)
    .then((answer) => {
      const quota: PlanQuota = { ...answer, fetchedAt: Date.now() };
      cache.set(provider, quota);
      return quota;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const previous = cache.get(provider);
      return previous
        ? { ...previous, error: message }
        : {
            provider,
            label: provider === "anthropic" ? "Claude" : "ChatGPT",
            windows: [],
            limited: false,
            fetchedAt: Date.now(),
            error: message,
          };
    })
    .finally(() => inflight.delete(provider));
  inflight.set(provider, job);
  return job;
}
