import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'

/**
 * Discrete validation failure codes returned to the client for token
 * service-account credentials. The UI maps each code to a human message; raw
 * provider response bodies stay in server logs.
 */
export type TokenServiceAccountValidationCode =
  | 'invalid_credentials'
  | 'site_not_found'
  | 'provider_unavailable'

export class TokenServiceAccountValidationError extends Error {
  constructor(
    public readonly code: TokenServiceAccountValidationCode,
    public readonly status: number,
    public readonly logDetail?: Record<string, unknown>
  ) {
    super(code)
    this.name = 'TokenServiceAccountValidationError'
  }
}

const ERROR_SNIPPET_MAX_LENGTH = 500

/**
 * Narrows the optional `clientSecret` for the single-grant client-credential
 * providers that always require one. `ClientCredentialAccountFields` makes it
 * optional for the key-based grants (Salesforce JWT bearer), so providers with
 * no such branch re-state the invariant here. The secret builder's
 * required-field check already rejects a missing value at connect time; this
 * fails loudly rather than posting `client_secret=undefined` if a future
 * caller ever bypasses it.
 */
export function requireClientSecret(
  clientSecret: string | undefined,
  step: string,
  serviceLabel: string
): string {
  if (!clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step,
      reason: `${serviceLabel} requires a client secret`,
    })
  }
  return clientSecret
}

/**
 * Short, stable description of a failed best-effort provider call, for callers
 * that degrade instead of throwing. `TokenServiceAccountValidationError`'s
 * message is only its code, so the status is appended to keep the reason
 * diagnosable.
 */
export function providerFailureReason(error: unknown): string {
  if (error instanceof TokenServiceAccountValidationError) {
    return `${error.code} (HTTP ${error.status})`
  }
  return getErrorMessage(error, 'request failed')
}

/**
 * Transient statuses a provider token/verification endpoint can return that
 * say nothing about the submitted credentials (throttling, request timeout) —
 * they must map to `provider_unavailable`, never `invalid_credentials`.
 */
export function isTransientProviderStatus(status: number): boolean {
  return status === 408 || status === 429
}

export interface FetchProviderOptions {
  /**
   * Validation code thrown when the host does not resolve (`ENOTFOUND` only —
   * the transient `EAI_AGAIN` stays `provider_unavailable`). For user-supplied
   * hosts (e.g. a Salesforce My Domain), a non-resolving host means the pasted
   * host is wrong — not that the provider is down — so callers map it to
   * `site_not_found`.
   */
  dnsFailureCode?: TokenServiceAccountValidationCode
  /** Log-detail reason accompanying a DNS-resolution failure. */
  dnsFailureReason?: string
}

/**
 * Fetches a provider verification endpoint, mapping network-level failures
 * (DNS, TLS, connection reset) to `provider_unavailable` so they never escape
 * as raw undici errors — whose `cause` can carry connection details — and are
 * never blamed on the pasted token. DNS-resolution failures can optionally be
 * mapped to a different code via {@link FetchProviderOptions}.
 */
const PROVIDER_FETCH_TIMEOUT_MS = 10_000

export async function fetchProvider(
  url: string,
  init: RequestInit,
  step: string,
  options?: FetchProviderOptions
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS) })
  } catch (error) {
    const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code
    // Only ENOTFOUND proves the host doesn't exist; EAI_AGAIN is a transient
    // resolver failure and stays provider_unavailable.
    if (options?.dnsFailureCode && causeCode === 'ENOTFOUND') {
      throw new TokenServiceAccountValidationError(options.dnsFailureCode, 400, {
        step,
        reason: options.dnsFailureReason ?? 'host does not resolve',
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'network error reaching provider',
    })
  }
}

/**
 * Parses a provider response body as JSON, mapping malformed bodies (proxy
 * error pages, truncated responses) to `provider_unavailable` instead of an
 * unhandled SyntaxError that would surface as a generic 500.
 */
export async function parseProviderJson<T>(res: Response, step: string): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'provider returned a non-JSON response body',
    })
  }
}

/**
 * Reads a bounded snippet of a provider error body for server logs. Never
 * throws — an unreadable body logs as an empty string.
 */
export async function readProviderErrorSnippet(res: Response): Promise<string> {
  try {
    return truncate(await res.text(), ERROR_SNIPPET_MAX_LENGTH)
  } catch {
    return ''
  }
}

/**
 * Maps a failed provider verification response to the standard error split:
 * 401/403 mean the pasted token was rejected (`invalid_credentials`), anything
 * else non-2xx means the provider couldn't be reached or misbehaved
 * (`provider_unavailable`) — never blame the token for a provider outage.
 */
export async function throwForProviderResponse(
  res: Response,
  step: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  if (res.ok) return
  const body = await readProviderErrorSnippet(res)
  if (res.status === 401 || res.status === 403) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step,
      body,
      ...context,
    })
  }
  throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
    step,
    body,
    ...context,
  })
}
