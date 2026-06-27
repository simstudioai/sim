import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { instrumentPoolClient } from './tx-tripwire'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

const poolOptions = {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  onnotice: () => {},
  connection: { application_name: process.env.DB_APP_NAME ?? 'sim-app' },
}

const postgresClient = instrumentPoolClient(
  postgres(connectionString, { ...poolOptions, max: 15 }),
  'db'
)

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
    'DATABASE_REPLICA_URL is set but is not a postgres:// DSN — fix the URL or unset the variable'
  )
}

export const dbReplica: typeof db = replicaUrl
  ? drizzle(instrumentPoolClient(postgres(replicaUrl, { ...poolOptions, max: 10 }), 'dbReplica'), {
      schema,
    })
  : db
