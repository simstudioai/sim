import { findCause } from '@sim/utils/errors'
import { DrizzleQueryError } from 'drizzle-orm/errors'

/**
 * The Drizzle query failure anywhere in `error`'s cause chain. Its message carries the SQL text and
 * bound parameters, so it must never reach a user; its `cause` holds the driver error and code.
 */
export function findDatabaseQueryError(error: unknown): DrizzleQueryError | undefined {
  return findCause(error, (cause): cause is DrizzleQueryError => cause instanceof DrizzleQueryError)
}
