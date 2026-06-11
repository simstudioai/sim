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
}

const postgresClient = postgres(connectionString, { ...poolOptions, max: 15 })

export const db = drizzle(postgresClient, { schema })

/**
 * Opt-in read-replica client for reads that tolerate bounded staleness and have
 * no read-your-writes dependency (logs, exports, dashboard aggregations). Never
 * for auth, workflow state, or billing enforcement. Falls back to the primary
 * when `DATABASE_REPLICA_URL` is unset, so call sites never branch.
 */
const replicaUrl = process.env.DATABASE_REPLICA_URL
if (replicaUrl && !/^postgres(ql)?:\/\//.test(replicaUrl)) {
  throw new Error(
    'DATABASE_REPLICA_URL is set but is not a postgres:// DSN — fix or unset it (reads fall back to the primary when unset)'
  )
}

export const dbReplica: typeof db = replicaUrl
  ? drizzle(postgres(replicaUrl, { ...poolOptions, max: 10 }), { schema })
  : db
