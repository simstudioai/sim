import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
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
 * Linear documents a 30-day lifetime for client-credentials tokens, but a token can also be
 * revoked early (cleanup, another scope request) without every API answer saying so with a 401, so
 * the shared token is replaced daily. Same-scope tokens coexist, so the replacement leaves the
 * previous token valid for calls already using it.
 */
const SERVED_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

async function exchangeLinearToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresAt: Date }> {
  const startedAt = Date.now()
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
        client_secret: clientSecret,
        scope: LINEAR_CLIENT_CREDENTIAL_SCOPE,
      }).toString(),
      redirect: 'error',
      cache: 'no-store',
      signal,
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
      step: STEP,
      reason: 'provider returned an invalid token response',
    })
  }
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(
      startedAt + Math.min(payload.expires_in, SERVED_TOKEN_LIFETIME_SECONDS) * 1000
    ),
  }
}

/**
 * Mints an app-actor token for a Linear OAuth app with client credentials turned on. Linear asks
 * clients to reuse one token and to request a new one after a 401, and cleans up an app's surplus
 * tokens past 1,000 per workspace, so every saved credential for one app shares a single
 * coordinated token, replaced daily. A token Linear rejects early with a 401 is expired by the
 * tool-call path and replaced on the next call; a rotated secret never matches the stored token.
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
  return resolveCoordinatedClientToken({
    namespace: 'linear',
    application: [clientId],
    clientSecret: fields.clientSecret,
    step: STEP,
    exchange: (signal) => exchangeLinearToken(clientId, fields.clientSecret, signal),
    signal: options?.signal,
  })
}
