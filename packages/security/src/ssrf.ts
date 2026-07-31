import * as ipaddr from 'ipaddr.js'
import { unwrapIpv6Brackets } from './hostnames'

// Re-export the pure host helpers so existing `@sim/security/ssrf` consumers
// keep one import site; client code that must avoid ipaddr imports `./hostnames`.
export { isLoopbackHostname, unwrapIpv6Brackets } from './hostnames'

/**
 * True when the (bracket-free) host is an IP literal rather than a DNS name —
 * i.e. it can be classified with {@link isPrivateIp} directly, no DNS lookup.
 */
export function isIpLiteral(host: string): boolean {
  return ipaddr.isValid(host)
}

/**
 * True when an IP address is loopback (127.0.0.0/8 or ::1). Narrower than
 * {@link isPrivateIp}: callers that treat loopback differently from other
 * private ranges (e.g. allowing local dev servers on self-host) use this.
 */
export function isLoopbackIp(ip: string): boolean {
  try {
    return ipaddr.isValid(ip) && ipaddr.process(ip).range() === 'loopback'
  } catch {
    return false
  }
}

/**
 * Classifies an IP address as private or otherwise not routable on the public
 * internet — the core SSRF primitive shared by every app that resolves a user-
 * or model-supplied host before connecting to it.
 *
 * Uses ipaddr.js for robust handling of forms that regex checks miss:
 * - Octal (`0177.0.0.1`) and hex (`0x7f000001`) IPv4
 * - IPv4-mapped IPv6 (`::ffff:127.0.0.1`)
 * - IPv4-compatible IPv6 (`::a.b.c.d` / `::xxxx:xxxx`, RFC 4291 §2.5.5.1, deprecated)
 * - Loopback, link-local (incl. the `169.254.169.254` cloud-metadata endpoint),
 *   unique-local, multicast, and every other non-`unicast` range
 *
 * Expects a bare IP (brackets already stripped). Returns `true` (blocked) for
 * anything that is not a valid, publicly routable unicast address — including
 * unparseable input, so callers fail closed.
 */
export function isPrivateIp(ip: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) {
      return true
    }

    const addr = ipaddr.process(ip)
    const range = addr.range()

    if (range !== 'unicast') {
      return true
    }

    if (addr.kind() === 'ipv6') {
      const v6 = addr as ipaddr.IPv6
      const parts = v6.parts
      const firstSixZero = parts.slice(0, 6).every((p) => p === 0)
      if (firstSixZero) {
        const embedded = ipaddr.fromByteArray([
          (parts[6] >> 8) & 0xff,
          parts[6] & 0xff,
          (parts[7] >> 8) & 0xff,
          parts[7] & 0xff,
        ])
        return embedded.range() !== 'unicast'
      }
    }

    return false
  } catch {
    return true
  }
}

/**
 * Classifies a URL/host hostname string that may be an IP literal. Returns
 * `true` only when the host is a **literal** IP that {@link isPrivateIp} blocks;
 * a DNS name (which needs resolution to classify) returns `false`.
 *
 * Use this for the synchronous "is this host a private IP literal" guard — a
 * pre-navigation check, or a per-request subresource filter — where hostnames
 * are handled separately by a DNS-resolving check. IPv6 brackets are stripped
 * automatically.
 */
export function isPrivateIpHost(host: string): boolean {
  const clean = unwrapIpv6Brackets(host)
  return isIpLiteral(clean) && isPrivateIp(clean)
}
