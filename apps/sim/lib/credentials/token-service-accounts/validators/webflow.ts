import {
  fetchProvider,
  parseProviderJson,
  throwForProviderResponse,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

interface WebflowSite {
  id?: string
  displayName?: string
  shortName?: string
}

/**
 * Validates a Webflow site API token by listing sites via the Data API v2.
 * A site token is bound to exactly one site, so `GET /v2/sites` returns that
 * site and doubles as the whoami-equivalent (site tokens cannot call the
 * authorization endpoints). Requires the `sites:read` scope — a token missing
 * it surfaces as 401/403, which maps to `invalid_credentials`; any other
 * non-2xx means Webflow is unavailable. A 200 with an empty `sites` array is
 * treated as `provider_unavailable` since a site token should always list its
 * one site.
 */
export async function validateWebflowServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const sitesRes = await fetchProvider(
    'https://api.webflow.com/v2/sites',
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        Accept: 'application/json',
      },
    },
    'list_sites'
  )
  await throwForProviderResponse(sitesRes, 'list_sites')

  const payload = await parseProviderJson<{ sites?: WebflowSite[] }>(sitesRes, 'list_sites')
  const site = payload.sites?.[0]
  if (!site?.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'list_sites',
      reason: 'missing or empty sites array in response',
    })
  }

  const displayName = site.displayName || site.shortName || 'Webflow site'

  return {
    displayName,
    auditMetadata: { webflowSiteId: site.id },
    storedMetadata: { siteId: site.id, siteName: displayName },
  }
}
