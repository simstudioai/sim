import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { instrumentPoolClient } from './tx-tripwire'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

/**
 * Per-role pool profiles. Starting numbers — validate against real per-role
 * process counts (PgBouncer transaction mode, max_connections=200).
 */
export const DB_POOL_PROFILES = {
  web: { primaryMax: 10, replicaMax: 4, appName: 'sim-app' },
  // 5, not 3 — one run can need 3+ simultaneous connections (parallel queries +
  // overlapping logging writes); 3 risks intra-run deadlock.
  trigger: { primaryMax: 5, replicaMax: 2, appName: 'sim-trigger' },
  realtime: { primaryMax: 5, replicaMax: 3, appName: 'sim-realtime' },
} as const

type DbRole = keyof typeof DB_POOL_PROFILES

const role = process.env.SIM_DB_ROLE as DbRole | undefined
const profile = (role && DB_POOL_PROFILES[role]) || DB_POOL_PROFILES.web

const poolOptions = {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  onnotice: () => {},
  connection: { application_name: process.env.DB_APP_NAME ?? profile.appName },
}

const postgresClient = instrumentPoolClient(
  postgres(connectionString, { ...poolOptions, max: profile.primaryMax }),
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
  ? drizzle(
      instrumentPoolClient(
        postgres(replicaUrl, { ...poolOptions, max: profile.replicaMax }),
        'dbReplica'
      ),
      {
        schema,
      }
    )
  : db
