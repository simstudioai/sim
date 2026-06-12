import disposableDomains from 'disposable-email-domains'
import wildcardBaseDomains from 'disposable-email-domains/wildcard.json'

const exactDomains = new Set(disposableDomains)

/**
 * Server-only disposable-email-domain check backed by the `disposable-email-domains`
 * package (~120K exact domains plus wildcard base domains). Layered alongside
 * better-auth-harmony's bundled Mailchecker list at the signup gate.
 *
 * Never import from client code — the dataset would bloat the browser bundle.
 * Matches exact domains and any subdomain of a wildcard base domain.
 */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  if (exactDomains.has(domain)) return true
  return wildcardBaseDomains.some((base) => domain === base || domain.endsWith(`.${base}`))
}
