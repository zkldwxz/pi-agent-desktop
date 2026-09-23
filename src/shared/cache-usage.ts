/**
 * Cache accounting, in one place.
 *
 * A prompt is made of tokens billed fresh, tokens read from the provider's
 * cache, and tokens written *to* that cache — `input + cacheRead + cacheWrite`.
 * Cache writes are part of the prompt, so they belong in the denominator of the
 * hit rate: a run that wrote a lot and read nothing is not a 100% hit, and a
 * run that reads a warm prefix is not diluted by what it paid once to warm it.
 *
 * It used to be computed as `cacheRead / (input + cacheRead)` in four different
 * files — the usage scanner, the usage page, the composer's ring and the turn
 * footer — and the writing half of the prompt was invisible in all of them. The
 * helpers below are the single definition; every consumer imports them, so the
 * number in the footer and the number on the usage page are the same number.
 *
 * Fields are optional because the callers hold partial usage: a serialized
 * message carries what the provider reported, a bucket carries what the scanner
 * summed, and both should read the missing part as zero rather than skip the
 * rate.
 */

export interface CacheUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Every token the provider had to read: fresh input, cache reads, cache writes. */
export function promptTokens(usage: CacheUsage): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/** The part of the prompt that was billed at full price. */
export function freshPromptTokens(usage: CacheUsage): number {
  return (usage.input ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * The cache hit rate: cache reads over the whole prompt.
 *
 * Zero when there was no prompt at all — a rate needs a denominator, and
 * inventing one hides the difference between "no data" and "nothing cached".
 */
export function cacheHitRate(usage: CacheUsage): number {
  const prompt = promptTokens(usage);
  return prompt > 0 ? (usage.cacheRead ?? 0) / prompt : 0;
}
