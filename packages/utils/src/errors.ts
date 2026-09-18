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

const POSTGRES_CANCELLATION_REASONS = [
  ['57014', 'canceling statement due to statement timeout', 'statement_timeout'],
  ['57014', 'canceling statement due to user request', 'user_cancel'],
  ['40001', 'canceling statement due to conflict with recovery', 'recovery_conflict'],
  ['55P03', 'canceling statement due to lock timeout', 'lock_timeout'],
  ['25P04', 'terminating connection due to transaction timeout', 'transaction_timeout'],
  ['40P01', 'deadlock detected', 'deadlock'],
] as const

export type PostgresCancellationReason = (typeof POSTGRES_CANCELLATION_REASONS)[number][2]

/** Identifies known cancellations without exposing SQL, driver details, or arbitrary messages. */
export function getPostgresCancellationReason(
  error: unknown
): PostgresCancellationReason | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current) && seen.size < 10) {
    seen.add(current)
    if ('code' in current && typeof current.code === 'string') {
      const errorCode = current.code
      const errorMessage = 'message' in current ? current.message : undefined
      const match = POSTGRES_CANCELLATION_REASONS.find(
        ([code, message]) => errorCode === code && errorMessage === message
      )
      return match?.[2]
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
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
 *
 * Bound parameter values are stripped from every reported message: Drizzle's
 * `DrizzleQueryError` appends `\nparams: <values>` to the failing SQL, and those
 * values are user data that must never reach logs.
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
    return { name: normalized.name, message: redactBoundParameters(normalized.message) }
  }

  const deepest = chain[chain.length - 1] as Error & Record<string, unknown>
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined
  const code = asString(deepest.code)
  const errno = asString(deepest.errno)
  const syscall = asString(deepest.syscall)

  return {
    name: deepest.name,
    message: redactBoundParameters(deepest.message),
    ...(code ? { code } : {}),
    ...(errno ? { errno } : {}),
    ...(syscall ? { syscall } : {}),
    ...(chain.length > 1
      ? { causeChain: chain.map((e) => `${e.name}: ${redactBoundParameters(e.message)}`) }
      : {}),
  }
}

/** Replaces a driver-appended `params: <values>` tail with a redaction marker. */
export function redactBoundParameters(message: string): string {
  const index = message.indexOf('\nparams:')
  return index === -1 ? message : `${message.slice(0, index)}\nparams: [redacted]`
}

/**
 * First link in the `.cause` chain (including `error` itself) matching
 * `predicate`. Lets a caller recover a specific wrapped error class instead of
 * re-parsing a formatted message. Cycle-safe and depth-bounded, mirroring
 * {@link describeError}'s walk.
 */
export function findCause<T>(
  error: unknown,
  predicate: (value: unknown) => value is T
): T | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current instanceof Error && !seen.has(current) && seen.size < 10) {
    seen.add(current)
    if (predicate(current)) return current
    current = current.cause
  }

  return undefined
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
