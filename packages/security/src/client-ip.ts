import * as ipaddr from 'ipaddr.js'

type ParsedIp = ipaddr.IPv4 | ipaddr.IPv6
type ParsedCidr = readonly [ParsedIp, number]

/** Anything with a case-insensitive header getter — `Request`, `NextRequest`, `Headers`. */
export interface ClientIpHeaderSource {
  headers: { get(name: string): string | null }
}

/**
 * A prepared trusted-proxy list. Build it once at module scope with
 * {@link parseTrustedProxies} and reuse it — parsing on every request would
 * re-tokenize the CIDRs for no benefit.
 */
export interface TrustedProxyList {
  readonly cidrs: readonly ParsedCidr[]
}

/** The default list: no proxy hop is trusted to have vouched for the hop left of it. */
const NO_TRUSTED_PROXIES: TrustedProxyList = { cidrs: [] }

/** Returned when no header yields a parseable address. Callers share one bucket for it. */
export const UNKNOWN_CLIENT_IP = 'unknown'

/**
 * Strips a port and IPv6 brackets from a forwarded-hop token, leaving a bare
 * address. Handles `[::1]:8080`, `[::1]`, and `1.2.3.4:5678`; a bare IPv6
 * literal (two or more colons, no brackets) is returned untouched.
 */
function stripPortAndBrackets(value: string): string {
  let host = value
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    host = end === -1 ? host.slice(1) : host.slice(1, end)
  } else {
    const firstColon = host.indexOf(':')
    if (firstColon !== -1 && host.indexOf(':', firstColon + 1) === -1) {
      host = host.slice(0, firstColon)
    }
  }
  // Drop any IPv6 zone id (`fe80::1%eth0`). `ipaddr.isValid` accepts an
  // arbitrary-length zone and `process()` preserves it verbatim, so keeping it
  // would hand a caller an unbounded supply of distinct-but-equivalent strings
  // to use as rate-limit keys — and let them write arbitrary text into keys and
  // audit rows. The zone is a local interface selector, never client identity.
  const zone = host.indexOf('%')
  return zone === -1 ? host : host.slice(0, zone)
}

/**
 * Parses one forwarded-hop token into a canonical address, or `null` when it is
 * not an IP at all (`unknown`, `_hidden`, an injected junk value). `process()`
 * collapses equivalent spellings — IPv4-mapped IPv6, octal and hex IPv4 — onto
 * one representation, so a caller cannot multiply rate-limit buckets by varying
 * the encoding of a single address.
 */
function parseHop(raw: string): ParsedIp | null {
  const value = stripPortAndBrackets(raw.trim())
  if (!value || !ipaddr.isValid(value)) return null
  try {
    return ipaddr.process(value)
  } catch {
    return null
  }
}

/**
 * Rewrites an IPv4-mapped IPv6 range (`::ffff:10.0.0.0/104`) to its IPv4 form so
 * it can match hops, which {@link parseHop} always unwraps to IPv4. Without this
 * the kinds never agree and the entry is silently inert.
 */
function normalizeCidr(cidr: ParsedCidr): ParsedCidr {
  const [addr, bits] = cidr
  if (addr.kind() !== 'ipv6') return cidr
  const v6 = addr as ipaddr.IPv6
  if (!v6.isIPv4MappedAddress() || bits < 96) return cidr
  return [v6.toIPv4Address(), bits - 96]
}

function isTrustedProxy(addr: ParsedIp, trustedProxies: TrustedProxyList): boolean {
  for (const [range, bits] of trustedProxies.cidrs) {
    if (addr.kind() !== range.kind()) continue
    if (addr.kind() === 'ipv4') {
      if ((addr as ipaddr.IPv4).match(range as ipaddr.IPv4, bits)) return true
    } else if ((addr as ipaddr.IPv6).match(range as ipaddr.IPv6, bits)) return true
  }
  return false
}

/**
 * Parses a comma-separated trusted-proxy setting (`AUTH_TRUSTED_PROXIES`) into
 * matchable ranges. Entries may be CIDRs (`10.0.0.0/24`) or bare addresses,
 * which become single-host ranges.
 *
 * Unparseable entries are dropped rather than thrown on: a typo must not take
 * the app down, and dropping an entry can only make IP resolution stricter
 * (one fewer hop is skipped), never more permissive.
 */
