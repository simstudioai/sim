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
 * Prefix an IPv6 address is masked to before it becomes a rate-limit key.
 *
 * A single IPv6 client is routinely delegated a whole /64 — that is the standard
 * residential and cloud allocation — so every request can legitimately carry a
 * different source address with no spoofing whatsoever. Keying on the full /128
 * would therefore leave per-IP throttles just as bypassable over IPv6 as the
 * forwarded-header bug this module exists to close, except the proxy itself
 * writes the varying value and nothing looks wrong.
 *
 * Masking to the routed prefix makes one subscriber one bucket. Matches Better
 * Auth's `ipv6Subnet` default, so session and throttle keys agree.
 */
const IPV6_KEY_PREFIX_BITS = 64

/**
 * Reduces a forwarded-hop token to a bare address, dropping brackets, a port,
 * and any IPv6 zone id — `[::1]:8080`, `[::1]`, `1.2.3.4:5678`, `fe80::1%eth0`.
 * A bare IPv6 literal (two or more colons, no brackets) keeps its colons; the
 * single-colon rule only strips a port from `host:port`.
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

/**
 * Renders an address as a rate-limit key, masking IPv6 to
 * {@link IPV6_KEY_PREFIX_BITS} so one delegated prefix is one bucket. IPv4 is
 * returned exactly — a v4 address is a single host.
 *
 * Applied only at the point a key is produced, never before
 * {@link isTrustedProxy}: a masked address would compare against trusted ranges
 * as a different (and wrong) address.
 */
function toKey(addr: ParsedIp): string {
  if (addr.kind() !== 'ipv6') return addr.toString()
  const bytes = (addr as ipaddr.IPv6).toByteArray()
  for (let i = IPV6_KEY_PREFIX_BITS / 8; i < bytes.length; i++) bytes[i] = 0
  return ipaddr.fromByteArray(bytes).toString()
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
 * The result is a **bucket key, not an address**: IPv6 is masked to
 * {@link IPV6_KEY_PREFIX_BITS} (see there for why a /128 key is bypassable).
 * Use {@link getAssertedOriginIp} when an exact address is required.
 *
 * None of this helps if no proxy sets the header at all — a directly-exposed
 * app sees only what the caller wrote, and no parsing rule can recover from
 * that. Terminate at a proxy that appends the peer address.
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
      if (!isTrustedProxy(addr, trustedProxies)) return toKey(addr)
      rightmostParsed ??= toKey(addr)
    }
    if (rightmostParsed) return rightmostParsed
  }

  const realIp = parseHop(request.headers.get('x-real-ip') ?? '')
  return realIp ? toKey(realIp) : UNKNOWN_CLIENT_IP
}

/**
 * The **leftmost** `X-Forwarded-For` hop — the origin address *asserted* by the
 * caller — in canonical form, falling back to `X-Real-IP`, or `null` when
 * neither header yields an address.
 *
 * Deliberately the opposite end of the chain from {@link resolveClientIp}, and
 * usable for exactly one thing: comparing against an operator-configured
 * allowlist of expected senders, where the question is "which address does this
 * delivery claim to come from" rather than "who do I throttle". The `X-Real-IP`
 * fallback matters because a proxy may set it *instead of* a forwarded chain,
 * and it is then the only record of the sender.
 *
 * **Never key a rate limit, quota, or lockout on this.** Under any proxy that
 * appends to `X-Forwarded-For` the value is caller-controlled and can be rotated
 * per request. An allowlist built on it is a filter against honest senders, not
 * an authentication mechanism — pair it with a shared secret or signature.
 */
export function getAssertedOriginIp(request: ClientIpHeaderSource): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  for (const hop of forwarded?.split(',') ?? []) {
    const addr = parseHop(hop)
    if (addr) return addr.toString()
  }
  const realIp = parseHop(request.headers.get('x-real-ip') ?? '')
  return realIp ? realIp.toString() : null
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
