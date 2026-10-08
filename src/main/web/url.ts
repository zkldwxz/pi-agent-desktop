import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export type HostLookup = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

const defaultLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

export function publicUrl(raw: string): string {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP(S) URL without embedded credentials.");
  }
  // Fragments do not change the HTTP resource. Paths, queries and schemes do.
  url.hash = "";
  return url.href;
}

/**
 * Reject loopback, link-local, private, CGNAT, multicast and documentation
 * ranges before any request leaves the machine. Keyless fetch follows
 * model-supplied URLs, so without this an agent could reach the host itself,
 * a router, or cloud metadata endpoints.
 */
export function isPrivateAddress(address: string): boolean {
  return classifyAddress(address, false);
}

/**
 * DNS answers may legitimately land in 198.18.0.0/15: transparent proxy tools
 * (Clash and friends) map public hostnames into that benchmark range and
 * resolve the real name themselves. The range stays blocked for IP literals.
 */
function isPrivateAddressAnswer(address: string): boolean {
  return classifyAddress(address, true);
}

function classifyAddress(address: string, allowBenchmarkRange: boolean): boolean {
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  // URL canonicalizes ::ffff:10.0.0.1 to ::ffff:a00:1 on some platforms, so the
  // mapped-IPv4 check below also has to inspect hextets, not just dig dots.
  if (value.startsWith("::ffff:") && value.includes(".")) value = value.slice(7);
  const family = isIP(value);
  if (family === 4) return isPrivateV4(value.split(".").map(Number), allowBenchmarkRange);
  if (family !== 6) return false;
  const parts = expandIpv6(value);
  // An unparsable IPv6 literal is treated as private so the caller fails closed.
  if (!parts) return true;
  if (parts.every((part) => part === 0)) return true; // ::
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true; // ::1
  if ((parts[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((parts[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((parts[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true; // 2001:db8::/32 docs
  if (parts[0] === 0x2001 && parts[1] === 0x0000) return true; // 2001::/32 Teredo
  const mappedV4 = (high: number, low: number): boolean =>
    isPrivateV4([high >> 8, high & 0xff, low >> 8, low & 0xff], allowBenchmarkRange);
  if (parts[0] === 0x0064 && parts[1] === 0xff9b) return mappedV4(parts[6], parts[7]); // 64:ff9b::/96 NAT64
  if (parts[0] === 0x2002) return mappedV4(parts[1], parts[2]); // 2002::/16 6to4
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return mappedV4(parts[6], parts[7]); // ::ffff:0:0/96 mapped IPv4
  }
  return false;
}

function isPrivateV4(parts: number[], allowBenchmarkRange: boolean): boolean {
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (!allowBenchmarkRange && a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function expandIpv6(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (text: string): number[] | null => {
    if (!text) return [];
    const groups = text.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** Hostname suffixes that must never resolve through search domains to a LAN host. */
function isBlockedHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "metadata.google.internal"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa");
}

/**
 * Resolve the host and reject the request unless every answer is a public
 * address. DNS can be replayed between this check and the connect, so a
 * malicious resolver can still rebind; redirects are re-checked per hop and
 * the remaining gap is documented in docs/research/2026-10-02-keyless-web-search.md.
 */
export async function assertPublicHost(url: URL, customLookup: HostLookup = defaultLookup): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new Error("The URL must include a hostname.");
  if (isBlockedHostname(hostname)) throw new Error(`Refusing to fetch local or private address "${hostname}".`);
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Refusing to fetch a local or private address.");
    return;
  }
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await customLookup(hostname);
  } catch {
    throw new Error(`Could not resolve "${hostname}".`);
  }
  if (!addresses.length) throw new Error(`Could not resolve "${hostname}".`);
  if (addresses.some(({ address }) => isPrivateAddressAnswer(address))) {
    throw new Error("Refusing to fetch a local or private address.");
  }
}
