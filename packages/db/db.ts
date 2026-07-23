import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { resolveDbUrl } from './connection-url'
import * as schema from './schema'
import { SSO_PROVIDER_MUTATION_LOCK_KEY } from './sso-lock'
import { instrumentPoolClient } from './tx-tripwire'

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

const roleEnv = process.env.SIM_DB_ROLE?.trim()
if (roleEnv && !Object.hasOwn(DB_POOL_PROFILES, roleEnv)) {
  throw new Error(
    `Invalid SIM_DB_ROLE '${roleEnv}' — expected one of ${Object.keys(DB_POOL_PROFILES).join(', ')} (or unset for web)`
  )
}
const role = (roleEnv as DbRole) || 'web'
const profile = DB_POOL_PROFILES[role]

const connectionString = resolveDbUrl('DATABASE_URL', role)
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

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

let ssoProviderMutationTail = Promise.resolve()

/**
 * Serializes SSO provider create/update mutations across app processes.
 *
 * Parent/child domain overlap cannot be represented by a normal unique index,
 * so callers must re-check availability while holding this lock and keep it
 * through the Better Auth write. The lock uses a reserved connection and a
 * transaction-scoped advisory lock so it remains safe behind transaction-mode
 * poolers and is released automatically if the callback or process fails.
 *
 * The per-process queue prevents concurrent requests from reserving multiple
 * primary-pool connections while they wait for the same cross-process lock.
 */
export async function withSSOProviderMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  const predecessor = ssoProviderMutationTail
  let releaseLocalLock!: () => void
  ssoProviderMutationTail = new Promise<void>((resolve) => {
    releaseLocalLock = resolve
  })

  await predecessor
  try {
    const reserved = await postgresClient.reserve()
    try {
      await reserved.unsafe('BEGIN')
      try {
        await reserved.unsafe(`SELECT pg_advisory_xact_lock(${SSO_PROVIDER_MUTATION_LOCK_KEY})`)
        const result = await callback()
        await reserved.unsafe('COMMIT')
        return result
      } catch (error) {
        await reserved.unsafe('ROLLBACK')
        throw error
      }
    } finally {
      reserved.release()
    }
  } finally {
    releaseLocalLock()
  }
}

/**
 * Opt-in read-replica client for reads that tolerate bounded staleness and have
 * no read-your-writes dependency (logs, exports, dashboard aggregations). Never
 * for auth, workflow state, or billing enforcement. Falls back to the primary
 * when `DATABASE_REPLICA_URL` is unset, so call sites never branch.
 */
const replicaUrl = resolveDbUrl('DATABASE_REPLICA_URL', role)
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
