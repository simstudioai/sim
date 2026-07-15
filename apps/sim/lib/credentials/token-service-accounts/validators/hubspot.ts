import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
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

interface HubspotAccountInfo {
  portalId?: number
}

/**
 * Fallback verification via the Account Information API. Live probing shows
 * the documented access-token-info route returns a bare 404 for invalid
 * tokens, which is ambiguous (invalid token vs. missing route), while this
 * regular API route answers with a proper JSON 401 for bad tokens. A 200
 * proves the token is live; 401 means it was rejected; 403 means the token
 * authenticated but the app lacks account-info access — still a live token.
 */
async function verifyViaAccountInfo(
  accessToken: string
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    ACCOUNT_INFO_URL,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    'account_info'
  )
  if (res.status === 403) {
    return {
      displayName: 'HubSpot private app',
      auditMetadata: {},
      storedMetadata: {},
    }
  }
  await throwForProviderResponse(res, 'account_info')

  const info = await parseProviderJson<HubspotAccountInfo>(res, 'account_info')
  const hubId = typeof info?.portalId === 'number' ? String(info.portalId) : undefined
  return {
    displayName: hubId ? `HubSpot portal ${hubId}` : 'HubSpot private app',
    auditMetadata: hubId ? { hubspotHubId: hubId } : {},
    storedMetadata: hubId ? { hubId } : {},
  }
}

/**
 * Validates a HubSpot private app access token.
 *
 * Primary path: the documented access-token-info endpoint, sending both the
 * JSON body (`tokenKey`) and the `Authorization: Bearer` header — the header
 * is optional for NA (`pat-na1`) tokens but required for EU (`pat-eu1`)
 * tokens, so one code path covers both regions.
 *
 * Live probing shows that endpoint returns a bare 404 (HTML) when the token
 * is not recognized, so a 404 falls back to the Account Information API,
 * which distinguishes a rejected token (JSON 401) from a live one (200/403).
 *
 * The display name is always `HubSpot portal {hubId}` — the account-info
 * `uiDomain` is the shared regional host (e.g. `app.hubspot.com`), not a
 * portal-specific name, so it is not used.
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
  if (res.status === 404 || res.status === 400) {
    // Ambiguous: HubSpot 404s unrecognized tokens on this route (and 400s
    // malformed ones). Resolve via a regular API route with JSON errors.
    await readProviderErrorSnippet(res)
    return verifyViaAccountInfo(accessToken)
  }
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
