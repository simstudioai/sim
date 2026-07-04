/**
 * Error thrown when caller-supplied filter or sort input is malformed.
 * Routes should map this to HTTP 400 with the message preserved.
 *
 * Lives outside `sql.ts` so client-bundled modules (the block definitions pull
 * in the PostgREST serializers) can reference it without dragging drizzle-orm
 * into the browser chunk.
 */
export class TableQueryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableQueryValidationError'
  }
}
