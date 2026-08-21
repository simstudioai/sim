import { findInvalidTrustedProxies, getIPFromHeader } from '@better-auth/core/utils/ip'

/**
 * Headers consulted for the client IP, in precedence order. `x-forwarded-for`
 * carries the proxy chain and is the only one verifiable against a trusted-proxy
 * set; `x-real-ip` is a single-value fallback for ingresses that set it instead.
 *
 * Also passed to Better Auth as `advanced.ipAddress.ipAddressHeaders`, whose own
 * default is `x-forwarded-for` alone — without it an `x-real-ip`-only deployment
 * would resolve an IP here and record none on the session.
 */
export const CLIENT_IP_HEADERS = ['x-forwarded-for', 'x-real-ip'] as const

/**
 * Better Auth masks IPv6 to a /64 by default, which groups a subnet into one
 * rate-limit bucket but cannot identify a caller. Everything here identifies, so
 * it stays exact — at the cost that results come back fully expanded
 * (`2001:0db8:0000:...`), so anything comparing against operator-entered text
 * must canonicalize that side too.
 */
const EXACT_IPV6_SUBNET = 128

/** Anything exposing header lookup by name — `Request.headers`, `Headers`, or a stub. */
export interface ClientIpHeaders {
  get(name: string): string | null
}

export interface ResolveClientIpOptions {
  /**
   * Reverse-proxy hops trusted to have appended the forwarded chain, as IPs or
   * CIDR ranges. Empty declares no proxy, so only a single-value header is
   * trusted and any multi-hop chain resolves to `null`.
   */
  trustedProxies?: string[]
  /** Overrides {@link CLIENT_IP_HEADERS}. */
  headers?: readonly string[]
}

/**
 * Resolves the client IP of a request, or `null` when no trustworthy address
 * can be established.
 *
 * The leftmost `x-forwarded-for` token is written by the client, so it is never
 * read directly. With `trustedProxies` set the chain is walked right to left,
 * known hops are skipped, and the first untrusted address is the client; a
 * malformed hop fails closed.
 *
 * Delegates to Better Auth so this agrees by construction with the `ipAddress`
 * on every session row — a second parser would be a second definition of "the
 * client IP", and the two would drift.
 *
 * Callers must treat `null` as unknown, never as a match: a shared rate-limit
 * bucket, or a denial for anything IP-gated.
 */
export function resolveClientIp(
  request: { headers: ClientIpHeaders },
  options: ResolveClientIpOptions = {}
): string | null {
  const { trustedProxies = [], headers = CLIENT_IP_HEADERS } = options

  for (const header of headers) {
    const value = request.headers.get(header)
    if (!value) continue
    const ip = getIPFromHeader(value, { trustedProxies, ipv6Subnet: EXACT_IPV6_SUBNET })
    if (ip) return ip
  }

  return null
}

/**
 * Bucket key segment standing in for a client IP that could not be trusted.
 * Never a valid IP, so no client can steer itself into or out of it.
 */
export const UNRESOLVED_CLIENT_IP_BUCKET = 'unresolved'

/** Splits an `AUTH_TRUSTED_PROXIES` value into entries. */
export function parseTrustedProxies(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Trusted-proxy entries that are not a valid IP or CIDR range. Malformed entries
 * are dropped during resolution rather than throwing, so reporting them is the
 * only way an operator learns a typo left the chain unverified.
 */
export function findMalformedTrustedProxies(entries: string[]): string[] {
  return findInvalidTrustedProxies(entries)
}

/**
 * Whether an entry trusts every possible hop, which makes the walk skip every
 * address and run off the end so no request resolves an IP. It fails closed, but
 * silently — the symptom is indistinguishable from having no clients.
 */
export function isAllTrustingProxyEntry(entry: string): boolean {
  const normalized = entry.trim()
  return normalized === '0.0.0.0/0' || normalized === '::/0'
}
