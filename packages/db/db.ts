import { createLogger } from '@sim/logger'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { resolveDbUrl } from './connection-url'
import * as schema from './schema'
import { instrumentPoolClient } from './tx-tripwire'

const logger = createLogger('Db')

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
  // Sub-process pools, selected per call-site via dbFor() — never via SIM_DB_ROLE.
  cleanup: { primaryMax: 5, replicaMax: 2, appName: 'sim-cleanup' },
  exec: { primaryMax: 10, replicaMax: 4, appName: 'sim-exec' },
} as const

/** Roles a whole process runs as (via SIM_DB_ROLE). */
const PROCESS_ROLES = ['web', 'trigger', 'realtime'] as const

type ProcessDbRole = (typeof PROCESS_ROLES)[number]
type SubProcessDbRole = Exclude<keyof typeof DB_POOL_PROFILES, ProcessDbRole>

const roleEnv = process.env.SIM_DB_ROLE?.trim()
if (roleEnv && !PROCESS_ROLES.includes(roleEnv as ProcessDbRole)) {
  throw new Error(
    `Invalid SIM_DB_ROLE '${roleEnv}' — expected one of ${PROCESS_ROLES.join(', ')} (or unset for web)`
  )
}
const role = (roleEnv as ProcessDbRole) || 'web'
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

const subPoolClients = new Map<SubProcessDbRole, typeof db>()

/** Which env var the process connection came from — named in dbFor fallback logs. */
const processUrlEnvVar = process.env[`DATABASE_URL_${role.toUpperCase()}`]
  ? `DATABASE_URL_${role.toUpperCase()}`
  : 'DATABASE_URL'

/**
 * Per-workload drizzle client with its own pool, built lazily on first call and
 * cached per role. Unlike the process-wide `db` (selected by `SIM_DB_ROLE`),
 * these are selected per call-site so a workload running inside an existing
 * process — cleanup jobs in the trigger worker, inline execution log writes in
 * the web server — gets its own connection budget and PgBouncer pool.
 *
 * Resolves `DATABASE_URL_<ROLE>` with fallback to the URL the process itself
 * resolved (`DATABASE_URL_<PROCESSROLE>`, then base `DATABASE_URL`), so an
 * unset sub-pool URL changes nothing about where this process's traffic lands.
 * Always uses the role profile's `appName` — the `DB_APP_NAME` override applies
 * only to the process-wide clients.
 */
export function dbFor(role: SubProcessDbRole): typeof db {
  const existing = subPoolClients.get(role)
  if (existing) return existing

  const keyedEnvVar = `DATABASE_URL_${role.toUpperCase()}`
  const keyedUrl = process.env[keyedEnvVar]
  const url = keyedUrl ?? connectionString
  if (!url) {
    throw new Error('Missing DATABASE_URL environment variable')
  }

  if (keyedUrl) {
    logger.info(`'${role}' pool using dedicated ${keyedEnvVar}`)
  } else {
    logger.info(
      `${keyedEnvVar} not set — '${role}' pool falling back to the process connection (${processUrlEnvVar})`
    )
  }

  const subProfile = DB_POOL_PROFILES[role]
  const client = drizzle(
    instrumentPoolClient(
      postgres(url, {
        ...poolOptions,
        max: subProfile.primaryMax,
        connection: { application_name: subProfile.appName },
      }),
      role
    ),
    { schema }
  )
  subPoolClients.set(role, client)
  return client
}
