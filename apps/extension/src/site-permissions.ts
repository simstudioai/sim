import { SIM_ORIGIN } from '@/config'

/** Only a concrete web origin can be granted. Paths, queries, and fragments never enter a request. */
export function parseSiteAddress(input: string): URL | null {
  const address = input.trim()
  if (!address || address.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(input)) return null
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(address)
  const hostWithPort = /^[\w.-]+:\d+(?:[/?#]|$)/.test(address)
  const value = withScheme && !hostWithPort ? address : `https://${address}`
  if (!/^https?:\/\/[^/\s]/i.test(value)) return null
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0]
  if (/[@%*\s]/.test(authority)) return null
  try {
    const site = new URL(value)
    if (/[%*]/.test(site.hostname) || site.username || site.password) return null
    return new URL(site.origin)
  } catch {
    return null
  }
}

export function requiredSite(site: URL) {
  const sim = new URL(SIM_ORIGIN)
  return (
    site.hostname === 'sim' ||
    (site.hostname === sim.hostname &&
      site.protocol === sim.protocol &&
      (!sim.port || site.port === sim.port))
  )
}

/** A match pattern without a port also grants access on other ports of this host. */
export function sitePattern(site: URL) {
  return `${site.protocol}//${site.hostname}:${site.port || (site.protocol === 'https:' ? '443' : '80')}/*`
}

export async function readSitePermission(site: URL) {
  const pattern = sitePattern(site)
  const [allowed, permissions] = await Promise.all([
    chrome.permissions.contains({ origins: [pattern] }),
    chrome.permissions.getAll(),
  ])
  const legacy = `${site.protocol}//${site.hostname}/*`
  const removable = (permissions.origins ?? []).filter(
    (origin) => origin === pattern || origin === legacy
  )
  return { origin: site.origin, allowed, removable, allPorts: removable.includes(legacy) }
}
