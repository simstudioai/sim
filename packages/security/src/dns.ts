import dns from 'node:dns/promises'
import * as ipaddr from 'ipaddr.js'

/**
 * Hard deadline on an SSRF-guard lookup.
 *
 * A guard that awaits a hung resolver holds its caller open — an HTTP handler,
 * or a `webRequest` callback the browser is waiting on — so the lookup is
 * bounded rather than left to the OS resolver's own retry schedule.
 */
export const DEFAULT_DNS_TIMEOUT_MS = 5_000

/**
 * A resolver deadline rather than a missing host.
 *
 * Callers map both to the same user-facing message, but during a resolver
 * outage every valid hostname would otherwise be reported as nonexistent with
 * nothing in the logs telling the two apart.
 */
export class DnsTimeoutError extends Error {
  readonly code = 'DNS_TIMEOUT'

  constructor(host: string) {
    super(`DNS lookup for ${host} timed out`)
    this.name = 'DnsTimeoutError'
  }
}

/**
 * The address to connect to or pin, out of a set already judged acceptable.
 *
 * IPv4 first, for the reason described on {@link ResolvedHost.preferred}. Split
 * out so a caller that narrows the set — dropping records its policy refuses —
 * can re-apply the same preference to what is left instead of pinning an
 * address it just rejected.
 */
export function preferIpv4(addresses: readonly string[]): string | undefined {
  return (
    addresses.find(
      (address) => ipaddr.isValid(address) && ipaddr.parse(address).kind() === 'ipv4'
    ) ?? addresses[0]
  )
}

export interface ResolvedHost {
  /**
   * Every address the host resolves to.
   *
   * A guard must classify all of them. Checking one lets a host publishing both
   * a public and a private record through whenever the public one happens to be
   * picked, which is a matter of record order rather than of policy.
   */
  addresses: string[]
  /**
   * The single address a caller should connect to or pin.
   *
   * IPv4 first: pinning strips Happy Eyeballs' fallback, so a pinned IPv6
   * address hangs on IPv4-only egress (AWS NAT gateways, for one). Callers that
   * pin depend on this ordering.
   */
  preferred: string
}

/**
 * Resolves a host for an SSRF guard: every address it points at, plus the one
 * worth pinning, under a bounded deadline.
 *
 * Rejects when the host does not resolve or the deadline passes. Callers decide
 * what that means — failing closed is right for a guard, but "unresolvable" and
 * "resolves somewhere private" are different facts and some callers report them
 * differently.
 */
export async function resolveHostAddresses(
  host: string,
  options: { timeoutMs?: number } = {}
): Promise<ResolvedHost> {
  const { timeoutMs = DEFAULT_DNS_TIMEOUT_MS } = options
  const lookup = dns.lookup(host, { all: true, verbatim: true })
  // If the timeout wins the race the lookup stays pending; its eventual
  // settlement is swallowed so a late rejection cannot surface as an unhandled
  // one.
  lookup.catch(() => {})
  let timer: NodeJS.Timeout | undefined
  try {
    const resolved = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DnsTimeoutError(host)), timeoutMs)
      }),
    ])
    if (resolved.length === 0) {
      throw new Error(`No addresses for ${host}`)
    }
    return {
      addresses: resolved.map((entry) => entry.address),
      preferred: (resolved.find((entry) => entry.family === 4) ?? resolved[0]).address,
      // Resolver order is preserved (`verbatim: true`) because `preferred`
      // applies the IPv4 preference itself, so the order here is informational.
      // Deliberately unlike `createSsrfGuardedLookup` in apps/sim, which hands
      // its full ordered list to undici to dial in turn and so wants
      // `verbatim: false`.
    }
  } finally {
    clearTimeout(timer)
  }
}
