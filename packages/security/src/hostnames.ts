/**
 * Pure host-string helpers with no `ipaddr.js` dependency, so client bundles can
 * share them without pulling the IP library. The ipaddr-backed classification
 * lives in `./ssrf`, which re-exports these for its own consumers.
 */

/**
 * Strips the brackets the WHATWG URL parser puts around IPv6 authorities so the
 * result can be matched or handed to an IP classifier directly.
 */
export function unwrapIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Loopback host identifiers permitted to use plain HTTP: `localhost` and the
 * canonical loopback IP literals. Compared after stripping IPv6 brackets.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * True when a host (name or IP literal, IPv6 brackets optional) is loopback by
 * exact match — `localhost`, `127.0.0.1`, or `::1`. For full-range loopback-IP
 * classification (e.g. `127.0.0.5`) use `isLoopbackIp` from `./ssrf`.
 */
export function isLoopbackHostname(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(unwrapIpv6Brackets(host))
}
