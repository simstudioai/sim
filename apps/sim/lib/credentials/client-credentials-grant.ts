import { isRecordLike } from '@sim/utils/object'
import { EgressRefusedError } from '@/lib/core/network/transport.server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { PayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  type FetchProviderOptions,
  fetchProvider,
  isHostNotFound,
  type ProviderResponse,
  providerFailureCode,
  providerFailureReason,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throttledRetryAfterMs,
} from '@/lib/credentials/token-service-accounts/errors'

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
/** The guarded fetch refuses a larger declared body outright; JSON reads stay capped at {@link MAX_TOKEN_RESPONSE_BYTES}. */
const MAX_CONFIGURED_ENDPOINT_RESPONSE_BYTES = 1024 * 1024
const CONFIGURED_ENDPOINT_TIMEOUT_MS = 10_000
/** Form fields the grant itself sets, which an extra field may never replace. */
const RESERVED_GRANT_FIELDS = ['grant_type', 'client_id', 'client_secret'] as const

interface ClientCredentialsGrantFields {
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
  /**
   * Maps a refused exchange to a provider-specific error. Without it, a refusal is
   * `invalid_credentials` for a non-transient 4xx and `provider_unavailable` otherwise.
   * `retryAfterMs` is the refusal's `Retry-After` (see {@link throttledRetryAfterMs}), which an
   * error the provider would answer differently later should carry.
   */
  classifyRefusal?: (
    status: number,
    body: string,
    retryAfterMs: number | undefined
  ) => TokenServiceAccountValidationError
  signal?: AbortSignal
}

/**
 * One OAuth 2.0 client-credentials token request to a fixed or validated token endpoint. With
 * `egress: 'configuredEndpoint'`, for a URL on a host the admin configured rather than a fixed
 * provider host, the request goes through {@link postToConfiguredTokenEndpoint}, which takes no
 * `fetchOptions`.
 */
export type ClientCredentialsGrantRequest = ClientCredentialsGrantFields &
  (
    | { egress?: undefined; fetchOptions?: FetchProviderOptions }
    | { egress: 'configuredEndpoint'; fetchOptions?: never }
  )

/**
 * Exchanges client credentials for an access token: a form POST of `grant_type=client_credentials`
 * with the client ID and secret in the body, redirects refused so the secret reaches no other host.
 * A response without a non-blank `access_token` and a positive integer `expires_in` is
 * `provider_unavailable`, and the token expires `min(expires_in, maxLifetimeSeconds)` after the
 * request started. A throttled or unavailable refusal carries its `Retry-After` as `retryAfterMs`.
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
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: request.clientId,
    client_secret: request.clientSecret,
    ...extraFields,
  }).toString()
  const response: ProviderResponse =
    request.egress === 'configuredEndpoint'
      ? await postToConfiguredTokenEndpoint({ url: request.url, headers, body, step, signal })
      : await fetchProvider(
          request.url,
          { method: 'POST', headers, body, cache: 'no-store', signal },
          step,
          request.fetchOptions
        )
  return readAccessTokenResponse(response, {
    step,
    label: request.label,
    startedAt,
    maxLifetimeSeconds: request.maxLifetimeSeconds,
    classifyRefusal: request.classifyRefusal,
    signal,
  })
}

/** How {@link readAccessTokenResponse} reads one provider's token response. */
interface AccessTokenResponseOptions {
  /** The validation step named in errors and logs. */
  step: string
  /** Names the provider's token response in a body-limit error. */
  label: string
  /** When the token request was sent; the token's lifetime counts from here. */
  startedAt: number
  /** The longest a token is kept, whatever lifetime the provider reports. */
  maxLifetimeSeconds: number
  /** The field holding the token, `access_token` unless the provider names it otherwise. */
  tokenField?: string
  /** The field holding the lifetime in seconds, `expires_in` unless the provider names it otherwise. */
  expiresInField?: string
  /**
   * Whether a lifetime of 0 means the provider set no expiry, so the token is kept for
   * {@link maxLifetimeSeconds}. Otherwise a lifetime of 0 is an invalid response.
   */
  zeroLifetimeMeansNoExpiry?: boolean
  /**
   * Maps a refusal to a provider-specific error, as the grant's own `classifyRefusal` does.
   * Without it, a refusal is `invalid_credentials` for a non-transient 4xx and
   * `provider_unavailable` otherwise.
   */
  classifyRefusal?: ClientCredentialsGrantFields['classifyRefusal']
  signal?: AbortSignal
}

