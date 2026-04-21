/**
 * Normalizes an unknown caught value into an Error instance.
 * Replaces the common `e instanceof Error ? e : new Error(String(e))` pattern in catch clauses.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  return new Error(String(value))
}

/**
 * Returns PostgreSQL error code (e.g. `23505` for unique_violation) when present on a thrown value.
 * Normalizes common Drizzle / `postgres` driver shapes and walks `cause` chains.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  return readPgErrorField(error, 'code')
}

/**
 * Returns the name of the PostgreSQL constraint that triggered the error (e.g. the unique index
 * name on a `23505`), when present on a thrown value. Mirrors the field populated by the
 * `postgres` / `pg` drivers, walking `cause` chains the same way as `getPostgresErrorCode`.
 */
export function getPostgresConstraintName(error: unknown): string | undefined {
  return readPgErrorField(error, 'constraint_name') ?? readPgErrorField(error, 'constraint')
}

function readPgErrorField(error: unknown, field: string): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null) {
    if (seen.has(current)) {
      break
    }
    seen.add(current)

    if (typeof current === 'object') {
      const value = (current as Record<string, unknown>)[field]
      if (typeof value === 'string') {
        return value
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
