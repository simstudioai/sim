import { getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** `lock_not_available` (a `lock_timeout` fired) and `deadlock_detected`. */
const LOCK_RACE_SQLSTATES = new Set(['55P03', '40P01'])

/** Whether a table write's transaction failed because it lost a lock race, and so rolled back. */
export function isTableLockRace(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && LOCK_RACE_SQLSTATES.has(code)
}

/**
 * A write that commits batch by batch lost a lock race after at least one batch committed. Unlike
 * a single rolled-back transaction it is not retryable as a whole: a re-run selects its rows again,
 * so a limited filtered delete would remove more than its limit.
 */
export class TablePartialWriteError extends Error {
  constructor(
    readonly committedCount: number,
    cause: unknown
  ) {
    super(`Table write failed after ${committedCount} rows were committed`, { cause })
    this.name = 'TablePartialWriteError'
  }
}

/** A disabled TTL feature, distinct from malformed column input. */
export class TableRowTtlDisabledError extends OrchestrationError {
  readonly detailCode = 'TABLE_ROW_TTL_DISABLED'

  constructor() {
    super('validation', 'Expiration columns are not enabled')
    this.name = 'TableRowTtlDisabledError'
  }
}

/**
 * Stable, machine-readable codes for table query failures. SDKs and clients
 * branch on these instead of string-matching human-facing messages.
 */
export type TableQueryErrorCode =
  | 'TABLE_QUERY_RESULT_TOO_LARGE'
  | 'INVALID_CURSOR'
  | 'CURSOR_SORT_CONFLICT'
  | 'CURSOR_FILTER_CONFLICT'
  | 'INVALID_FILTER'
  | 'INVALID_ORDER'

/**
 * Error thrown when caller-supplied filter or sort input is malformed.
 * Routes should map this to HTTP 400 with the message preserved.
 *
 * Lives outside `sql.ts` so client-bundled modules (the block definitions pull
 * in the query-builder converters) can reference it without dragging drizzle-orm
 * into the browser chunk.
 */
export class TableQueryValidationError extends Error {
  readonly code?: TableQueryErrorCode

  constructor(message: string, code?: TableQueryErrorCode) {
    super(message)
    this.name = 'TableQueryValidationError'
    this.code = code
  }
}
