import type { OracleWorkerStatementResult } from '@/lib/internal/oracledb/worker-protocol'

export const ORACLE_MAX_RESULT_ROWS = 10_000
export const ORACLE_MAX_RESULT_BYTES = 10 * 1024 * 1024
const ORACLE_RESPONSE_ENVELOPE_BYTES = 4096
const ORACLE_MAX_ROWS_BYTES = ORACLE_MAX_RESULT_BYTES - ORACLE_RESPONSE_ENVELOPE_BYTES

export interface OracleQueryResult {
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated?: boolean
  truncationReason?: string
}

/** Applies a second, Bun-side response budget to the worker's normalized rows. */
export function capOracleResult(result: OracleWorkerStatementResult): OracleQueryResult {
  const rows: Array<Record<string, unknown>> = []
  let bytes = 1

  for (const row of result.rows) {
    if (rows.length >= ORACLE_MAX_RESULT_ROWS) break
    const serialized = JSON.stringify(row)
    const rowBytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes + rowBytes + 1 > ORACLE_MAX_ROWS_BYTES) break
    bytes += rowBytes + 1
    rows.push(row)
  }

  const locallyTruncated = rows.length < result.rows.length
  const truncated = locallyTruncated || result.truncated === true
  const rowCount = result.rows.length > 0 ? rows.length : result.rowCount
  let truncationReason = result.truncationReason

  if (locallyTruncated) {
    truncationReason =
      rows.length === 0
        ? 'No rows returned: the first row alone exceeds the 10 MiB response ceiling. Select fewer columns or slice large values in SQL.'
        : `Result truncated to ${rows.length} row(s): one statement returns at most 10,000 rows or 10 MiB. Add Oracle OFFSET/FETCH pagination to read the rest.`
  }

  return {
    rows,
    rowCount,
    ...(truncated && { truncated: true, truncationReason }),
  }
}

export function toOracleRowsResponseBody(result: OracleQueryResult, message: string) {
  return {
    message: result.truncationReason ? `${message} ${result.truncationReason}` : message,
    rows: result.rows,
    rowCount: result.rowCount,
    ...(result.truncated && {
      truncated: true,
      truncationReason: result.truncationReason,
    }),
  }
}
