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
 * Extracts a string message from an unknown caught value.
 * Use instead of `e instanceof Error ? e.message : 'fallback'` in catch clauses.
 *
 * - Error instance → `error.message`
 * - Non-empty string → the string itself (handles `throw 'msg'` patterns)
 * - Otherwise → `fallback` if provided, or `String(value)`
 */
export function getErrorMessage(value: unknown, fallback?: string): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.length > 0) return value
  return fallback ?? String(value)
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

export interface DescribedError {
  name: string
  message: string
  code?: string
  errno?: string
  syscall?: string
  /** `"Name: message"` per link in the `.cause` chain, outermost first. Present only when the chain has more than one link. */
  causeChain?: string[]
}

/**
 * Always-on diagnostic view of an error and its `.cause` chain.
 *
 * Reports the fields of the DEEPEST `.cause` link, because a wrapped driver
 * error (e.g. Drizzle's `"Failed query: ..."` wrapping an `ECONNRESET`) carries
 * the real reason there, not on the outer wrapper. Always returns a populated
 * object — including for non-`Error` throws and unclassified errors like
 * `AbortError`. Cycle-safe and depth-bounded.
 *
 * Loggers do not serialize the non-enumerable `Error.prototype.cause`, so pass
 * the result as an explicit structured field rather than the raw error.
 */
export function describeError(error: unknown): DescribedError {
  const chain: Error[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current instanceof Error && !seen.has(current) && chain.length < 10) {
    seen.add(current)
    chain.push(current)
    current = current.cause
  }

  if (chain.length === 0) {
    const normalized = toError(error)
    return { name: normalized.name, message: normalized.message }
  }

  const deepest = chain[chain.length - 1] as Error & Record<string, unknown>
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined
  const code = asString(deepest.code)
  const errno = asString(deepest.errno)
  const syscall = asString(deepest.syscall)

  return {
    name: deepest.name,
    message: deepest.message,
    ...(code ? { code } : {}),
    ...(errno ? { errno } : {}),
    ...(syscall ? { syscall } : {}),
    ...(chain.length > 1 ? { causeChain: chain.map((e) => `${e.name}: ${e.message}`) } : {}),
  }
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
