import {
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'

interface HubspotTokenInfo {
  hubId?: number
  appId?: number
  userId?: number
  scopes?: string[]
}

/**
 * Best-effort display-name upgrade via the account-info endpoint. Its
 * documented required scope (`oauth`) cannot be granted to private apps, so a
 * 403 (or any other failure) is expected and must never surface as a bad
 * token — callers fall back to the hubId-based name silently.
 */
async function fetchPortalUiDomain(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(ACCOUNT_INFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return undefined
    const details = (await res.json()) as { uiDomain?: string }
    return typeof details.uiDomain === 'string' && details.uiDomain ? details.uiDomain : undefined
  } catch {
    return undefined
  }
}

/**
 * Validates a HubSpot private app access token by calling the access-token-info
 * endpoint. Both the JSON body (`tokenKey`) and the `Authorization: Bearer`
 * header are sent — the header is optional for NA (`pat-na1`) tokens but
 * required for EU (`pat-eu1`) tokens, so one code path covers both regions.
 * The endpoint requires no scopes, so it validates any private-app token.
 */
export async function validateHubspotServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const accessToken = fields.apiToken

  const res = await fetch(TOKEN_INFO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ tokenKey: accessToken }),
  })
  await throwForProviderResponse(res, 'access_token_info')

  let tokenInfo: HubspotTokenInfo
  try {
    tokenInfo = (await res.json()) as HubspotTokenInfo
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'access_token_info',
      reason: 'response body is not valid JSON',
    })
  }
  if (typeof tokenInfo?.hubId !== 'number') {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'access_token_info',
      reason: 'missing hubId in response',
    })
  }

  const hubId = String(tokenInfo.hubId)
  const uiDomain = await fetchPortalUiDomain(accessToken)

  const storedMetadata: Record<string, string> = { hubId }
  if (typeof tokenInfo.appId === 'number') storedMetadata.appId = String(tokenInfo.appId)
  if (typeof tokenInfo.userId === 'number') storedMetadata.userId = String(tokenInfo.userId)

  return {
    displayName: uiDomain ?? `HubSpot portal ${hubId}`,
    auditMetadata: { hubspotHubId: hubId },
    storedMetadata,
  }
}
