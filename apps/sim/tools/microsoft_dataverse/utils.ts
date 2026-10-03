/**
 * Registrable domains Microsoft serves Dataverse environments from — commercial and
 * regional clouds (`*.crm[N].dynamics.com`), China (21Vianet), US Government and DoD,
 * and the legacy German cloud. Matching on the registrable domain rather than each
 * regional `crmN` prefix keeps new Microsoft regions working without a code change.
 */
const DATAVERSE_HOST_SUFFIXES = [
  '.dynamics.com',
  '.dynamics.cn',
  '.dynamics.de',
  '.microsoftdynamics.us',
  '.appsplatform.us',
] as const

/**
 * Normalizes a Dataverse environment URL into a base URL suitable for building Web API request
 * paths: trims incidental whitespace (common when pasted from a browser address bar) and strips
 * a trailing slash so callers can safely append `/api/data/v9.2/...`.
 *
 * The value is user-supplied and every request built from it carries the caller's OAuth bearer
 * token, so the host is pinned to Microsoft's Dataverse domains — an arbitrary origin here would
 * otherwise receive that token.
 *
 * @throws {Error} when the value is empty, not a parseable absolute URL, not HTTPS, carries
 *   credentials, or is not a Dataverse host.
 */
export function getDataverseBaseUrl(environmentUrl: string): string {
  const value = typeof environmentUrl === 'string' ? environmentUrl.trim() : ''
  if (!value) {
    throw new Error('Environment URL is required')
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Environment URL must be an absolute URL, e.g. https://myorg.crm.dynamics.com')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Environment URL must use https')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Environment URL must not contain credentials')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!DATAVERSE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error(
      'Environment URL must be a Dataverse environment, e.g. https://myorg.crm.dynamics.com'
    )
  }

  return parsed.origin
}
