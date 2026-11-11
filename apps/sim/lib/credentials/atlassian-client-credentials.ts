import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import {
  fetchProvider,
  providerFailureCode,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const MINT_STEP = 'atlassian_token_mint'
/** Atlassian documents a 60-minute access token for service-account OAuth credentials. */
const MAX_TOKEN_LIFETIME_SECONDS = 3600

async function exchangeAtlassianToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresAt: Date }> {
  const startedAt = Date.now()
  const response = await fetchProvider(
    ATLASSIAN_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      redirect: 'error',
      cache: 'no-store',
      signal,
    },
    MINT_STEP
  )
  if (!response.ok) {
    const body = await readProviderErrorSnippet(response)
    throw new TokenServiceAccountValidationError(
      providerFailureCode(response.status),
      response.status,
      {
        step: MINT_STEP,
        body,
      }
    )
  }
  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: 64 * 1024,
      label: 'Atlassian token response',
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    payload = undefined
  }
  if (
    !isRecordLike(payload) ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim() ||
    typeof payload.expires_in !== 'number' ||
    !Number.isSafeInteger(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: MINT_STEP,
      reason: 'provider returned an invalid token response',
    })
  }
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(
      startedAt + Math.min(payload.expires_in, MAX_TOKEN_LIFETIME_SECONDS) * 1000
    ),
  }
}

/**
 * Mints a bearer token for an Atlassian service account's OAuth 2.0 credential through the
 * client-credentials grant. The token is used exactly like a scoped API token, through
 * `api.atlassian.com/ex/{product}/{cloudId}`. Atlassian documents these credentials for the Jira
 * and Confluence REST APIs (not Jira Service Management, which shares Jira's credentials here),
 * and does not document whether a new token retires earlier ones, so every saved credential for
 * one OAuth client shares a single coordinated token instead of minting per worker.
 *
 * @see https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/
 */
export async function mintAtlassianServiceAccountToken(
  clientId: string,
  clientSecret: string,
  options?: { signal?: AbortSignal }
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  if (!clientId || !clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: MINT_STEP,
      reason: 'client ID and client secret are required',
    })
  }
  return resolveCoordinatedClientToken({
    namespace: 'atlassian',
    application: [clientId],
    clientSecret,
    step: MINT_STEP,
    exchange: (signal) => exchangeAtlassianToken(clientId, clientSecret, signal),
    signal: options?.signal,
  })
}