/**
 * Reads a token endpoint's response: a refusal is classified from its status, and a response
 * without a non-blank token and a non-negative integer lifetime (positive unless
 * {@link AccessTokenResponseOptions.zeroLifetimeMeansNoExpiry}) is `provider_unavailable`. The
 * token expires `min(lifetime, maxLifetimeSeconds)` after the request started.
 */
export async function readAccessTokenResponse(
  response: ProviderResponse,
  options: AccessTokenResponseOptions
): Promise<{ accessToken: string; expiresAt: Date }> {
  const { step, signal } = options
  if (!response.ok) {
    const body = await readProviderErrorSnippet(response)
    signal?.throwIfAborted()
    const retryAfterMs = throttledRetryAfterMs(response)
    throw options.classifyRefusal
      ? options.classifyRefusal(response.status, body, retryAfterMs)
      : new TokenServiceAccountValidationError(
          providerFailureCode(response.status),
          response.status,
          { step, body },
          { retryAfterMs }
        )
  }
  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_TOKEN_RESPONSE_BYTES,
      label: options.label,
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
  const token = isRecordLike(payload) ? payload[options.tokenField ?? 'access_token'] : undefined
  const lifetime = isRecordLike(payload)
    ? payload[options.expiresInField ?? 'expires_in']
    : undefined
  const minimumLifetime = options.zeroLifetimeMeansNoExpiry ? 0 : 1
  if (
    typeof token !== 'string' ||
    !token.trim() ||
    typeof lifetime !== 'number' ||
    !Number.isSafeInteger(lifetime) ||
    lifetime < minimumLifetime
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'provider returned an invalid token response',
    })
  }
  const lifetimeSeconds =
    lifetime === 0 ? options.maxLifetimeSeconds : Math.min(lifetime, options.maxLifetimeSeconds)
  return {
    accessToken: token,
    expiresAt: new Date(options.startedAt + lifetimeSeconds * 1000),
  }
}

/** A token request to an endpoint on a host the admin configured (a self-hosted or per-tenant instance). */
export interface ConfiguredTokenEndpointRequest {
  url: string
  headers: Record<string, string>
  body: string
  /** The validation step named in errors and logs. */
  step: string
  signal?: AbortSignal
}

/**
 * Posts a token request to a host taken from a validated credential field rather than a constant,
 * through the `configuredEndpoint` egress guard: private and loopback addresses are refused and the
 * connection is pinned to the checked address, redirects are refused so the secret reaches no other
 * host, and the response is size-capped. A host the policy refuses is `host_not_allowed`, one that
 * does not resolve is `site_not_found`, and any other network failure is `provider_unavailable`;
 * the caller classifies the response itself.
 */
export async function postToConfiguredTokenEndpoint(
  request: ConfiguredTokenEndpointRequest
): Promise<ProviderResponse & { json(): Promise<unknown> }> {
  const { step, signal } = request
  try {
    return await secureFetchWithValidation(request.url, {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal,
      timeout: CONFIGURED_ENDPOINT_TIMEOUT_MS,
      maxRedirects: 0,
      maxResponseBytes: MAX_CONFIGURED_ENDPOINT_RESPONSE_BYTES,
      logUrlValidationDetails: false,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof EgressRefusedError) {
      throw new TokenServiceAccountValidationError('host_not_allowed', 400, {
        step,
        reason: 'token endpoint host not allowed',
      })
    }
    const notFound = isHostNotFound(error)
    throw new TokenServiceAccountValidationError(
      notFound ? 'site_not_found' : 'provider_unavailable',
      notFound ? 400 : 502,
      { step, reason: notFound ? 'host does not resolve' : 'network error reaching provider' }
    )
  }
}
