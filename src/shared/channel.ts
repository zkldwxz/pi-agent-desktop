/**
 * Channel identity.
 *
 * pi holds exactly one credential per provider id, so a channel the user thinks
 * of as "this endpoint, with these keys" is stored as several provider entries
 * that share a protocol and a host. The endpoint is what makes them one channel.
 *
 * This lives in `shared` rather than beside the writer because three layers
 * resolve the same question — `model-config` writes entries keyed by it,
 * `pi-host` folds providers into channels for the interface, and the browser
 * preview mocks the pairing — and two owners of this formula would let the file
 * and the screen disagree about what counts as one channel.
 */

/** The endpoint a protocol and host name, or `""` when either is missing. */
export function endpointId(api?: string, baseUrl?: string): string {
  return api && baseUrl ? `${api}|${baseUrl}` : "";
}

/**
 * The channel a provider belongs to.
 *
 * A provider that declares no protocol or no host is a channel of its own —
 * that is what keeps pi's shipped providers, which share default hosts, from
 * collapsing into each other.
 */
export function channelIdOf(provider: { api?: string; baseUrl?: string }, providerId: string): string {
  return endpointId(provider.api, provider.baseUrl) || providerId;
}
