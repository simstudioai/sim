import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
  providerFailureReason,
  readProviderErrorSnippet,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const logger = createLogger('BoxServiceAccountMinter')

const IDENTITY_STEP = 'box_identity'

const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token'
const BOX_CURRENT_USER_URL = 'https://api.box.com/2.0/users/me'

interface BoxTokenResponse {
  access_token?: string
  expires_in?: number
}

/**
 * `id`, `name`, and `login` are all in the standard field set `GET /2.0/users/me`
 * returns without a `fields` parameter, so capturing the Service Account's user
 * id costs no extra request.
 * @see https://developer.box.com/reference/get-users-me/
 */
interface BoxCurrentUserResponse {
  id?: string
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
 * never fails the mint — the credential degrades to an Enterprise-ID-derived
 * display name with a `lookup_failed` principal, so the audit record shows the
 * identity was not captured rather than implying none exists.
 */
async function fetchBoxServiceAccountIdentity(
  accessToken: string,
  orgId: string
): Promise<ClientCredentialAccountIdentity> {
  /**
   * `label` keeps whatever human name the lookup did return. A response can
   * carry `name`/`login` but no `id` — the principal is then unusable, but the
   * label still beats the Enterprise-ID fallback, so only the principal
   * degrades and the credential does not silently lose its name.
   */
  const degraded = (reason: string, label?: string): ClientCredentialAccountIdentity => ({
    displayName: label ?? `Box enterprise ${orgId}`,
    principal: { kind: 'lookup_failed', reason },
    auditMetadata: { boxEnterpriseId: orgId },
    storedMetadata: { enterpriseId: orgId },
  })
  try {
    const res = await fetchProvider(
      BOX_CURRENT_USER_URL,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      IDENTITY_STEP
    )
    if (!res.ok) {
      logger.warn('Box service-account identity lookup failed', {
        step: IDENTITY_STEP,
        status: res.status,
        enterpriseId: orgId,
      })
      return degraded(`HTTP ${res.status}`)
    }
    const user = await parseProviderJson<BoxCurrentUserResponse>(res, IDENTITY_STEP)
    const id = typeof user.id === 'string' && user.id ? user.id : undefined
    const login = typeof user.login === 'string' && user.login ? user.login : undefined
    const name = typeof user.name === 'string' && user.name ? user.name : undefined
    if (!id) {
      logger.warn('Box service-account identity response carried no user id', {
        step: IDENTITY_STEP,
        status: res.status,
        enterpriseId: orgId,
      })
      return degraded('response missing user id', name ?? login)
    }
    return {
      displayName: name ?? login ?? `Box enterprise ${orgId}`,
      // The Service Account is a real Box user; `enterpriseId` is shared by
      // every app in the enterprise and so is kept as separate context.
      principal: { kind: 'user', id, ...(login ? { label: login } : {}) },
      auditMetadata: { boxEnterpriseId: orgId },
      storedMetadata: { enterpriseId: orgId },
    }
  } catch (error) {
    logger.warn('Box service-account identity lookup threw', {
      step: IDENTITY_STEP,
      enterpriseId: orgId,
      error: getErrorMessage(error),
    })
    return degraded(providerFailureReason(error))
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
  const clientSecret = requireClientSecret(fields.clientSecret, 'box_token_mint', 'Box')
  const res = await fetchProvider(
    BOX_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: clientSecret,
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
