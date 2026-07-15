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

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'

interface HubspotTokenInfo {
  hubId?: number
  appId?: number
  userId?: number
  scopes?: string[]
}

/**
 * Validates a HubSpot private app access token by calling the access-token-info
 * endpoint. Both the JSON body (`tokenKey`) and the `Authorization: Bearer`
 * header are sent — the header is optional for NA (`pat-na1`) tokens but
 * required for EU (`pat-eu1`) tokens, so one code path covers both regions.
 * The endpoint requires no scopes, so it validates any private-app token.
 *
 * The display name is always `HubSpot portal {hubId}` — the account-info
 * endpoint's `uiDomain` is the shared regional host (e.g. `app.hubspot.com`),
 * not a portal-specific name, so it is not used.
 */
export async function validateHubspotServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const accessToken = fields.apiToken

  const res = await fetchProvider(
    TOKEN_INFO_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tokenKey: accessToken }),
    },
    'access_token_info'
  )
  await throwForProviderResponse(res, 'access_token_info')

  const tokenInfo = await parseProviderJson<HubspotTokenInfo>(res, 'access_token_info')
  if (typeof tokenInfo?.hubId !== 'number') {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'access_token_info',
      reason: 'missing hubId in response',
    })
  }

  const hubId = String(tokenInfo.hubId)

  const storedMetadata: Record<string, string> = { hubId }
  if (typeof tokenInfo.appId === 'number') storedMetadata.appId = String(tokenInfo.appId)
  if (typeof tokenInfo.userId === 'number') storedMetadata.userId = String(tokenInfo.userId)

  return {
    displayName: `HubSpot portal ${hubId}`,
    auditMetadata: { hubspotHubId: hubId },
    storedMetadata,
  }
}
