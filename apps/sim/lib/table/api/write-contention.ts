import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason, getPostgresErrorCode } from '@sim/utils/errors'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'
import { isTableLockRace, TablePartialWriteError } from '@/lib/table/errors'

const logger = createLogger('TableWriteContention')

export const TABLE_WRITE_CONTENTION_MESSAGE =
  'Table is busy with other writes. Try again in a few seconds.'

export const TABLE_WRITE_CONTENTION_RETRY_AFTER_SECONDS = ADMISSION_RETRY_AFTER_SECONDS

/**
 * Whether a table operation failed because its transaction lost a lock race, which callers should
 * answer with a retryable 503 rather than a generic 500.
 *
 * Every row write locks its table's `user_table_definitions` row (the `row_count` and
 * `rows_version` triggers, the latter at COMMIT), so a transaction that holds it longer than the
 * table's 3 s `lock_timeout` — typically one stuck waiting on a synchronous standby, which keeps its
 * locks — fails the writers queued behind it. Those writers rolled back, so retrying them is safe.
 * A batched write that had already committed part of its work is a {@link TablePartialWriteError}
 * instead, and is not retryable as a whole.
 *
 * Logs the failure, because route builders do not log errors their policy projects. Only the
 * SQLSTATE is logged: the driver's message carries the query's bound parameters.
 */
export function isTableWriteContention(error: unknown): boolean {
  if (error instanceof TablePartialWriteError || !isTableLockRace(error)) return false
  logger.warn('Table operation lost a lock race', {
    sqlstate: getPostgresErrorCode(error),
    reason: getPostgresCancellationReason(error) ?? null,
  })
  return true
}
