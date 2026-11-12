import { isRecordLike } from '@sim/utils/object'
import { PayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  type FetchProviderOptions,
  fetchProvider,
  providerFailureCode,
  providerFailureReason,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
/** Form fields the grant itself sets, which an extra field may never replace. */
const RESERVED_GRANT_FIELDS = ['grant_type', 'client_id', 'client_secret'] as const

/** One OAuth 2.0 client-credentials token request to a fixed or validated token endpoint. */
export interface ClientCredentialsGrantRequest {
  /** The token endpoint, from a constant or a host the caller already validated. */
  url: string
  clientId: string
  clientSecret: string
  /**
   * Form fields sent after the client credentials, such as a fixed `scope`. A field named
   * `grant_type`, `client_id`, or `client_secret` is refused, so the grant always sends its own.
   */
  extraFields?: Record<string, string>
  /** The validation step named in errors and logs. */
  step: string
  /** Names the provider's token response in a body-limit error. */
  label: string
  /** The longest a token is kept, whatever `expires_in` the provider reports. */
  maxLifetimeSeconds: number
  fetchOptions?: FetchProviderOptions
  /**
   * Maps a refused exchange to a provider-specific error. Without it, a refusal is
   * `invalid_credentials` for a non-transient 4xx and `provider_unavailable` otherwise.
   */
  classifyRefusal?: (status: number, body: string) => TokenServiceAccountValidationError
  signal?: AbortSignal
}

/**
 * Exchanges client credentials for an access token: a form POST of `grant_type=client_credentials`
 * with the client ID and secret in the body, redirects refused so the secret reaches no other host.
 * A response without a non-blank `access_token` and a positive integer `expires_in` is
 * `provider_unavailable`, and the token expires `min(expires_in, maxLifetimeSeconds)` after the
 * request started.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.4
 */
export async function exchangeClientCredentialsGrant(
  request: ClientCredentialsGrantRequest
): Promise<{ accessToken: string; expiresAt: Date }> {
  const { step, signal } = request
  const extraFields = request.extraFields ?? {}
  const replaced = RESERVED_GRANT_FIELDS.find((field) => Object.hasOwn(extraFields, field))
  if (replaced) throw new Error(`An extra field cannot replace the grant's ${replaced}`)
  const startedAt = Date.now()
  const response = await fetchProvider(
    request.url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: request.clientId,
        client_secret: request.clientSecret,
        ...extraFields,
      }).toString(),
      cache: 'no-store',
      signal,
    },
    step,
    request.fetchOptions
  )
  if (!response.ok) {
    const body = await readProviderErrorSnippet(response)
    signal?.throwIfAborted()
    throw request.classifyRefusal
      ? request.classifyRefusal(response.status, body)
      : new TokenServiceAccountValidationError(
          providerFailureCode(response.status),
          response.status,
          { step, body }
        )
  }
  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_TOKEN_RESPONSE_BYTES,
      label: request.label,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (!(error instanceof SyntaxError || error instanceof PayloadSizeLimitError)) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step,
        reason: `reading the token response failed: ${providerFailureReason(error)}`,
      })
    }
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
      step,
      reason: 'provider returned an invalid token response',
    })
  }
  const lifetimeSeconds = Math.min(payload.expires_in, request.maxLifetimeSeconds)
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(startedAt + lifetimeSeconds * 1000),
  }
}
