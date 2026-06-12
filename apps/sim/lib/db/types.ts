import type { db } from '@sim/db'
import type * as schema from '@sim/db/schema'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

/**
 * Type for database or transaction context.
 * Allows functions to work with either the db instance or a transaction.
 */
export type DbOrTx =
  | typeof db
  | PgTransaction<
      PostgresJsQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >

/**
 * Read-routing client: the primary `db` or the read replica `dbReplica`.
 *
 * For read-path helpers (billing summaries, dashboard aggregations) whose
 * executor param exists to route SELECT fan-outs to a replica. Deliberately
 * excludes transaction handles — these helpers issue multi-step query fans
 * that must never run while a transaction holds a pooled connection. Use
 * `DbOrTx` only for helpers genuinely designed to join a caller's
 * transaction.
 */
export type DbClient = typeof db
