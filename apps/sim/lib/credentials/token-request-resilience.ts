import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

/**
 * How a failed token request is retried:
 * - `permanent`: the provider refused the credentials or the account (or the failure is not a
 *   provider answer at all); asking again cannot help until the secret changes.
 * - `throttled`: a 429, or a 503 with a `Retry-After`; the provider is rate limiting the caller.
 * - `transient`: any other outage (5xx, timeout, network failure, malformed token response).
 */
export type TokenRequestFailureKind = 'permanent' | 'throttled' | 'transient'

export interface TokenRequestFailure {
  kind: TokenRequestFailureKind
  /** Failures of this kind in a row, this one included; 1 for a permanent failure. */
  consecutiveFailures: number
  /** How long the failure is replayed before the provider is asked again. */
  replayMs: number
}

/**
 * A token with less than this left is treated as expired and never served, so clock skew and a
 * call already in flight cannot carry it past its expiry.
 */
export const TOKEN_EXPIRY_MARGIN_MS = 30_000

/**
 * How long a remembered failure outlives its replay, so the next failure continues the streak
 * and backs off longer. A failure after a quieter gap starts a new streak.
 */
export const TOKEN_FAILURE_STREAK_RETENTION_MS = 5 * 60_000

/** A refusal of the credentials is replayed this long, so a revoked secret does not hammer the provider. */
const PERMANENT_FAILURE_REPLAY_MS = 30_000
/**
 * A provider's `Retry-After` is honored for at most five minutes. Microsoft Entra ID, the most
 * explicit documented case, throttles client-credentials token requests with `Retry-After: 60`;
 * five minutes leaves room for per-minute provider windows while a proxy or a misbehaving provider
 * answering with hours cannot lock every workflow on an application out for that long.
 */
const RETRY_AFTER_BOUNDS = { baseMs: 1_000, maxMs: 5 * 60_000 } as const
/**
 * A throttled answer that names no `Retry-After` is replayed for at least a minute, doubling while
 * throttling continues, up to the five-minute `Retry-After` cap. Token endpoints document their
 * limits per minute (Vanta: 5 tokens and 25 token requests a minute), so asking again sooner lands
 * in the window that was just exhausted.
 */
const THROTTLED_BACKOFF = { baseMs: 60_000, maxMs: RETRY_AFTER_BOUNDS.maxMs } as const
/**
 * An outage is retried no sooner than 5 s after it (Entra's resilience guidance: without a
 * `Retry-After`, the first back-off retry at least 5 s after the response), doubling with jitter
 * while it continues, up to 30 s: the flat replay every failure used to get, so no outage is
 * replayed longer than before.
 */
const OUTAGE_BACKOFF = { baseMs: 5_000, maxMs: 30_000 } as const
/** The pause before the one in-request retry: MSAL's documented one-second retry-once. */
const IN_REQUEST_RETRY_DELAY = { baseMs: 1_000, maxMs: 1_000 } as const
/**
 * A failed attempt is retried only when it failed this quickly. A timed-out attempt (10 s) is
 * never retried in-request, and a retried exchange holding a coordinated application lock stays
 * within the 15 s its waiters allow: 2 s, the 1.2 s pause, and one more 10 s attempt.
 */
const IN_REQUEST_RETRY_BUDGET_MS = 2_000

/** Whether a token request failure with this code is a refusal that asking again cannot fix. */
export function isPermanentTokenFailureCode(code: string): boolean {
  return code !== 'provider_unavailable'
}

/** Classifies a failed token request; see {@link TokenRequestFailureKind}. */
function classifyTokenRequestFailure(error: unknown): TokenRequestFailureKind {
  if (!(error instanceof TokenServiceAccountValidationError)) return 'permanent'
  if (isPermanentTokenFailureCode(error.code)) return 'permanent'
  return error.status === 429 || (error.status === 503 && error.retryAfterMs !== undefined)
    ? 'throttled'
    : 'transient'
}

/** Exponential backoff with ±20% jitter, kept within `bounds` so jitter never undercuts the floor. */
function boundedBackoff(attempt: number, bounds: { baseMs: number; maxMs: number }): number {
  return Math.min(Math.max(backoffWithJitter(attempt, null, bounds), bounds.baseMs), bounds.maxMs)
}

/**
 * Decides how long a failed token request is replayed. A remembered failure another layer is
 * replaying (`replayForMs`) is replayed exactly as long as that layer still does. Otherwise a
 * provider's `Retry-After` is honored within 1 s to 5 min; without one, a throttled answer backs
 * off from 1 min to 5 min, an outage from 5 s to 30 s, and a refusal is replayed 30 s.
 * `previous` is the remembered failure immediately before this one, if any: the backoff grows only
 * while failures of the same kind continue, so a throttled answer after an outage starts its own
 * streak at a minute instead of inheriting the outage's count.
 */
export function assessTokenRequestFailure(
  error: unknown,
  previous?: Pick<TokenRequestFailure, 'kind' | 'consecutiveFailures'>
): TokenRequestFailure {
  const kind = classifyTokenRequestFailure(error)
  const consecutiveFailures =
    kind !== 'permanent' && previous?.kind === kind ? previous.consecutiveFailures + 1 : 1
  const replay = (replayMs: number): TokenRequestFailure => ({
    kind,
    consecutiveFailures,
    replayMs,
  })
  if (error instanceof TokenServiceAccountValidationError) {
    if (error.replayForMs !== undefined) return replay(Math.max(error.replayForMs, 0))
    if (error.retryAfterMs !== undefined && kind !== 'permanent') {
      return replay(backoffWithJitter(1, error.retryAfterMs, RETRY_AFTER_BOUNDS))
    }
  }
  if (kind === 'permanent') return replay(PERMANENT_FAILURE_REPLAY_MS)
  if (kind === 'throttled') return replay(boundedBackoff(consecutiveFailures, THROTTLED_BACKOFF))
  return replay(boundedBackoff(consecutiveFailures, OUTAGE_BACKOFF))
}

/**
 * Runs a token request, retrying a transient failure once after about a second when the failed
 * attempt was quick (see {@link IN_REQUEST_RETRY_BUDGET_MS}). Throttled and permanent failures,
 * and an aborted `signal`, are never retried.
 */
export async function requestTokenWithRetry<T>(
  request: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await request()
  } catch (error) {
    signal?.throwIfAborted()
    if (
      classifyTokenRequestFailure(error) !== 'transient' ||
      Date.now() - startedAt > IN_REQUEST_RETRY_BUDGET_MS
    ) {
      throw error
    }
    await interruptibleSleep(backoffWithJitter(1, null, IN_REQUEST_RETRY_DELAY), signal)
    signal?.throwIfAborted()
    return request()
  }
}
