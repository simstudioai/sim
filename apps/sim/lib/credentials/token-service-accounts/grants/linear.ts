import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  TokenClientCredentialFields,
  TokenClientCredentialMint,
} from '@/lib/credentials/token-service-accounts/client-credentials'
import {
  fetchProvider,
  providerFailureCode,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
const STEP = 'linear_token_mint'
/**
 * Every Sim credential requests exactly these scopes: Linear replaces an app's existing
 * client-credentials tokens in a workspace when a request asks for different scopes, so two
 * credentials for one app must never disagree. They match the scopes Linear's tools use.
 */
const LINEAR_CLIENT_CREDENTIAL_SCOPE = 'read,write'
/**
 * Linear tokens last 30 days and cannot be refreshed, but a token revoked early (a secret
 * rotation, or another scope request) answers 401 until it is replaced, so a minted token is
 * reused for at most an hour before a fresh one is requested.
 */
const MAX_REUSE_SECONDS = 3600

/**
 * Mints an app-actor token for a Linear OAuth app with client credentials turned on. Tokens
 * with the same scopes coexist, so each worker may hold its own.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication
 */
export async function mintLinearClientCredentialsToken(
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
): Promise<TokenClientCredentialMint> {
  options?.signal?.throwIfAborted()
  const clientId = fields.clientId.trim()
  if (!clientId || !fields.clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'client ID and client secret are required',
    })
  }
  const response = await fetchProvider(
    LINEAR_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: fields.clientSecret,
        scope: LINEAR_CLIENT_CREDENTIAL_SCOPE,
      }).toString(),
      redirect: 'error',
      cache: 'no-store',
      signal: options?.signal,
    },
    STEP
  )
  if (!response.ok) {
    const body = await readProviderErrorSnippet(response)
    throw new TokenServiceAccountValidationError(
      providerFailureCode(response.status),
      response.status,
      { step: STEP, body }
    )
  }
  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: 64 * 1024,
      label: 'Linear token response',
      signal: options?.signal,
    })
  } catch {
    options?.signal?.throwIfAborted()
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
      step: STEP,
      reason: 'provider returned an invalid token response',
    })
  }
  return {
    accessToken: payload.access_token,
    expiresInSeconds: Math.min(payload.expires_in, MAX_REUSE_SECONDS),
  }
}
