import { createLogger } from '@sim/logger'
import {
  normalizeZohoDeskDataCenter,
  normalizeZohoDeskSoid,
  resolveZohoDeskDataCenter,
  ZOHO_DESK_DATA_CENTER_IDS,
  ZOHO_DESK_DATA_CENTER_REGEX,
  ZOHO_DESK_SOID_REGEX,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  readProviderErrorSnippet,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { tryDeriveZohoDeskBaseFromApiDomain } from '@/tools/zoho_desk/host-allowlist'

const logger = createLogger('ZohoDeskServiceAccountMinter')

const STEP = 'zoho_desk_token_mint'

/** Fallback token lifetime; Zoho documents one hour for this grant. */
const ZOHO_DEFAULT_TOKEN_TTL_SECONDS = 3600

interface ZohoTokenResponse {
  access_token?: string
  api_domain?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * Maps a Zoho token-endpoint `error` code to an operator-facing hint for server
 * logs. Every value here means "fix the pasted credentials or the Self Client
 * config", so all of them classify as `invalid_credentials`.
 */
function zohoErrorHint(error: string): string | undefined {
  const normalized = error.toLowerCase()
  if (normalized === 'invalid_client') {
    // Also the symptom of a wrong data center: a Self Client only exists on its
    // own region's accounts server, so an EU client presented to accounts.zoho.com
    // reads as an unknown client. Reconnect re-mints from the submitted fields, so
    // an admin who re-enters the secrets but leaves the region blank lands here.
    return 'invalid client_id or client_secret, the client is not a Self Client, or the wrong data center was selected for it'
  }
  if (normalized === 'invalid_scope' || normalized === 'invalid_scopes') {
    return 'the Self Client was not granted the Zoho Desk scopes Sim requests'
  }
  if (normalized === 'missing_org_info') {
    return 'Zoho could not resolve the organization from soid — check the Organization ID (Setup > Developer Space > API)'
  }
  if (normalized === 'invalid_soid' || normalized === 'invalid_org') {
    return 'the soid did not match a Zoho Desk organization — check the Organization ID, and try pasting the full ZohoDesk.<orgId> value'
  }
  if (normalized === 'invalid_grant' || normalized === 'unsupported_grant_type') {
    return 'the client does not support the client_credentials grant — create a Self Client in the Zoho API Console'
  }
  return undefined
}

/**
 * Extracts the `error` field from a Zoho token-endpoint body. Returns
 * `undefined` for a body that is not JSON or carries no `error`.
 */
function zohoBodyError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' && parsed.error ? parsed.error : undefined
  } catch {
    return undefined
  }
}

/**
 * Builds the `invalid_credentials` failure for a rejected mint, naming the
 * `soid` and the data center that were used so a wrong organization ID or a
 * wrong region is diagnosable from the server log without echoing the client
 * secret.
 */
function invalidCredentials(
  status: number,
  soid: string,
  dataCenterId: string,
  body: string,
  error?: string
): TokenServiceAccountValidationError {
  const hint = error ? zohoErrorHint(error) : undefined
  return new TokenServiceAccountValidationError('invalid_credentials', status, {
    step: STEP,
    soid,
    dataCenter: dataCenterId,
    body,
    ...(error ? { zohoError: error } : {}),
    ...(hint ? { hint } : {}),
  })
}

/**
 * Mints a Zoho Desk access token via the Self Client `client_credentials`
 * grant: POST `<accountsBase>/oauth/v2/token` with `client_id`,
 * `client_secret`, `scope`, and `soid` in the form body. Tokens live one hour
 * and there is no refresh token — re-mint instead of refreshing (same shape as
 * Zoom Server-to-Server).
 *
 * Zoho's accounts server is per data center. Unlike the interactive OAuth flow
 * (whose authorize/token URLs are static per provider and therefore US-only),
 * this path owns its token URL, so `fields.dataCenter` selects the region's
 * accounts server and the matching Desk REST host deterministically. A blank or
 * unrecognized value resolves to US, so credentials created before the field
 * existed behave exactly as before.
 *
 * Two Zoho-specific behaviors drive the error handling:
 *
 * - Zoho reports OAuth failures in the JSON body, frequently with HTTP 200
 *   (e.g. `{"error":"invalid_client"}`), so a status-only check would accept a
 *   failed mint. The success body is inspected for an `error` field before the
 *   token is read — mirroring the OAuth token exchange in `lib/auth/auth.ts`.
 * - `scope` must be COMMA-separated for Zoho, not space-separated. The list is
 *   sourced from the `zoho-desk` OAuth service so the Self Client and the OAuth
 *   flow can never request different scopes.
 *
 * 4xx maps to `invalid_credentials` except transient 429/408 throttling, which
 * maps to `provider_unavailable` alongside 5xx and network failures — provider
 * throttling is never blamed on the credentials.
 */
