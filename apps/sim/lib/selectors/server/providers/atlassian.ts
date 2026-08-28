import { normalizeAtlassianSiteUrl, selectAtlassianCloudId } from '@/lib/atlassian/discovery'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'

const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources'
const ATLASSIAN_CLOUD_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

interface AtlassianAccessibleResource {
  id?: string
  url?: string
}

function requireCloudId(value: string): string {
  if (!ATLASSIAN_CLOUD_ID_PATTERN.test(value)) {
    throw new SelectorOptionsUnavailableError()
  }
  return value
}

/**
 * Resolves an Atlassian cloud id without putting a reference-resolved domain in
 * the shared discovery cache key. The endpoint is fixed and provider failures
 * are deliberately collapsed before they reach the selector response boundary.
 */
export async function resolveSelectorAtlassianCloudId(input: {
  accessToken: string
  domain: string | undefined
  providedCloudId?: string
  providedDomain?: string
  product: 'Jira' | 'Confluence'
  signal?: AbortSignal
}): Promise<string> {
  if (input.providedCloudId) {
    const contextDomain = input.domain?.trim()
    const credentialDomain = input.providedDomain?.trim()
    if (
      !contextDomain ||
      !credentialDomain ||
      normalizeAtlassianSiteUrl(contextDomain) !== normalizeAtlassianSiteUrl(credentialDomain)
    ) {
      throw new SelectorConnectionUnavailableError()
    }
    return requireCloudId(input.providedCloudId)
  }

  const domain = input.domain?.trim()
  if (!domain) throw new SelectorContextUnavailableError()

  const resources = await fetchProviderJson<AtlassianAccessibleResource[]>(
    ATLASSIAN_ACCESSIBLE_RESOURCES_URL,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: input.signal,
    }
  )

  try {
    return requireCloudId(selectAtlassianCloudId(resources, domain, input.product))
  } catch (error) {
    if (
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorOptionsUnavailableError
    ) {
      throw error
    }
    throw new SelectorOptionsUnavailableError()
  }
}
