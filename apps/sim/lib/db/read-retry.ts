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

/** Only driver codes identify retryable reads; query cancellation and application errors propagate. */
export function isTransientDatabaseReadError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && TRANSIENT_READ_CODES.has(code)
}

/**
 * Retries an independent, read-only statement at most three times. The callback must
 * rebuild the query outside any transaction and must have no side effects or locks.
 * A failed connection cannot establish whether a write committed, so writes and
 * transactions must never use this helper.
 */
export async function withDatabaseReadRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read()
    } catch (error) {
      if (attempt >= 3 || !isTransientDatabaseReadError(error)) throw error
      logger.warn('Retrying transient database read', {
        attempt,
        code: getPostgresErrorCode(error),
      })
      await sleep(backoffWithJitter(attempt, null, { baseMs: 100, maxMs: 500 }))
    }
  }
}
