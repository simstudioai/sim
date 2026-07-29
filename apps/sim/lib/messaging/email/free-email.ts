import freeEmailDomains from '@/lib/messaging/email/free-email-domains.json'

const FREE_EMAIL_DOMAINS = new Set<string>(freeEmailDomains)

/**
 * True when the email's domain is a known free/personal provider (Gmail, Yahoo,
 * …) rather than a work address. Shared by the demo-request schema and form so
 * client gating and server validation agree on what counts as a work email.
 *
 * Isolated in its own module (not `validation.ts`) so the sizable domain list
 * only enters bundles that need the work-email check, not every consumer of
 * {@link quickValidateEmail}.
 *
 * Vendored rather than taken from the `free-email-domains` package, whose `postinstall`
 * downloads a CDN CSV and overwrites its own `domains.json` — so the lockfile hash covers
 * the tarball but not the installed data. Refresh from
 * https://github.com/Kikobeats/free-email-domains (MIT) and review the diff.
 */
export function isFreeEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? FREE_EMAIL_DOMAINS.has(domain) : false
}