export function parseTrustedProxies(raw: string | null | undefined): TrustedProxyList {
  const cidrs: ParsedCidr[] = []
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim()
    if (!value) continue
    try {
      if (value.includes('/')) {
        cidrs.push(normalizeCidr(ipaddr.parseCIDR(value)))
        continue
      }
      const addr = parseHop(value)
      if (addr) cidrs.push([addr, addr.kind() === 'ipv4' ? 32 : 128])
    } catch {
      // Malformed entry — skip it.
    }
  }
  return { cidrs }
}

/**
 * Resolves the client IP behind a reverse proxy, safely enough to key a rate
 * limit on.
 *
 * `X-Forwarded-For` is a chain that every hop *appends* to, so the **leftmost**
 * entry is whatever the original caller sent — fully attacker-controlled — while
 * the **rightmost** was written by the proxy directly in front of the app. This
 * walks the chain right to left, skips hops that match {@link TrustedProxyList},
 * and returns the first address that is not a trusted proxy. That is the closest
 * hop the infrastructure actually vouched for.
 *
 * With no trusted proxies configured the rightmost entry wins. Behind a longer
 * chain (e.g. a CDN in front of an ingress) that collapses callers onto the edge
 * addresses and throttles them together — coarse, but it fails closed. Listing
 * the real hops in `AUTH_TRUSTED_PROXIES` restores per-client keying.
 *
 * When *every* entry is trusted the walk falls back to the **rightmost** hop,
 * never the leftmost. This matters: operators are told to configure ranges like
 * `10.0.0.0/16`, and a caller who forges `X-Forwarded-For: 10.0.<rand>.<rand>`
 * from inside that range would otherwise make the whole chain "trusted" and get
 * their own forged value back — reinstating the very bucket-per-request bypass
 * this function exists to close. The rightmost hop is the one the adjacent proxy
 * wrote, so it is the only entry a caller can never author.
 *
 * `X-Real-IP` is the fallback when `X-Forwarded-For` carries no parseable
 * address, and {@link UNKNOWN_CLIENT_IP} when neither header does.
 *
 * @param request Any object exposing a header getter.
 * @param trustedProxies Prepared list from {@link parseTrustedProxies}.
 */
export function resolveClientIp(
  request: ClientIpHeaderSource,
  trustedProxies: TrustedProxyList = NO_TRUSTED_PROXIES
): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    let rightmostParsed: string | null = null
    for (let i = hops.length - 1; i >= 0; i--) {
      const addr = parseHop(hops[i])
      if (!addr) continue
      const canonical = addr.toString()
      if (!isTrustedProxy(addr, trustedProxies)) return canonical
      rightmostParsed ??= canonical
    }
    if (rightmostParsed) return rightmostParsed
  }

  const realIp = parseHop(request.headers.get('x-real-ip') ?? '')
  return realIp ? realIp.toString() : UNKNOWN_CLIENT_IP
}

/**
 * The **leftmost** `X-Forwarded-For` hop — the origin address *asserted* by the
 * caller — in canonical form, or `null` when none parses.
 *
 * Deliberately the opposite end of the chain from {@link resolveClientIp}, and
 * usable for exactly one thing: comparing against an operator-configured
 * allowlist of expected senders, where the question is "which address does this
 * delivery claim to come from" rather than "who do I throttle".
 *
 * **Never key a rate limit, quota, or lockout on this.** Under any proxy that
 * appends to `X-Forwarded-For` the value is caller-controlled and can be rotated
 * per request. An allowlist built on it is a filter against honest senders, not
 * an authentication mechanism — pair it with a shared secret or signature.
 */
export function getAssertedOriginIp(request: ClientIpHeaderSource): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return null
  for (const hop of forwarded.split(',')) {
    const addr = parseHop(hop)
    if (addr) return addr.toString()
  }
  return null
}

/**
 * Canonicalizes an operator-supplied address so it can be compared against
 * {@link getAssertedOriginIp}. Returns `null` when the entry is not an IP.
 *
 * Needed because both sides must agree on spelling: `::ffff:1.2.3.4`,
 * `01.02.03.04`, and `1.2.3.4` are one address, and a config entry typed in a
 * non-canonical form would otherwise never match.
 */
export function canonicalizeIp(value: string): string | null {
  const addr = parseHop(value)
  return addr ? addr.toString() : null
}
