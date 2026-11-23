import { normalizeHttpBaseUrl } from '@/lib/core/security/input-validation'
import {
  postToConfiguredTokenEndpoint,
  readAccessTokenResponse,
} from '@/lib/credentials/client-credentials-grant'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import type {
  TokenClientCredentialFields,
  TokenClientCredentialMint,
} from '@/lib/credentials/token-service-accounts/client-credentials'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const STEP = 'infisical_universal_auth_login'
/**
 * Infisical access tokens default to a 30-day TTL, and an identity's tokens can be revoked before
 * then, so the shared token is replaced daily; a shorter `expiresIn` is honored as reported. An
 * `expiresIn` of 0 (an access token TTL of 0, which the attach API accepts) is kept for this long
 * too: Universal Auth uses 0 for "never expires" on its client secret TTL.
 *
 * @see https://infisical.com/docs/api-reference/endpoints/universal-auth/attach
 * @see https://infisical.com/docs/documentation/platform/identities/universal-auth
 */
const SERVED_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

/** The instance origin the login and every tool call use, exactly as the token check stores it. */
function instanceBaseUrl(domain: string | undefined): string {
  try {
    return normalizeHttpBaseUrl(domain)
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      reason: 'instance URL is not a valid http(s) URL',
    })
  }
}

async function loginWithUniversalAuth(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresAt: Date }> {
  const startedAt = Date.now()
  const response = await postToConfiguredTokenEndpoint({
    url: `${baseUrl}/api/v1/auth/universal-auth/login`,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
    step: STEP,
    signal,
  })
  return readAccessTokenResponse(response, {
    step: STEP,
    label: 'Infisical login response',
    startedAt,
    maxLifetimeSeconds: SERVED_TOKEN_LIFETIME_SECONDS,
    tokenField: 'accessToken',
    expiresInField: 'expiresIn',
    zeroLifetimeMeansNoExpiry: true,
    signal,
  })
}

/**
 * Logs a machine identity in with Universal Auth (its client ID and secret) on the credential's
 * instance, US or EU Cloud or self-hosted, so a saved credential no longer depends on a pasted
 * access token that expires. Each login issues a new access token and spends one use of a client
 * secret that has a usage limit, so every saved credential for one identity on one instance shares
 * a single coordinated token instead of logging in per worker.
 *
 * @see https://infisical.com/docs/api-reference/endpoints/universal-auth/login
 * @see https://infisical.com/docs/documentation/platform/identities/universal-auth
 */
export async function mintInfisicalUniversalAuthToken(
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
): Promise<TokenClientCredentialMint> {
  options?.signal?.throwIfAborted()
  const baseUrl = instanceBaseUrl(fields.domain)
  const clientId = fields.clientId.trim()
  if (!clientId || !fields.clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'client ID and client secret are required',
    })
  }
  return resolveCoordinatedClientToken({
    namespace: 'infisical',
    application: [baseUrl, clientId],
    clientSecret: fields.clientSecret,
    step: STEP,
    exchange: (signal) => loginWithUniversalAuth(baseUrl, clientId, fields.clientSecret, signal),
    signal: options?.signal,
  })
}
