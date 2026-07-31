/**
 * Exact-origin normalization for credential matching.
 *
 * Version one matches on `scheme + host + effective port` and nothing looser:
 * `https://accounts.google.com` is not `https://google.com`, `https://x.com` is
 * not `http://x.com`, and a subdomain is a different site. Broader affiliation
 * is a deliberate non-goal — it is the kind of rule that is easy to widen by
 * accident and hard to explain to a user, and getting it wrong means a
 * password typed into the wrong site.
 */

/** Ports that are implied by the scheme and must not change identity. */
const DEFAULT_PORTS: Record<string, string> = { 'https:': '443', 'http:': '80' }

/**
 * The canonical origin for `value`, or null when it cannot host a credential.
 *
 * Rejects everything that is not http(s): `file:`, `data:`, `javascript:`, and
 * opaque origins have no trustworthy identity to bind a password to.
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname) return null

  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`
}

/** Usernames compare case-sensitively but ignore surrounding whitespace. */
export function normalizeUsername(username: string): string {
  return username.trim()
}
