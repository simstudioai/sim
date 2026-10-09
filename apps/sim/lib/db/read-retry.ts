import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

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

/**
 * Retries independent reads, rebuilding each statement or fresh read-only transaction
 * after the previous attempt has fully rolled back. Never retry writes, locking reads,
 * or statements inside a caller-owned transaction.
 *
 * `maxElapsedMs` bounds retry admission, including backoff. The callback receives the
 * remaining budget and must enforce it at the database to bound an in-flight statement.
 */
export async function withDatabaseReadRetry<T>(
  read: (remainingMs?: number) => Promise<T>,
  options: { label?: string; maxAttempts?: number; maxElapsedMs?: number } = {}
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
      return await read(deadline === undefined ? undefined : Math.max(1, deadline - Date.now()))
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientDatabaseReadError(error)) throw error
      const delay = backoffWithJitter(attempt, null, { baseMs: 100, maxMs: 500 })
      if (deadline !== undefined && Date.now() + delay >= deadline) throw error
      logger.warn('Retrying transient database read', {
        label: options.label,
        attempt,
        code: getPostgresErrorCode(error),
      })
      await sleep(delay)
      if (deadline !== undefined && Date.now() >= deadline) throw error
    }
  }
}
