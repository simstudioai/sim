import dns from 'node:dns/promises'

/**
 * Hard deadline on an SSRF-guard lookup.
 *
 * A guard that awaits a hung resolver holds its caller open — an HTTP handler,
 * or a `webRequest` callback the browser is waiting on — so the lookup is
 * bounded rather than left to the OS resolver's own retry schedule.
 */
export const DEFAULT_DNS_TIMEOUT_MS = 5_000

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
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs)
      }),
    ])
    if (resolved.length === 0) {
      throw new Error(`No addresses for ${host}`)
    }
    return {
      addresses: resolved.map((entry) => entry.address),
      preferred: (resolved.find((entry) => entry.family === 4) ?? resolved[0]).address,
    }
  } finally {
    clearTimeout(timer)
  }
}
