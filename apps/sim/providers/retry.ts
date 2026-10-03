/**
 * Retry policy for provider calls that no vendor SDK retries for us: the raw-fetch
 * Responses path and SDKs whose own retry is unusable.
 *
 * It mirrors what `openai`, `@anthropic-ai/sdk`, and the AI SDK agree on, so a model
 * behaves the same whichever transport serves it: {@link PROVIDER_MAX_RETRIES} replays,
 * jittered exponential backoff, the server's `x-should-retry` and `retry-after-ms` /
 * `retry-after` obeyed, and a caller's abort never retried. Only the wait for response
 * headers is covered — once a body is streaming, nothing is replayed.
 *
 * Two deliberate divergences, both so a block's fallback model runs instead of waiting on
 * a failure that will not clear: a 429 reporting an exhausted balance is not retried, and
 * neither is a failure whose requested delay exceeds {@link MAX_RETRY_AFTER_MS}.
 *
 * @packageDocumentation
 */

import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import { isQuotaExhaustionBody } from '@/lib/core/errors/provider-quota'
import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { PROVIDER_MAX_RETRIES } from '@/providers/transport'

/**
 * The longest server-requested delay waited out before a replay. A longer one — a daily
 * quota, a provider-wide pause — outlasts the retry budget, so the failure surfaces at once.
 * Matches the backoff ceiling.
 */
const MAX_RETRY_AFTER_MS = 30_000

/**
 * How long a 429's body may take to arrive for quota classification. A real error body comes
 * with the headers; one that stalls past this is treated as an ordinary rate limit.
 */
const QUOTA_BODY_READ_TIMEOUT_MS = 5_000

/** Bun's `fetch` rejects with an `Error` carrying one of these codes when no response arrived. */
const BUN_CONNECTION_ERROR_CODES = new Set(['ConnectionRefused', 'ConnectionClosed'])

export interface ProviderRetryOptions {
  logger: Logger
  /** Provider name for the retry log line. */
  label: string
  abortSignal?: AbortSignal
  /** The delay an SDK error asks for, for SDKs that carry it in the error rather than headers. */
  retryAfterMs?: (error: unknown) => number | null
}

/** Statuses every vendor SDK treats as transient: timeout, lock conflict, rate limit, server fault. */
export function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

/** The server's requested delay: OpenAI's precise `retry-after-ms`, then standard `retry-after`. */
export function providerRetryAfterMs(headers: Headers): number | null {
  const precise = Number.parseFloat(headers.get('retry-after-ms') ?? '')
  if (Number.isFinite(precise) && precise >= 0) return precise
  return parseRetryAfter(headers.get('retry-after'), Number.POSITIVE_INFINITY)
}

/** Whether a requested delay is short enough to wait out; no delay means backoff decides. */
export function isWithinRetryWindow(retryAfterMs: number | null): boolean {
  return retryAfterMs === null || retryAfterMs <= MAX_RETRY_AFTER_MS
}

/**
 * A request that never got a response, recognised by its socket error code rather than its
 * message: Node rejects with `TypeError('fetch failed')` carrying the code on its `cause`,
 * Bun with an `Error` carrying it directly. An error with no such code — a `TypeError` from
 * a malformed request, say — is not a network fault, and a replay cannot fix it.
 */
function isRetryableTransportFailure(error: unknown): boolean {
  const code = isRecordLike(error) ? error.code : undefined
  if (typeof code === 'string' && BUN_CONNECTION_ERROR_CODES.has(code)) return true
  return isRetryableNetworkError(error)
}

/**
 * The response to hand back when a failed one must not be replayed, or `null` to replay it.
 *
 * Telling a spent balance from a rate limit means reading a 429's body. It is read
 * directly, bounded in size and time and under the caller's signal, and a 429 that is not
 * replayed comes back rebuilt from that text. A `clone()` would tee the stream, and cancelling one branch
 * of a tee settles only once the other is cancelled too — an oversized body would hang.
 */
async function nonRetryableResponse(
  response: Response,
  abortSignal: AbortSignal | undefined
): Promise<Response | null> {
  const directive = response.headers.get('x-should-retry')
  if (directive === 'false') return response
  if (directive !== 'true' && !isRetryableProviderStatus(response.status)) return response
  if (!isWithinRetryWindow(providerRetryAfterMs(response.headers))) return response
  if (directive === 'true' || response.status !== 429) return null

  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), QUOTA_BODY_READ_TIMEOUT_MS)
  let body: string
  try {
    body = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'provider error response',
      signal: abortSignal ? AbortSignal.any([abortSignal, deadline.signal]) : deadline.signal,
    })
  } catch {
    abortSignal?.throwIfAborted()
    /** An unreadable, oversized, or stalled body cannot be a quota error; it stays a rate limit. */
    return null
  } finally {
    clearTimeout(timer)
  }
  if (!isQuotaExhaustionBody(body)) return null
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function waitBeforeRetry(
  attempt: number,
  retryAfterMs: number | null,
  failure: Record<string, unknown>,
  { logger, label, abortSignal }: ProviderRetryOptions
): Promise<void> {
  const delayMs = backoffWithJitter(attempt, retryAfterMs)
  logger.warn(`${label} request failed; retrying`, {
    ...failure,
    attempt,
    maxRetries: PROVIDER_MAX_RETRIES,
    delayMs: Math.round(delayMs),
  })
  await interruptibleSleep(delayMs, abortSignal)
  abortSignal?.throwIfAborted()
}

/** Bounded, so an SDK that folds the whole error body into its message cannot flood the log. */
function describeError(error: unknown): string {
  return truncate(getErrorMessage(error), 200)
}

/**
 * Sends a raw-fetch provider request, replaying it on a transient failure.
 *
 * Resolves with the final response — successful, not retryable, or out of retries — so
 * the caller reads and reports its body exactly as it would a single attempt's. Rejects
 * only with the last transport failure.
 */
export async function fetchWithProviderRetry(
  send: () => Promise<Response>,
  options: ProviderRetryOptions
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const canRetry = attempt <= PROVIDER_MAX_RETRIES
    let response: Response
    try {
      response = await send()
    } catch (error) {
      if (!canRetry || options.abortSignal?.aborted || !isRetryableTransportFailure(error)) {
        throw error
      }
      await waitBeforeRetry(attempt, null, { error: describeError(error) }, options)
      continue
    }
    if (response.ok || !canRetry) return response
    const final = await nonRetryableResponse(response, options.abortSignal)
    if (final) return final
    /** Cancelled, not drained, as the SDKs do: draining a body that stalls would hang the loop. */
    if (!response.bodyUsed) await response.body?.cancel().catch(() => {})
    await waitBeforeRetry(
      attempt,
      providerRetryAfterMs(response.headers),
      { status: response.status, requestId: response.headers.get('x-request-id') },
      options
    )
  }
}

/**
 * Runs a vendor SDK call, replaying it when it rejects with a transient HTTP status or a
 * dropped connection. For SDKs that raise non-OK responses as errors carrying `status`.
 */
export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  options: ProviderRetryOptions
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const status = isRecordLike(error) && typeof error.status === 'number' ? error.status : null
      const retryable =
        status === null ? isRetryableTransportFailure(error) : isRetryableProviderStatus(status)
      const retryAfterMs = options.retryAfterMs?.(error) ?? null
      if (
        attempt > PROVIDER_MAX_RETRIES ||
        options.abortSignal?.aborted ||
        !retryable ||
        !isWithinRetryWindow(retryAfterMs)
      ) {
        throw error
      }
      await waitBeforeRetry(attempt, retryAfterMs, { status, error: describeError(error) }, options)
    }
  }
}
