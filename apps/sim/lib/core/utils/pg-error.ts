/**
 * Returns PostgreSQL error code (e.g. `23505` for unique_violation) when present on a thrown value.
 * Normalizes common Drizzle / `postgres` driver shapes.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }

  const err = error as Error & { code?: string }
  if (typeof err.code === 'string') {
    return err.code
  }

  const cause = err.cause
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return cause.code
  }

  return undefined
}
