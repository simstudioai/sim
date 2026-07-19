import * as ipaddr from 'ipaddr.js'

/**
 * Strips the brackets the WHATWG URL parser puts around IPv6 authorities so the
 * result can be handed straight to {@link isPrivateIp} / {@link isIpLiteral}.
 */
export function unwrapIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

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
 * Loopback host identifiers permitted to use plain HTTP: `localhost` and the
 * canonical loopback IP literals. Compared after stripping IPv6 brackets.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * True when a host (name or IP literal, IPv6 brackets optional) is loopback by
 * exact match — `localhost`, `127.0.0.1`, or `::1`. For full-range loopback-IP
 * classification (e.g. `127.0.0.5`) use {@link isLoopbackIp}.
 */
export function isLoopbackHostname(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(unwrapIpv6Brackets(host))
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
