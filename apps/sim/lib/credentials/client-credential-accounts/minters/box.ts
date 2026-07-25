import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountIdentity,
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

const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token'
const BOX_CURRENT_USER_URL = 'https://api.box.com/2.0/users/me'

interface BoxTokenResponse {
  access_token?: string
  expires_in?: number
}

interface BoxCurrentUserResponse {
  name?: string
  login?: string
}

/**
 * Maps a parsed Box OAuth2Error body to an operator-facing hint for server
 * logs. Box reports every CCG auth failure as HTTP 400 with an `error` field,
 * so the field value is the only way to distinguish bad credentials from a
 * not-yet-authorized or wrongly-typed app.
 */
function boxErrorHint(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string; error_description?: string }
    switch (parsed.error) {
      case 'invalid_client':
        return 'client credentials are not valid'
      case 'unauthorized_client':
        return /grant type/i.test(parsed.error_description ?? '')
          ? 'app was created as user authentication (OAuth 2.0) instead of Server Authentication'
          : 'app is not authorized by the enterprise admin (Platform Apps Manager)'
      case 'invalid_grant':
        return 'Client ID, Client Secret, and Enterprise ID do not all belong to the same app/enterprise, or the app has not been authorized in the Admin Console'
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

/**
 * Best-effort identity lookup for the app's Service Account user. A failure
 * never fails the mint — the caller falls back to an Enterprise-ID-derived
 * display name.
 */
async function fetchBoxServiceAccountIdentity(
  accessToken: string,
  orgId: string
): Promise<ClientCredentialAccountIdentity> {
  const fallback: ClientCredentialAccountIdentity = {
    displayName: `Box enterprise ${orgId}`,
    auditMetadata: { boxEnterpriseId: orgId },
  }
  try {
    const res = await fetchProvider(
      BOX_CURRENT_USER_URL,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      'box_identity'
    )
    if (!res.ok) return fallback
    const user = await parseProviderJson<BoxCurrentUserResponse>(res, 'box_identity')
    const login = typeof user.login === 'string' && user.login ? user.login : undefined
    const name = typeof user.name === 'string' && user.name ? user.name : undefined
    return {
      displayName: name ?? login ?? fallback.displayName,
      auditMetadata: {
        boxEnterpriseId: orgId,
        ...(login ? { boxServiceAccountLogin: login } : {}),
      },
      storedMetadata: {
        enterpriseId: orgId,
        ...(login ? { serviceAccountLogin: login } : {}),
      },
    }
  } catch {
    return fallback
  }
}

/**
 * Mints a Box access token via the Client Credentials Grant, authenticating
 * as the Platform App's Service Account (`box_subject_type=enterprise`).
 * Credentials ride in the form body (client_secret_post); tokens live ~1 hour
 * (honor the response's `expires_in`), carry no refresh token, and are
 * re-minted rather than refreshed.
 *
 * Box reports every CCG auth failure as HTTP 400 with an OAuth2Error body
 * (`invalid_client`, `unauthorized_client`, `invalid_grant`), so 4xx maps to
 * `invalid_credentials` — except transient 429/408 throttling statuses, which
 * map to `provider_unavailable` alongside 5xx/network failures (never blame
 * the credentials for provider-side throttling).
 */
export async function mintBoxServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const res = await fetchProvider(
    BOX_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: fields.clientSecret,
        box_subject_type: 'enterprise',
        box_subject_id: fields.orgId,
      }).toString(),
    },
    'box_token_mint'
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      const hint = boxErrorHint(body)
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'box_token_mint',
        body,
        ...(hint ? { hint } : {}),
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: 'box_token_mint',
      body,
    })
  }

  const payload = await parseProviderJson<BoxTokenResponse>(res, 'box_token_mint')
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'box_token_mint',
      reason: 'token response missing access_token',
    })
  }

  const accessToken = payload.access_token
  const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600

  if (options?.skipIdentity) {
    return { accessToken, expiresInSeconds }
  }

  return {
    accessToken,
    expiresInSeconds,
    identity: await fetchBoxServiceAccountIdentity(accessToken, fields.orgId),
  }
}
