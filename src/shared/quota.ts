/**
 * Subscription plan quota — how much of a Claude Pro/Max or ChatGPT (Codex)
 * plan's rolling windows is used, and when each starts over.
 *
 * Ported from baocode: its Codex quota (`lib/models/codex/codex_usage.dart`)
 * and its Claude plan limits (`five_hour` / `seven_day` from the CLI's
 * `get_usage`). We run pi rather than the Claude CLI, so the Claude side asks
 * Anthropic's OAuth usage endpoint directly; the fields are the same.
 */

export interface QuotaWindow {
  /** stable id: "five_hour", "seven_day", "seven_day_opus", "primary", … */
  id: string;
  /** 0–100 */
  usedPercent: number;
  /** epoch ms; absent when the provider did not say */
  resetsAt?: number;
  /** the window's length, when known (Codex reports it) */
  minutes?: number;
}

export interface PlanQuota {
  /** pi's provider id: "anthropic", "openai-codex" */
  provider: string;
  /** "Claude", "ChatGPT" */
  label: string;
  /** the plan name the provider reports ("plus", "pro", …) */
  plan?: string;
  windows: QuotaWindow[];
  /** the provider says no request can go through right now */
  limited: boolean;
  /** extra credits balance (Codex), or "unlimited" */
  credits?: string;
  /** epoch ms of the answer this came from */
  fetchedAt: number;
  /** set when the last attempt failed; windows then hold the previous answer */
  error?: string;
}

/** The most used window — what a one-line summary reports. */
export function tightestWindow(quota: PlanQuota): QuotaWindow | undefined {
  return quota.windows.reduce<QuotaWindow | undefined>(
    (worst, window) => (!worst || window.usedPercent > worst.usedPercent ? window : worst),
    undefined,
  );
}

/** A window that has reset since it was read is at 0, not at its old value. */
export function effectiveUsed(window: QuotaWindow, now = Date.now()): number {
  if (window.resetsAt !== undefined && window.resetsAt <= now) return 0;
  return Math.max(0, Math.min(100, window.usedPercent));
}
