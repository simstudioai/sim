import {
  findCause,
  getErrorMessage,
  getPostgresCancellationReason,
  getPostgresErrorCode,
} from '@sim/utils/errors'
import { DrizzleQueryError } from 'drizzle-orm/errors'

/** PostgreSQL `foreign_key_violation`. */
export const FOREIGN_KEY_VIOLATION = '23503'

/**
 * The Drizzle query failure anywhere in `error`'s cause chain. Its message carries the SQL text and
 * bound parameters, so it must never reach a user; its `cause` holds the driver error and code.
 */
export function findDatabaseQueryError(error: unknown): DrizzleQueryError | undefined {
  return findCause(error, (cause): cause is DrizzleQueryError => cause instanceof DrizzleQueryError)
}

/** Stands in for a database query failure's message on any surface a user can read. */
const INTERNAL_DATABASE_ERROR_MESSAGE = 'An internal database error occurred'

/**
 * `error`'s message for a surface a user can read: {@link INTERNAL_DATABASE_ERROR_MESSAGE} when a
 * Drizzle query failure is anywhere in its cause chain, since a wrapper that interpolated the
 * query's message carries its SQL and bound parameters too; otherwise its own message, or
 * `fallback` when it has none.
 */
export function getUserFacingErrorMessage(error: unknown, fallback?: string): string {
  return findDatabaseQueryError(error)
    ? INTERNAL_DATABASE_ERROR_MESSAGE
    : getErrorMessage(error, fallback)
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
