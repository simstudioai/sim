import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

/**
 * How a failed token request is retried:
 * - `permanent`: the provider refused the credentials or the account (or the failure is not a
 *   provider answer at all); asking again cannot help until the secret changes.
 * - `throttled`: a 429, or an outage with a `Retry-After`; the provider said when to come back.
 * - `transient`: any other outage (5xx, timeout, network failure, malformed token response).
 */
export type TokenRequestFailureKind = 'permanent' | 'throttled' | 'transient'

export interface TokenRequestFailure {
  kind: TokenRequestFailureKind
  /** Non-permanent failures in a row, this one included; 1 for a permanent failure. */
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
 * An outage is retried after 5 s at first (Entra's resilience guidance: the first back-off retry at
 * least 5 s after the response), doubling while it continues, up to 30 s: the flat replay every
 * failure used to get, so no outage is replayed longer than before.
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

/** Classifies a failed token request; see {@link TokenRequestFailureKind}. */
export function classifyTokenRequestFailure(error: unknown): TokenRequestFailureKind {
  if (!(error instanceof TokenServiceAccountValidationError)) return 'permanent'
  if (error.code !== 'provider_unavailable') return 'permanent'
  return error.status === 429 || error.retryAfterMs !== undefined ? 'throttled' : 'transient'
}

/**
 * Decides how long a failed token request is replayed. A failure carrying `retryAfterMs` (the
 * provider's `Retry-After`, or what remains of a replay another layer already decided) is replayed
 * that long within 1 s to 5 min. Otherwise a permanent failure is replayed 30 s and an outage backs
 * off from 5 s to 30 s with jitter as it continues. `previousConsecutiveFailures` counts the
 * non-permanent failures immediately before this one (0 after a success or a permanent failure).
 */
export function assessTokenRequestFailure(
  error: unknown,
  previousConsecutiveFailures = 0
): TokenRequestFailure {
  const kind = classifyTokenRequestFailure(error)
  const consecutiveFailures = kind === 'permanent' ? 1 : previousConsecutiveFailures + 1
  const retryAfterMs =
    error instanceof TokenServiceAccountValidationError ? error.retryAfterMs : undefined
  if (retryAfterMs !== undefined) {
    return {
      kind,
      consecutiveFailures,
      replayMs: backoffWithJitter(1, retryAfterMs, RETRY_AFTER_BOUNDS),
    }
  }
  if (kind === 'permanent') {
    return { kind, consecutiveFailures, replayMs: PERMANENT_FAILURE_REPLAY_MS }
  }
  return {
    kind,
    consecutiveFailures,
    replayMs: Math.min(
      backoffWithJitter(consecutiveFailures, null, OUTAGE_BACKOFF),
      OUTAGE_BACKOFF.maxMs
    ),
  }
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
