import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

const poolOptions = {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  onnotice: () => {},
} as const

const postgresClient = postgres(connectionString, { ...poolOptions, max: 15 })

export const db = drizzle(postgresClient, { schema })

/**
 * Read-replica client — EXPLICIT OPT-IN.
 *
 * Import `dbReplica` only for reads that tolerate bounded staleness and have no
 * read-your-writes dependency: logs listing/search, audit logs, dashboard
 * aggregations, bulk exports. Never use it for auth/session lookups, workflow
 * state, billing-limit enforcement, or any read inside a write-reconciling
 * flow.
 *
 * Falls back to the primary client when `DATABASE_REPLICA_URL` is unset (dev,
 * self-hosted, realtime), so call sites never need to branch.
 */
const replicaUrl = process.env.DATABASE_REPLICA_URL

export const dbReplica: typeof db = replicaUrl
  ? drizzle(postgres(replicaUrl, { ...poolOptions, max: 10 }), { schema })
  : db
