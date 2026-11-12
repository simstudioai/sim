import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  parseProviderJson,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
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
 * non-2xx means Webflow is unavailable. The route lists every site the token
 * can access, so an empty list is a token that reaches no site, which the
 * user must replace. Only a token that reaches exactly one site is named
 * after it; one that reaches several has no single site to stand for it.
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
  if (!Array.isArray(payload.sites)) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'list_sites',
      reason: 'missing sites array in response',
    })
  }
  if (payload.sites.length === 0) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'list_sites',
      reason: 'token reaches no site',
    })
  }
  if (payload.sites.length > 1) {
    return { displayName: 'Webflow', principal: null, auditMetadata: {} }
  }
  const [site] = payload.sites
  if (!site?.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'list_sites',
      reason: 'site without an id in response',
    })
  }

  const displayName = site.displayName || site.shortName || 'Webflow site'

  // A site API token is bound to a site, never to a Webflow user.
  return {
    displayName,
    principal: tenantPrincipal(site.id, displayName),
    auditMetadata: {},
  }
}
