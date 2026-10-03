import { findCause, getPostgresCancellationReason, getPostgresErrorCode } from '@sim/utils/errors'
import { DrizzleQueryError } from 'drizzle-orm/errors'

/**
 * The Drizzle query failure anywhere in `error`'s cause chain. Its message carries the SQL text and
 * bound parameters, so it must never reach a user; its `cause` holds the driver error and code.
 */
export function findDatabaseQueryError(error: unknown): DrizzleQueryError | undefined {
  return findCause(error, (cause): cause is DrizzleQueryError => cause instanceof DrizzleQueryError)
}

/**
 * Replaces a Drizzle query failure with an error naming only its database code, for surfaces such as
 * task runners that record a thrown error's message and stack verbatim. The original stays in
 * `cause` for in-process diagnostics. Errors without a query are returned unchanged.
 */
export function redactDatabaseQueryError(error: unknown, operation: string): unknown {
  const queryError = findDatabaseQueryError(error)
  if (!queryError) return error
  const code = getPostgresErrorCode(queryError) ?? 'no error code'
  const reason = getPostgresCancellationReason(queryError)
  return new Error(`${operation} failed (${reason ? `${code}, ${reason}` : code})`, {
    cause: error,
  })
}
