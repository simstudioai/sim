import { parse } from 'tldts'

/**
 * The cookies a per-site import may bring back from another browser.
 *
 * A sign-in rarely stays on the host the user started from — AWS signs in on
 * `signin.aws.amazon.com` and lands on `console.aws.amazon.com` — so the scope
 * is the page's registrable domain (eTLD+1), which covers both. Private
 * registry suffixes count as public here (`github.io`, `awsapps.com`), so one
 * tenant of a shared host never brings back its neighbours' cookies.
 */
export interface SiteScope {
  /** The registrable domain, or the exact host when it has none. */
  domain: string
  /** True when only cookies for `domain` itself qualify, never its subdomains. */
  exact: boolean
}

/**
 * Whether `host` is `domain` or one of its subdomains, matched on label
 * boundaries so `notexample.com` and `example.com.evil.com` never qualify.
 */
export function isSameOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/** The scope for a page on `hostname`, or null when there is no host to scope to. */
export function siteScopeFor(hostname: string): SiteScope | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0) return null
  const parsed = parse(host, { allowPrivateDomains: true })
  if (parsed.domain) return { domain: parsed.domain, exact: false }
  // An IP, a single-label host, or a bare public suffix has no registrable
  // parent to widen to, and its subdomains are other sites.
  return { domain: host, exact: true }
}

/**
 * Whether a cookie stored under Chromium's `host_key` belongs to `scope`. A
 * domain cookie on the suffix itself (`.github.io`) is no one tenant's sign-in.
 */
export function isCookieHostInScope(hostKey: string, scope: SiteScope): boolean {
  const host = hostKey.toLowerCase().replace(/^\./, '')
  return scope.exact ? host === scope.domain : isSameOrSubdomain(host, scope.domain)
}
