import { createLogger } from '@sim/logger'

const logger = createLogger('DisposableEmail')

let disposableDomains: Promise<ReadonlySet<string>> | undefined

/**
 * Loaded on first use rather than at import: the list is ~100k domains, and every server module
 * that reaches the auth config would otherwise parse it at startup to serve a check that only
 * account creation runs. A failed load is not cached, so the next signup retries it.
 */
function loadDisposableDomains(): Promise<ReadonlySet<string>> {
  disposableDomains ??= import('@/lib/messaging/email/disposable-email-domains.json').then(
    ({ default: domains }) => new Set(domains),
    (error: unknown) => {
      disposableDomains = undefined
      throw error
    }
  )
  return disposableDomains
}

/**
 * True when the email's domain, or any parent of it, is a known disposable or temporary inbox
 * provider (Mailinator, temp-mail services, …). The server-side signup gate, applied to every
 * provider at account creation; `quickValidateEmail`'s short list is only client feedback.
 *
 * Fails open: if the list cannot load, the check logs and allows the signup, because refusing
 * every legitimate signup is worse than admitting a few throwaway ones.
 *
 * `disposable-email-domains.json` is vendored, not a package dependency, so the reviewed diff is
 * exactly what ships. It is the union of two lists, lowercased, de-duplicated, and sorted:
 * - https://github.com/disposable/disposable-email-domains `domains.txt` (MIT), at
 *   f0cfcc8aea24892c0adc88e6433f866477837d07
 * - https://github.com/disposable-email-domains/disposable-email-domains
 *   `disposable_email_blocklist.conf` (CC0), at e2254bf7fc8dcf113f6028b21e263a352111490b
 *
 * Refresh from both and review the diff for mainstream providers and mail relays (Gmail,
 * Outlook, iCloud, Proton, DuckDuckGo, Firefox Relay, SimpleLogin, addy.io), none of which
 * belong here.
 */
export async function isDisposableEmail(email: string | null | undefined): Promise<boolean> {
  const domain = email?.split('@')[1]?.trim().toLowerCase()
  if (!domain) return false

  let domains: ReadonlySet<string>
  try {
    domains = await loadDisposableDomains()
  } catch (error) {
    logger.error('Disposable email list failed to load; allowing the signup', { error })
    return false
  }

  const labels = domain.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    if (domains.has(labels.slice(i).join('.'))) return true
  }
  return false
}
