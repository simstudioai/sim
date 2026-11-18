/** Maximum inline tool response size; binary file outputs use stored descriptors. */
export const MAX_TOOL_RESPONSE_BODY_BYTES = 10 * 1024 * 1024

/** Most rows a single database statement returns inline. */
const MAX_TOOL_RESULT_ROWS = 10_000

/**
 * Bytes the serialized rows array may occupy: the response ceiling minus a reserve for the
 * envelope around it (`message`, counts, `truncated`, `truncationReason`).
 */
const MAX_TOOL_RESULT_ROWS_BYTES = MAX_TOOL_RESPONSE_BODY_BYTES - 4096

/**
 * Admits rows into a tool response until the row or UTF-8 byte ceiling is reached. Each row is
 * serialized once, the way the response will serialize it, and one byte per row covers the array
 * punctuation. A row that does not fit is refused even when it is the first, so one huge value
 * cannot bypass the ceiling.
 */
export function createResultRowsBudget() {
  let admitted = 0
  let bytes = 1
  return {
    admit(row: unknown): boolean {
      if (admitted >= MAX_TOOL_RESULT_ROWS) return false
      const serialized = JSON.stringify(row)
      const rowBytes = serialized === undefined ? 4 : Buffer.byteLength(serialized, 'utf8')
      if (bytes + rowBytes + 1 > MAX_TOOL_RESULT_ROWS_BYTES) return false
      bytes += rowBytes + 1
      admitted++
      return true
    },
  }
}

/** Keeps the leading rows that fit {@link createResultRowsBudget}. */
export function capResultRows<TRow>(rows: readonly TRow[]): { rows: TRow[]; truncated: boolean } {
  const budget = createResultRowsBudget()
  const capped: TRow[] = []
  for (const row of rows) {
    if (!budget.admit(row)) break
    capped.push(row)
  }
  return { rows: capped, truncated: capped.length < rows.length }
}

/** Tells the caller which ceiling truncated a result and how to read the rest. */
export function resultTruncationReason(returned: number, paginationHint: string): string {
  return returned === 0
    ? 'No rows returned: the first row alone exceeds the 10 MiB response ceiling. Select fewer columns or slice large values.'
    : `Result truncated to ${returned} row(s): one statement returns at most ${MAX_TOOL_RESULT_ROWS.toLocaleString('en-US')} rows or 10 MiB. ${paginationHint}`
}

/** A capped statement result: rows as returned, plus the truncation notice when rows were dropped. */
export interface CappedRowsResult {
  rows: unknown[]
  rowCount: number
  truncated?: true
  truncationReason?: string
}

/** Caps a statement's rows; `rowCount` stays what the statement returned or affected. */
export function capStatementRows(
  rows: readonly unknown[],
  rowCount: number,
  paginationHint: string
): CappedRowsResult {
  const capped = capResultRows(rows)
  if (!capped.truncated) return { rows: capped.rows, rowCount }
  return {
    rows: capped.rows,
    rowCount,
    truncated: true,
    truncationReason: resultTruncationReason(capped.rows.length, paginationHint),
  }
}

/** The response body for a capped statement, surfacing any truncation in the message too. */
export function toRowsResponseBody(result: CappedRowsResult, message: string) {
  return {
    message: result.truncationReason ? `${message} ${result.truncationReason}` : message,
    rows: result.rows,
    rowCount: result.rowCount,
    ...(result.truncated && { truncated: true, truncationReason: result.truncationReason }),
  }
}
