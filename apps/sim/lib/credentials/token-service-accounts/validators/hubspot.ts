import { tenantPrincipal, userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isVendorJsonForbidden,
  parseProviderJson,
  providerFailureCode,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'
const CONTACTS_READ_URL = 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1'

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
 * Last word on a key account-info refused: a one-contact read, the request
 * HubSpot's service-key guide shows a key making. HubSpot answers a credential
 * it does not accept with a 401 and one that lacks the object's scope with a
 * 403, so a 200 or a JSON 403 proves the key is live. The route reports no
 * portal, so the key is accepted without a principal.
 */
async function verifyViaContactsRead(
  accessToken: string
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    CONTACTS_READ_URL,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    'contacts_read'
  )
  if (!isVendorJsonForbidden(res)) await throwForProviderResponse(res, 'contacts_read')
  await res.body?.cancel().catch(() => undefined)
  return { displayName: 'HubSpot', principal: null, auditMetadata: {} }
}

/**
 * Fallback verification via the Account Information API, a regular REST route
 * that reports the portal. A 200 proves the token is live; a JSON 403 means the
 * token authenticated but lacks account-info access, still a live token. An
 * HTML 403 is a firewall page, not HubSpot. HubSpot does not document how this
 * route answers a service key, so its 401 is settled by
 * {@link verifyViaContactsRead} rather than taken as a rejection.
 */
async function verifyViaAccountInfo(
  accessToken: string
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    ACCOUNT_INFO_URL,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    'account_info'
  )
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined)
    return verifyViaContactsRead(accessToken)
  }
  if (isVendorJsonForbidden(res)) {
    // The token is live but cannot read account info, so neither the portal
    // nor the creating user is knowable on this path.
    await res.body?.cancel().catch(() => undefined)
    return {
      displayName: 'HubSpot',
      principal: null,
      auditMetadata: {},
    }
  }
  await throwForProviderResponse(res, 'account_info')

  const info = await parseProviderJson<HubspotAccountInfo>(res, 'account_info')
  const hubId = typeof info?.portalId === 'number' ? String(info.portalId) : undefined
  return {
    displayName: hubId ? `HubSpot portal ${hubId}` : 'HubSpot',
    // This route never reports the private app's creating user, so the portal
    // is the finest identity available here.
    principal: hubId ? tenantPrincipal(hubId) : null,
    auditMetadata: {},
  }
}

/** The documented prefix of HubSpot service keys and private app tokens. */
const HUBSPOT_KEY_PREFIX = /^pat-/

/**
 * Validates a HubSpot service key or private app access token.
 *
 * Primary path: the documented access-token-info endpoint, sending both the
 * JSON body (`tokenKey`) and the `Authorization: Bearer` header — the header
 * is optional for NA (`pat-na1`) tokens but required for EU (`pat-eu1`)
 * tokens, so one code path covers both regions.
 *
 * That endpoint is documented only for private app tokens, and live probing
 * shows it returns a bare 404 (HTML) for a token it does not recognize. So any
 * non-transient 4xx other than 401 (408 and 429 are transient), a 401 for a
 * `pat-` key (which may be a service key), or a 200 without a portal falls back
 * to the Account Information API, and a key that route refuses is settled by a
 * contacts read, the route HubSpot documents for service keys. A token-info 401
 * for any other token is a rejection.
 *
 * The display name is `HubSpot portal {hubId}` when the portal is known — the
 * account-info `uiDomain` is the shared regional host (e.g. `app.hubspot.com`),
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
  const inconclusive =
    !res.ok &&
    providerFailureCode(res.status) === 'invalid_credentials' &&
    (res.status !== 401 || HUBSPOT_KEY_PREFIX.test(accessToken))
  if (inconclusive) {
    // This route 404s tokens it does not recognize and covers only private
    // apps, so a service key may be refused here yet work on every REST route.
    // Resolve via a regular API route with JSON errors.
    await res.body?.cancel().catch(() => undefined)
    return verifyViaAccountInfo(accessToken)
  }
  await throwForProviderResponse(res, 'access_token_info')

  const tokenInfo = await parseProviderJson<HubspotTokenInfo>(res, 'access_token_info')
  // A 200 without a portal is not a private app's answer; let the REST route decide.
  if (typeof tokenInfo?.hubId !== 'number') return verifyViaAccountInfo(accessToken)

  const hubId = String(tokenInfo.hubId)

  const storedMetadata: Record<string, string> = { hubId }
  if (typeof tokenInfo.appId === 'number') storedMetadata.appId = String(tokenInfo.appId)

  return {
    displayName: `HubSpot portal ${hubId}`,
    // `userId` is the HubSpot user the private app acts on behalf of; it is the
    // actor, while `hubId` is only the portal it lives in.
    principal:
      typeof tokenInfo.userId === 'number'
        ? userPrincipal(String(tokenInfo.userId))
        : tenantPrincipal(hubId),
    auditMetadata: { hubspotHubId: hubId },
    storedMetadata,
  }
}
