/**
 * Returns PostgreSQL error code (e.g. `23505` for unique_violation) when present on a thrown value.
 * Normalizes common Drizzle / `postgres` driver shapes and walks `cause` chains.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null) {
    if (seen.has(current)) {
      break
    }
    seen.add(current)

    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string') {
        return code
      }
    }

    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause
      continue
    }

    break
  }

  return undefined
}
