import { getErrorMessage } from '@sim/utils/errors'
import { parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'

/**
 * Discrete validation failure codes returned to the client for token
 * service-account credentials. The UI maps each code to a human message; raw
 * provider response bodies stay in server logs.
 */
export type TokenServiceAccountValidationCode =
  | 'invalid_credentials'
  | 'permission_conflict'
  | 'site_not_found'
  /** The egress policy refused the typed host (a private address, or plain http). */
  | 'host_not_allowed'
  | 'provider_unavailable'
  /** The provider requires a one-time user consent before it issues tokens (DocuSign JWT Grant). */
  | 'consent_required'
  /** The credential authenticated, but the account it pins is not one its user belongs to. */
  | 'account_not_found'
  /**
   * The credential works, but not for this service or option: a keyless Google Cloud credential
   * asked for a Google Workspace service or to impersonate a Google Workspace user (domain-wide delegation).
   */
  | 'unsupported_use'
  /**
   * The credential signs in to a different cloud instance than the one this service calls: a
   * US Government or China Microsoft app credential picked for a tool that calls the global cloud.
   */
  | 'cloud_mismatch'
  /**
   * The provider refused this grant for the account the credential names, although the client
   * itself may be valid: Shopify answers `shop_not_permitted` when the app and the store are not
   * in the same Shopify organization.
   */
  | 'grant_not_permitted'

export interface TokenServiceAccountValidationErrorOptions {
  /** See {@link TokenServiceAccountValidationError.retryAfterMs}. */
  retryAfterMs?: number
  /** See {@link TokenServiceAccountValidationError.replayForMs}. */
  replayForMs?: number
}

export class TokenServiceAccountValidationError extends Error {
  /**
   * The provider's `Retry-After` on a 429 or 503 answer, in milliseconds, uncapped as the provider
   * sent it. Absent when the provider named none. Only ever set from a provider's own answer.
   */
  public readonly retryAfterMs?: number

  /**
   * Set when this is a remembered failure being replayed rather than a fresh provider answer: how
   * much longer, in milliseconds, it is replayed before the provider is asked again. It says when
   * the provider will next be asked, not that asking will then succeed (a replayed refusal of the
   * credentials carries it too).
   */
  public readonly replayForMs?: number

  constructor(
    public readonly code: TokenServiceAccountValidationCode,
    public readonly status: number,
    public readonly logDetail?: Record<string, unknown>,
    options: TokenServiceAccountValidationErrorOptions = {}
  ) {
    super(code)
    this.name = 'TokenServiceAccountValidationError'
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
    if (options.replayForMs !== undefined) this.replayForMs = options.replayForMs
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

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const CONTROL_CHARACTERS_OR_SPACE = /[\u0000- \u007f]/

/**
 * Refuses a credential value that is empty, longer than `maxBytes` in UTF-8, or holds a control
 * character (and, with `forbidSpaces`, a space), any of which would corrupt or be cut from the
 * header the value is sent in, as `invalid_credentials` naming the field.
 */
export function assertCredentialText(
  value: string,
  label: string,
  step: string,
  options: { maxBytes: number; forbidSpaces?: boolean }
): void {
  const forbidden = options.forbidSpaces ? CONTROL_CHARACTERS_OR_SPACE : CONTROL_CHARACTERS
  if (!value || forbidden.test(value) || Buffer.byteLength(value, 'utf8') > options.maxBytes) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step,
      reason: `${label} is invalid`,
    })
  }
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

/**
 * The shared split for a failed provider call: a non-transient 4xx is the
 * caller's input being wrong; anything else (5xx, 408/429, or a reply that
 * wasn't an error status but still failed) is the provider.
 */
export function providerFailureCode(
  status: number
): Extract<TokenServiceAccountValidationCode, 'invalid_credentials' | 'provider_unavailable'> {
  return status >= 400 && status < 500 && !isTransientProviderStatus(status)
    ? 'invalid_credentials'
    : 'provider_unavailable'
}

/**
 * The `Retry-After` of a 429 (RFC 6585) or 503 (RFC 9110 section 15.6.4) answer in milliseconds,
 * as delay-seconds or an HTTP-date (RFC 9110 section 10.2.3); `undefined` for any other status or
 * a missing or unparsable header. Uncapped: the caller that waits decides how long is too long.
 */
export function throttledRetryAfterMs(response: ProviderResponse): number | undefined {
  if (response.status !== 429 && response.status !== 503) return undefined
  return parseRetryAfter(response.headers.get('retry-after'), Number.POSITIVE_INFINITY) ?? undefined
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

const PROVIDER_FETCH_TIMEOUT_MS = 10_000

/**
 * Whether a failed request proves the host doesn't exist (`ENOTFOUND`). Node's fetch
 * puts the resolver code on `cause`, Bun's on the error itself; the transient
 * `EAI_AGAIN` is not a missing host.
 */
export function isHostNotFound(error: unknown): boolean {
  const failure = error as { code?: unknown; cause?: { code?: unknown } } | undefined
  return failure?.code === 'ENOTFOUND' || failure?.cause?.code === 'ENOTFOUND'
}

/**
 * Fetches a provider verification endpoint, mapping network-level failures
 * (DNS, TLS, connection reset) to `provider_unavailable` so they never escape
 * as raw undici errors — whose `cause` can carry connection details — and are
 * never blamed on the pasted token. DNS-resolution failures can optionally be
 * mapped to a different code via {@link FetchProviderOptions}.
 *
 * Redirects are refused (`redirect: 'error'`) unless `init` names another mode:
 * every caller sends a secret, and fetch replays custom headers and 307/308
 * bodies to whatever host a redirect names. A refused redirect is a network
 * failure, so it surfaces as `provider_unavailable`.
 */
export async function fetchProvider(
  url: string,
  init: RequestInit,
  step: string,
  options?: FetchProviderOptions
): Promise<Response> {
  try {
    const timeout = AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return await fetch(url, { ...init, redirect: init.redirect ?? 'error', signal })
  } catch (error) {
    init.signal?.throwIfAborted()
    // Only ENOTFOUND proves the host doesn't exist; EAI_AGAIN is a transient
    // resolver failure and stays provider_unavailable.
    if (options?.dnsFailureCode && isHostNotFound(error)) {
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
export async function parseProviderJson<T>(
  res: { json(): Promise<unknown> },
  step: string
): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'provider returned a non-JSON response body',
    })
  }
}

/** The parts of a provider response the checks read; both `fetch` and the guarded egress fetch return them. */
export interface ProviderResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}

