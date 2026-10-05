import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason, getPostgresErrorCode } from '@sim/utils/errors'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'

const logger = createLogger('TableWriteContention')

/** `lock_not_available` (a `lock_timeout` fired) and `deadlock_detected`. */
const WRITE_CONTENTION_SQLSTATES = new Set(['55P03', '40P01'])

export const TABLE_WRITE_CONTENTION_MESSAGE =
  'Table is busy with other writes. Try again in a few seconds.'

export const TABLE_WRITE_CONTENTION_RETRY_AFTER_SECONDS = ADMISSION_RETRY_AFTER_SECONDS

/**
 * Whether a table operation failed because its transaction lost a lock race, which callers should
 * answer with a retryable 503 instead of a generic 500.
 *
 * Every row write locks its table's `user_table_definitions` row (the `row_count` and
 * `rows_version` triggers, the latter at COMMIT), so a transaction that holds it longer than the
 * table's 3 s `lock_timeout` — typically one stuck waiting on a synchronous standby, which keeps its
 * locks — fails the writers queued behind it. The failed transaction rolled back. A bulk write that
 * commits page by page may have applied earlier pages, but every such write re-applies the same
 * patch or filter, so retrying it is safe.
 *
 * Logs the failure, because route builders do not log errors their policy projects. Only the
 * SQLSTATE is logged: the driver's message carries the query's bound parameters.
 */
export function isTableWriteContention(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  if (!code || !WRITE_CONTENTION_SQLSTATES.has(code)) return false
  logger.warn('Table operation lost a lock race', {
    sqlstate: code,
    reason: getPostgresCancellationReason(error) ?? null,
  })
  return true
}
