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
 * in the PostgREST serializers) can reference it without dragging drizzle-orm
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
