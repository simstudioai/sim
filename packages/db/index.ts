import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export * from './triggers'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

/**
 * Server-side safety net for runaway queries and abandoned transactions:
 * - `statement_timeout=90000` kills any single statement still running
 *   after 90s. Protects against pathological queries.
 * - `idle_in_transaction_session_timeout=90000` kills a session that has
 *   opened a transaction and gone idle for 90s. Protects against
 *   transactions that hold row locks while waiting on external I/O.
 *
 * These are last-resort caps — application code should never approach
 * them. Migrations or admin scripts that legitimately need longer limits
 * must construct their own client with overrides.
 */
const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 30,
  onnotice: () => {},
  connection: {
    options: '-c statement_timeout=90000 -c idle_in_transaction_session_timeout=90000',
  },
})

export const db = drizzle(postgresClient, { schema })
