import freeEmailDomains from 'free-email-domains'

const FREE_EMAIL_DOMAINS = new Set(freeEmailDomains)

/**
 * True when the email's domain is a known free/personal provider (Gmail, Yahoo,
 * …) rather than a work address. Shared by the demo-request schema and form so
 * client gating and server validation agree on what counts as a work email.
 *
 * Isolated in its own module (not `validation.ts`) so the sizable domain list
 * only enters bundles that need the work-email check, not every consumer of
 * {@link quickValidateEmail}.
 */
export function isFreeEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? FREE_EMAIL_DOMAINS.has(domain) : false
}
