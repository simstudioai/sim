import { normalizeAtlassianSiteUrl, selectAtlassianCloudId } from '@/lib/atlassian/discovery'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  fetchProviderJsonWithStatus,
  RetryableProviderNetworkError,
} from '@/lib/selectors/server/providers/provider-http'

const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources'
const ATLASSIAN_CLOUD_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/
const ATLASSIAN_DISCOVERY_ATTEMPT_TIMEOUT_MS = 5_000

interface AtlassianAccessibleResource {
  id?: string
  url?: string
}

const ATLASSIAN_SELECTOR_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
} as const

/**
 * Intentionally generic: retry diagnostics must never include a provider body,
 * selected domain, or credential-derived value.
 */
class RetryableAtlassianSelectorError extends Error {
  readonly status: number
  readonly retryAfterMs?: number

  constructor(status: number, retryAfterMs?: number) {
    super('Atlassian selector request unavailable')
    this.name = 'RetryableAtlassianSelectorError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
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

  let resources: AtlassianAccessibleResource[]
  try {
    resources = await retryWithExponentialBackoff(
      async () => {
        const attemptTimeout = AbortSignal.timeout(ATLASSIAN_DISCOVERY_ATTEMPT_TIMEOUT_MS)
        const attemptSignal = input.signal
          ? AbortSignal.any([input.signal, attemptTimeout])
          : attemptTimeout
        const response = await fetchProviderJsonWithStatus<AtlassianAccessibleResource[]>(
          ATLASSIAN_ACCESSIBLE_RESOURCES_URL,
          {
            headers: {
              Authorization: `Bearer ${input.accessToken}`,
              Accept: 'application/json',
            },
            redirect: 'error',
            signal: attemptSignal,
          },
          {
            passthroughStatus: (status) => status === 429 || status >= 500,
            passthroughNetworkErrors: true,
          }
        )
        if (response.ok) return response.data
        throw new RetryableAtlassianSelectorError(response.status, response.retryAfterMs)
      },
      {
        ...ATLASSIAN_SELECTOR_RETRY_OPTIONS,
        signal: input.signal,
        retryCondition: (error) =>
          (error instanceof RetryableAtlassianSelectorError &&
            (error.status === 429 || error.status >= 500)) ||
          error instanceof RetryableProviderNetworkError ||
          (error instanceof Error && error.name === 'TimeoutError'),
      }
    )
  } catch (error) {
    if (input.signal?.aborted) throw error
    if (
      error instanceof SelectorConnectionUnavailableError ||
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorOptionsUnavailableError
    ) {
      throw error
    }
    if (error instanceof RetryableAtlassianSelectorError) {
      throw new SelectorOptionsUnavailableError(error.status === 429 ? 429 : 502)
    }
    throw new SelectorOptionsUnavailableError()
  }

  try {
    return requireCloudId(selectAtlassianCloudId(resources, domain, input.product, true))
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
