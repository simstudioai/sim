import { normalizeMicrosoftDataverseEnvironmentUrl } from '@/lib/oauth/microsoft-dataverse'
import type { OAuthConfig } from '@/tools/types'

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

/** Shared credential policy for every Dataverse tool. */
export const DATAVERSE_OAUTH_CONFIG = {
  required: true,
  provider: 'microsoft-dataverse',
  authoritativeParams: ['credentialType', 'instanceUrl'],
} as const satisfies OAuthConfig

interface DataverseRequestTarget {
  environmentUrl: string
  /** Set only by credential resolution (an authoritative param), never by the caller. */
  credentialType?: unknown
  /** The environment a saved Microsoft app credential is bound to, from credential resolution. */
  instanceUrl?: unknown
}

/**
 * The Web API base a Dataverse request goes to. A signed-in OAuth account
 * keeps the block's environment URL exactly as before. A saved Microsoft app
 * credential's token is minted for its own environment, so the request goes
 * there and only there: the block's environment URL must name the same
 * environment, and anything else is refused rather than sent elsewhere.
 */
export function getDataverseRequestBaseUrl(params: DataverseRequestTarget): string {
  if (params.credentialType !== 'service_account') {
    return getDataverseBaseUrl(params.environmentUrl)
  }
  let credentialEnvironment: string
  try {
    credentialEnvironment = normalizeMicrosoftDataverseEnvironmentUrl(params.instanceUrl)
  } catch {
    throw new Error(
      'This Microsoft app credential has no Dataverse environment. Reconnect it with the environment URL.'
    )
  }
  let requestedEnvironment: string | undefined
  try {
    requestedEnvironment = normalizeMicrosoftDataverseEnvironmentUrl(params.environmentUrl)
  } catch {
    requestedEnvironment = undefined
  }
  if (requestedEnvironment !== credentialEnvironment) {
    throw new Error(
      'The selected Microsoft app credential belongs to a different Dataverse environment. Select a credential for this environment.'
    )
  }
  return credentialEnvironment
}

/** A numeric option counts as provided unless it is absent or blank, so an explicit 0 is still sent. */
export function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}
