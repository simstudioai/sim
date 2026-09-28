import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { isQuotaExhaustionBody } from '@/lib/core/errors/provider-quota'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import {
  consumeOrCancelBody,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { PROVIDER_MAX_RETRIES } from '@/providers/transport'

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
 * One deliberate divergence: a 429 reporting an exhausted balance is not retried. The
 * SDKs replay it, but a spent account does not reopen within a backoff window.
 */

export interface ProviderRetryOptions {
  logger: Logger
  /** Provider name for the retry log line. */
  label: string
  abortSignal?: AbortSignal
}

/** Statuses every vendor SDK treats as transient: timeout, lock conflict, rate limit, server fault. */
export function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

/** The server's requested delay: OpenAI's precise `retry-after-ms`, then standard `retry-after`. */
export function providerRetryAfterMs(headers: Headers): number | null {
  const precise = Number.parseFloat(headers.get('retry-after-ms') ?? '')
  if (Number.isFinite(precise) && precise >= 0) return precise
  return parseRetryAfter(headers.get('retry-after'))
}

/**
 * A dropped or refused connection: Node's `fetch` raises a `TypeError`, Bun's an `Error`
 * carrying the syscall code.
 */
function isRetryableTransportFailure(error: unknown): boolean {
  return error instanceof TypeError || isRetryableInfrastructureError(error)
}

/** Reads a clone, so the caller can still read the body of a response that is not retried. */
async function isQuotaExhaustedResponse(response: Response): Promise<boolean> {
  const body = await readResponseTextWithLimit(response.clone(), {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'provider error response',
  }).catch(() => '')
  return isQuotaExhaustionBody(body)
}

async function shouldRetryResponse(response: Response): Promise<boolean> {
  const directive = response.headers.get('x-should-retry')
  if (directive === 'true') return true
  if (directive === 'false') return false
  if (!isRetryableProviderStatus(response.status)) return false
  return response.status !== 429 || !(await isQuotaExhaustedResponse(response))
}

async function waitBeforeRetry(
  attempt: number,
  retryAfterMs: number | null,
  reason: string,
  { logger, label, abortSignal }: ProviderRetryOptions
): Promise<void> {
  const delayMs = backoffWithJitter(attempt, retryAfterMs)
  logger.warn(`${label} request failed (${reason}); retrying`, {
    attempt,
    maxRetries: PROVIDER_MAX_RETRIES,
    delayMs: Math.round(delayMs),
  })
  await interruptibleSleep(delayMs, abortSignal)
  abortSignal?.throwIfAborted()
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
      await waitBeforeRetry(attempt, null, getErrorMessage(error), options)
      continue
    }
    if (response.ok || !canRetry || !(await shouldRetryResponse(response))) return response
    await consumeOrCancelBody(response)
    await waitBeforeRetry(
      attempt,
      providerRetryAfterMs(response.headers),
      `HTTP ${response.status}`,
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
      if (attempt > PROVIDER_MAX_RETRIES || options.abortSignal?.aborted || !retryable) {
        throw error
      }
      await waitBeforeRetry(attempt, null, getErrorMessage(error), options)
    }
  }
}
