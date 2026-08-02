/**
 * Stable, machine-readable codes for table query failures. SDKs and clients
 * branch on these instead of string-matching human-facing messages.
 */
export type TableQueryErrorCode =
  | 'TABLE_QUERY_RESULT_TOO_LARGE'
  | 'INVALID_CURSOR'
  | 'CURSOR_SORT_CONFLICT'
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

/**
 * Error thrown when a column mutation fails for a reason the CALLER can fix —
 * a name collision, an unsupported conversion, metadata on a type that does not
 * own it, a column or table that does not exist.
 *
 * Carries its own HTTP status so routes map it directly. This replaced a list
 * of `msg.includes('already exists') || msg.includes('option') || …` in every
 * route: that list had to be extended for each new message, and any message it
 * did not happen to contain — the metadata-ownership error among them — fell
 * through to a 500, telling the caller the server broke when in fact their
 * request was invalid.
 */
export class TableColumnError extends Error {
  /** 400 for an invalid request, 404 for a missing table or column. */
  readonly status: 400 | 404

  constructor(message: string, status: 400 | 404 = 400) {
    super(message)
    this.name = 'TableColumnError'
    this.status = status
  }
}

/** Shorthand for the 404 half, which is the only non-400 case. */
export function tableColumnNotFound(message: string): TableColumnError {
  return new TableColumnError(message, 404)
}
