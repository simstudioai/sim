import { parse } from 'tldts'
import { platformSite } from '@/lib/favicon/platforms'

/** Parents nearest the host tried before the registrable domain, which is always tried last. */
const NEAREST_PARENT_HOSTS = 2
const HOST_SHAPE = /^[^\s/?#@\\]+$/

/**
 * Hosts to ask a favicon provider about, most specific first. A private tenant such as
 * `acme.atlassian.net` is invisible to providers, but its platform is not, so each parent
 * domain follows — the two nearest, then the registrable domain, which is most likely to have an
 * icon, never the ICANN public suffix (`gitlab.io` is a valid last step; `io` and `co.uk` are
 * not). A host on a platform no provider can see even at the parent (`x.awsapps.com`, a
 * self-hosted `gitlab.<company>`) ends at the platform's own site, after its own host and parents
 * so a tenant's custom icon still wins. Internal hosts — IP literals, single labels, and names
 * outside the public DNS — yield nothing, so they never leave the server, and neither does a name
 * with characters DNS can't hold, which could otherwise reshape a provider's URL.
 */
export function faviconHostCandidates(input: string): string[] {
  const url = HOST_SHAPE.test(input) ? URL.parse(`https://${input}`) : null
  if (!url) return []
  const hostname = url.hostname.replace(/\.$/, '')
  if (hostname.split('.').some((label) => !label)) return []
  const { isIp, isIcann, publicSuffix, domain } = parse(hostname, {
    allowPrivateDomains: false,
    validateHostname: true,
  })
  if (isIp || !isIcann || !publicSuffix || !domain || /(^|\.)arpa$/.test(publicSuffix)) return []
  const labels = hostname.split('.')
  const nearest = labels
    .slice(0, Math.min(labels.length - publicSuffix.split('.').length, NEAREST_PARENT_HOSTS + 1))
    .map((_, index) => labels.slice(index).join('.'))
  const candidates = nearest.includes(domain) ? nearest : [...nearest, domain]
  const platform = platformSite(hostname)
  return platform && !candidates.includes(platform) ? [...candidates, platform] : candidates
}