/** Whether a 403 is the vendor's own JSON answer; an HTML one is a firewall or CDN page. */
export function isVendorJsonForbidden(response: ProviderResponse): boolean {
  return (
    response.status === 403 &&
    (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
  )
}

/**
 * Reads a bounded snippet of a provider error body for server logs. Never
 * throws — an unreadable body logs as an empty string.
 */
export async function readProviderErrorSnippet(res: ProviderResponse): Promise<string> {
  try {
    // Bounded: a provider or proxy can answer with an arbitrarily large error body.
    const text = await readResponseTextWithLimit(res, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'provider error response',
    })
    return truncate(text, ERROR_SNIPPET_MAX_LENGTH)
  } catch {
    return ''
  }
}

/**
 * Maps a failed provider verification response to the standard error split:
 * every 4xx except the transient ones is the caller's input being wrong
 * (`invalid_credentials`), and only 5xx or a transient 4xx means the provider
 * couldn't be reached or misbehaved (`provider_unavailable`).
 *
 * The 4xx half matters beyond message accuracy. `provider_unavailable` renders
 * as `503 + Retry-After`, which tells a conforming client to come back — so
 * classifying a permanently-wrong `domain`, `orgId`, or `clientId` as an outage
 * makes it retry forever. A 4xx that is not 408/429 is by definition something
 * the caller must change, so it is answered as a caller error and never
 * advertises a retry. A 429 or 503 carries its `Retry-After` as `retryAfterMs`.
 *
 * `invalid_credentials` covers the whole non-transient 4xx range rather than
 * splitting further: telling a rejected token apart from a wrong host takes
 * provider-specific knowledge, and the providers that have it (Shopify,
 * Snowflake, Atlassian) already raise `site_not_found` before reaching here.
 */
export async function throwForProviderResponse(
  res: ProviderResponse,
  step: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  if (res.ok) return
  const body = await readProviderErrorSnippet(res)
  throw new TokenServiceAccountValidationError(
    providerFailureCode(res.status),
    res.status,
    { step, body, ...context },
    { retryAfterMs: throttledRetryAfterMs(res) }
  )
}
