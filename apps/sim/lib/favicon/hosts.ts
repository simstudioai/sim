import { parse } from 'tldts'
import { platformSite } from '@/lib/favicon/platforms'

const MAX_PARENT_HOSTS = 3
const HOST_SHAPE = /^[^\s/?#@\\]+$/

/**
 * Hosts to ask a favicon provider about, most specific first. A private tenant such as
 * `acme.atlassian.net` is invisible to providers, but its platform is not, so each parent
 * domain follows — at most three, stopping before the ICANN public suffix (`gitlab.io` is a valid
 * last step; `io` and `co.uk` are not). A host on a platform no provider can see even at the
 * parent (`x.awsapps.com`, a self-hosted `gitlab.<company>`) ends at the platform's own site, after
 * its own host and parents so a tenant's custom icon still wins. Internal hosts — IP literals, single labels, and names outside
 * the public DNS — yield nothing, so they never leave the server, and neither does a name with
 * characters DNS can't hold, which could otherwise reshape a provider's URL.
 */
export function faviconHostCandidates(input: string): string[] {
  const url = HOST_SHAPE.test(input) ? URL.parse(`https://${input}`) : null
  if (!url) return []
  const hostname = url.hostname.replace(/\.$/, '')
  if (hostname.split('.').some((label) => !label)) return []
  const { isIp, isIcann, publicSuffix } = parse(hostname, {
    allowPrivateDomains: false,
    validateHostname: true,
  })
  if (isIp || !isIcann || !publicSuffix || /(^|\.)arpa$/.test(publicSuffix)) return []
  const labels = hostname.split('.')
  const candidateCount = labels.length - publicSuffix.split('.').length
  const candidates = labels
    .slice(0, Math.min(candidateCount, MAX_PARENT_HOSTS + 1))
    .map((_, index) => labels.slice(index).join('.'))
  const platform = platformSite(hostname)
  return platform && !candidates.includes(platform) ? [...candidates, platform] : candidates
}
