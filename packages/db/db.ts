import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 15,
  onnotice: () => {},
  // Server-side guards. lock_timeout cancels a query waiting on a row lock for
  // >5s (e.g. another tx holding `SELECT ... FOR UPDATE`). statement_timeout
  // cancels any query running >30s. Heavy paths that legitimately need longer
  // (table service bulk JSONB rewrites) override per-tx with `SET LOCAL`.
  connection: {
    lock_timeout: 5_000,
    statement_timeout: 30_000,
  },
})

export const db = drizzle(postgresClient, { schema })
