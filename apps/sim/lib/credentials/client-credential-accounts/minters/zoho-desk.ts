import {
  normalizeZohoDeskSoid,
  ZOHO_DESK_SOID_REGEX,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { deriveZohoDeskBaseFromApiDomain } from '@/tools/zoho_desk/host-allowlist'

/**
 * Zoho's accounts server is per data center, but this integration is pinned to
 * the US accounts host throughout (the OAuth authorize/token URLs in
 * `lib/auth/auth.ts` use the same host) — a documented limitation of the Zoho
 * Desk integration, not an oversight. Non-US orgs must authenticate against
 * their own accounts server and are not supported here.
 */
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'

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
    return 'invalid client_id or client_secret, or the client is not a Self Client'
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
 * `soid` that was sent so a wrong organization ID is diagnosable from the
 * server log without echoing the client secret.
 */
function invalidCredentials(
  status: number,
  soid: string,
  body: string,
  error?: string
): TokenServiceAccountValidationError {
  const hint = error ? zohoErrorHint(error) : undefined
  return new TokenServiceAccountValidationError('invalid_credentials', status, {
    step: STEP,
    soid,
    body,
    ...(error ? { zohoError: error } : {}),
    ...(hint ? { hint } : {}),
  })
}

/**
 * Mints a Zoho Desk access token via the Self Client `client_credentials`
 * grant: POST https://accounts.zoho.com/oauth/v2/token with `client_id`,
 * `client_secret`, `scope`, and `soid` in the form body. Tokens live one hour
 * and there is no refresh token — re-mint instead of refreshing (same shape as
 * Zoom Server-to-Server).
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

  // Zoho requires a comma-separated scope list on this endpoint; a
  // space-separated list is rejected as an invalid scope.
  const scope = getCanonicalScopesForProvider('zoho-desk').join(',')

  const res = await fetchProvider(
    ZOHO_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: fields.clientSecret,
        scope,
        soid,
      }).toString(),
    },
    STEP
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      throw invalidCredentials(res.status, soid, body, zohoBodyError(body))
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: STEP,
      soid,
      body,
    })
  }

  const payload = await parseProviderJson<ZohoTokenResponse>(res, STEP)

  // Zoho signals OAuth failures in the body, usually with HTTP 200 — classify
  // on the body before trusting the status.
  if (typeof payload.error === 'string' && payload.error) {
    throw invalidCredentials(res.status, soid, JSON.stringify(payload), payload.error)
  }

  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      soid,
      reason: 'token response missing access_token',
    })
  }

  // The Desk REST host for the token's data center, allowlist-anchored. Tools
  // receive this as `apiDomain` so calls never assume desk.zoho.com.
  const apiDomain = deriveZohoDeskBaseFromApiDomain(payload.api_domain)
  const expiresInSeconds =
    typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? payload.expires_in
      : ZOHO_DEFAULT_TOKEN_TTL_SECONDS
  const grantedScopes =
    typeof payload.scope === 'string' ? payload.scope.split(/[\s,]+/).filter(Boolean) : undefined

  if (options?.skipIdentity) {
    return { accessToken: payload.access_token, expiresInSeconds, apiDomain, grantedScopes }
  }

  const storedMetadata: Record<string, string> = { soid, apiDomain }
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
      auditMetadata: { zohoDeskSoid: soid, zohoDeskClientId: fields.clientId },
      storedMetadata,
    },
  }
}