export async function mintZohoDeskServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const soid = normalizeZohoDeskSoid(fields.orgId)
  if (!ZOHO_DESK_SOID_REGEX.test(soid)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'soid_validation',
      soid,
      reason:
        'organization ID is not a numeric Zoho Desk org id (or a full ZohoDesk.<orgId> value)',
    })
  }

  // A blank data center legitimately means "US" (the pre-field default), but a
  // value that was typed and not recognized must not silently resolve to US and
  // then fail against Zoho as an opaque `invalid_client`. Reject it here, next to
  // the soid check, so the connect modal names the real problem. This runs on
  // every execution-time re-mint too, where there is no UI to show a format hint.
  const rawDataCenter = normalizeZohoDeskDataCenter(fields.dataCenter ?? '')
  if (rawDataCenter && !ZOHO_DESK_DATA_CENTER_REGEX.test(rawDataCenter)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'data_center_validation',
      dataCenter: rawDataCenter,
      reason: `unrecognized data center; expected one of ${ZOHO_DESK_DATA_CENTER_IDS.join(', ')} (or blank for us)`,
    })
  }

  const dataCenter = resolveZohoDeskDataCenter(rawDataCenter)

  // Zoho requires a comma-separated scope list on this endpoint; a
  // space-separated list is rejected as an invalid scope.
  // Only the Desk.* scopes. `aaaserver.profile.READ` exists for the interactive
  // OAuth flow's getUserInfo call; this grant never hits the Accounts profile
  // endpoint (identity is synthesized from orgId, and skipIdentity bypasses it
  // entirely at execution time). Sending an Accounts-server scope on the Desk
  // soid grant risks an opaque invalid_scope rejection for no benefit.
  const scope = getCanonicalScopesForProvider('zoho-desk')
    .filter((s) => s.startsWith('Desk.'))
    .join(',')

  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'Zoho Desk')

  const res = await fetchProvider(
    `${dataCenter.accountsBase}/oauth/v2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: clientSecret,
        scope,
        soid,
      }).toString(),
    },
    STEP
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      throw invalidCredentials(res.status, soid, dataCenter.id, body, zohoBodyError(body))
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: STEP,
      soid,
      dataCenter: dataCenter.id,
      body,
    })
  }

  const payload = await parseProviderJson<ZohoTokenResponse>(res, STEP)

  // Zoho signals OAuth failures in the body, usually with HTTP 200 — classify
  // on the body before trusting the status.
  if (typeof payload.error === 'string' && payload.error) {
    throw invalidCredentials(
      res.status,
      soid,
      dataCenter.id,
      JSON.stringify(payload),
      payload.error
    )
  }

  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      soid,
      dataCenter: dataCenter.id,
      reason: 'token response missing access_token',
    })
  }

  // The Desk REST host for the token's data center, allowlist-anchored. Tools
  // receive this as `apiDomain` so calls never assume desk.zoho.com. The
  // selected region's Desk host is the deterministic answer; Zoho documents
  // `api_domain` for CRM but not for Desk, so it is only an override. When it
  // IS present and disagrees, it wins — it is authoritative about where the
  // token actually works — but the mismatch is logged so a wrong region
  // selection is diagnosable. An `api_domain` that is absent or fails the Zoho
  // apex allowlist yields `undefined` here and never overrides the region.
  const reportedDeskBase = tryDeriveZohoDeskBaseFromApiDomain(payload.api_domain)
  const apiDomain = reportedDeskBase ?? dataCenter.deskBase
  if (reportedDeskBase && reportedDeskBase !== dataCenter.deskBase) {
    logger.warn('Zoho api_domain disagrees with the selected data center', {
      selectedDataCenter: dataCenter.id,
      usedProviderReportedDomain: true,
    })
  }
  const expiresInSeconds =
    typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? payload.expires_in
      : ZOHO_DEFAULT_TOKEN_TTL_SECONDS
  const grantedScopes =
    typeof payload.scope === 'string' ? payload.scope.split(/[\s,]+/).filter(Boolean) : undefined

  if (options?.skipIdentity) {
    return { accessToken: payload.access_token, expiresInSeconds, apiDomain, grantedScopes }
  }

  const storedMetadata: Record<string, string> = { apiDomain, dataCenter: dataCenter.id }
  if (grantedScopes?.length) {
    storedMetadata.grantedScopes = grantedScopes.join(' ')
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds,
    apiDomain,
    grantedScopes,
    identity: {
      displayName: `Zoho Desk org ${fields.orgId.trim()}`,
      // The Self Client grant is scoped to the organization (`soid`) and never
      // hits the Accounts profile endpoint, so no agent identity exists here.
      principal: tenantPrincipal(soid),
      auditMetadata: { zohoDeskClientId: fields.clientId },
      storedMetadata,
    },
  }
}
