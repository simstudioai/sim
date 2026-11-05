import { createLogger } from '@sim/logger'
import { classifyDatabaseFailure, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { type BackoffOptions, backoffWithJitter } from '@sim/utils/retry'

const logger = createLogger('DatabaseReadRetry')

const TRANSIENT_READ_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '40001',
  '40P01',
  '55P03',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
])

/** A read exhausted its budget before its query could begin. */
export class DatabaseReadDeadlineError extends Error {
  readonly code = 'DATABASE_READ_DEADLINE_EXCEEDED' as const

  constructor() {
    super('Database read deadline exceeded')
    this.name = 'DatabaseReadDeadlineError'
  }
}

/** Only driver codes identify retryable reads; query cancellation and application errors propagate. */
export function isTransientDatabaseReadError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && TRANSIENT_READ_CODES.has(code)
}

interface DatabaseRetryOptions {
  label?: string
  maxAttempts?: number
  maxElapsedMs?: number
  /** Pacing between attempts. The default suits a blip; a longer budget can outlast a burst. */
  backoff?: BackoffOptions
}

const DEFAULT_RETRY_BACKOFF: BackoffOptions = { baseMs: 100, maxMs: 500 }

async function retryDatabaseOperation<T>(
  operation: (remainingMs?: number) => Promise<T>,
  kind: 'read' | 'write',
  isRetryable: (error: unknown) => boolean,
  options: DatabaseRetryOptions
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const deadline =
    options.maxElapsedMs === undefined ? undefined : Date.now() + options.maxElapsedMs
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error('Read attempts must be positive')
  if (
    options.maxElapsedMs !== undefined &&
    (!Number.isFinite(options.maxElapsedMs) || options.maxElapsedMs <= 0)
  ) {
    throw new Error('Read budget must be positive')
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(
        deadline === undefined ? undefined : Math.max(1, deadline - Date.now())
      )
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error
      const delay = backoffWithJitter(attempt, null, options.backoff ?? DEFAULT_RETRY_BACKOFF)
      if (deadline !== undefined && Date.now() + delay >= deadline) throw error
      logger.warn(`Retrying transient database ${kind}`, {
        label: options.label,
        attempt,
        code: getPostgresErrorCode(error),
      })
      await sleep(delay)
      if (deadline !== undefined && Date.now() >= deadline) throw error
    }
  }
}

/**
 * Retries independent reads, rebuilding each statement or fresh read-only transaction
 * after the previous attempt has fully rolled back. Never retry writes, locking reads,
 * or statements inside a caller-owned transaction.
 *
 * `maxElapsedMs` bounds retry admission, including backoff. The callback receives the
 * remaining budget and must enforce it at the database to bound an in-flight statement.
 */
export function withDatabaseReadRetry<T>(
  read: (remainingMs?: number) => Promise<T>,
  options: DatabaseRetryOptions = {}
): Promise<T> {
  return retryDatabaseOperation(read, 'read', isTransientDatabaseReadError, options)
}

/**
 * Repeats a write whose database connection was lost. A lost connection leaves the outcome
 * unknown, because the commit may have landed before the reset, so the write must leave the same
 * state however many times it applies: use this only for a write that sets fixed values under a
 * guard, never one that increments, appends, or fires an effect from inside its transaction.
 *
 * Only a lost connection qualifies. Lock timeouts, deadlocks, and capacity errors mean the database
 * answered and is contended, and holding a worker through backoff there adds to the contention.
 */
export function withIdempotentWriteRetry<T>(
  write: () => Promise<T>,
  options: DatabaseRetryOptions = {}
): Promise<T> {
  return retryDatabaseOperation(
    write,
    'write',
    (error) => classifyDatabaseFailure(error) === 'connection',
    options
  )
}
