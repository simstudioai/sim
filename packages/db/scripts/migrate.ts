import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { runScriptMigrations } from '../script-migrations/index'

/**
 * Concurrent-index convention: plain `CREATE INDEX` write-blocks large/hot
 * tables, and CONCURRENTLY cannot run inside drizzle's migration transaction.
 * For indexes on big tables, edit the generated SQL to:
 *
 *   COMMIT;--> statement-breakpoint
 *   SET lock_timeout = 0;--> statement-breakpoint
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_name" ON "table" (...);--> statement-breakpoint
 *   SET lock_timeout = '5s';
 *
 * The embedded COMMIT ends the batch transaction, so everything after it (in
 * this and later pending files) runs in autocommit and must be idempotent
 * (`IF NOT EXISTS` etc.) — a failed run replays unjournaled files from the top.
 * A failed CONCURRENTLY build leaves an INVALID index that `IF NOT EXISTS`
 * skips; `warnOnInvalidIndexes` below surfaces those.
 */

/**
 * Prefer a direct (non-pooled) DSN: session advisory locks and session `SET`s
 * are unsupported through PgBouncer transaction pooling. Falls back to
 * DATABASE_URL for setups that connect directly anyway.
 */
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  console.error('ERROR: Missing DATABASE_URL environment variable.')
  console.error('Ensure packages/db/.env is configured.')
  process.exit(1)
}

/**
 * The pid guard is only sound on a direct connection — through transaction
 * pooling, consecutive statements legitimately land on different backends.
 */
const hasDirectMigrationUrl = Boolean(process.env.MIGRATION_DATABASE_URL)

/**
 * `max_lifetime: null` pins the session for the whole run: the postgres-js
 * default recycles the connection after 30–60 min, silently dropping the
 * session advisory lock and `SET`s.
 */
const client = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-migrate' },
})

/**
 * Cross-process migration lock. drizzle's `migrate()` has no built-in lock, so
 * concurrent runners (one per app replica at deploy time) must be serialized.
 * Acquisition is a bounded try-lock loop: a plain `pg_advisory_lock` wait let
 * one wedged runner silently hang every other runner and the whole deploy.
 */
const MIGRATION_LOCK_KEY = 4_961_002_270n
const LOCK_ACQUIRE_DEADLINE_MS = 30 * 60_000
const LOCK_RETRY_INTERVAL_MS = 5_000

/**
 * Max time a migration statement may queue for a table lock (SQLSTATE 55P03 on
 * expiry). Without it, DDL waiting on an AccessExclusiveLock queues every other
 * query on the table behind it — a table-wide stall for the whole wait.
 */
const DDL_LOCK_TIMEOUT = '5s'
const MAX_MIGRATE_ATTEMPTS = 8
const MIGRATE_RETRY_BACKOFF = { baseMs: 2_000, maxMs: 30_000 } as const

const CONNECT_MAX_ATTEMPTS = 10
const CONNECT_RETRY_BACKOFF = { baseMs: 1_000, maxMs: 15_000 } as const

/**
 * Error codes that mean the database was momentarily unreachable rather than
 * the migration being wrong: chiefly `53300` (too_many_connections — every
 * non-superuser slot was taken, surfaced as "remaining connection slots are
 * reserved for roles with the SUPERUSER attribute"), the `08xxx`
 * connection_exception class, and the postgres-js driver's own transport
 * codes. These are retried while opening the session; anything else is fatal.
 */
const TRANSIENT_CONNECT_CODES = new Set([
  '53300',
  '53400',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
])

function isTransientConnectError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  if (!code) return false
  return TRANSIENT_CONNECT_CODES.has(code) || code.startsWith('08')
}

/** Backend pid of the lock-holding session; a change means the lock was lost. */
let lockSessionPid = 0

try {
  await connectWithRetry()
  await acquireMigrationLock()
  try {
    await runMigrationsWithRetry()
    console.log('Migrations applied successfully.')
    await runScriptMigrations(client)
    await warnOnInvalidIndexes()
  } finally {
    await releaseMigrationLock()
  }
} catch (error) {
  console.error('ERROR: Migration failed.')
  printMigrationError(error)
  process.exit(1)
} finally {
  await client.end()
}

/**
 * Open the migration session before taking the advisory lock, retrying
 * transient connection failures with bounded backoff. The deploy database can
 * briefly exhaust every non-superuser connection slot at peak (`53300`); the
 * migration is a single short-lived session, so waiting out a spike that frees
 * within seconds is far safer than failing the whole deploy. Non-transient
 * errors (auth, unknown host config, etc.) still fail fast.
 */
async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client`SELECT 1`
      return
    } catch (error) {
      if (!isTransientConnectError(error) || attempt >= CONNECT_MAX_ATTEMPTS) throw error
      const delayMs = backoffWithJitter(attempt, null, CONNECT_RETRY_BACKOFF)
      console.warn(
        `WARN: database unavailable (${getPostgresErrorCode(error)}); ` +
          `attempt ${attempt}/${CONNECT_MAX_ATTEMPTS}, retrying in ${Math.round(delayMs)}ms.`
      )
      await sleep(delayMs)
    }
  }
}

/**
 * Acquire the cross-process migration lock, failing loudly after the deadline
 * instead of blocking forever behind a wedged runner.
 */
async function acquireMigrationLock(): Promise<void> {
  const deadline = Date.now() + LOCK_ACQUIRE_DEADLINE_MS
  for (;;) {
    const [{ locked, pid }] =
      await client`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS locked, pg_backend_pid() AS pid`
    if (locked) {
      lockSessionPid = pid
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${LOCK_ACQUIRE_DEADLINE_MS}ms waiting for the migration advisory lock; ` +
          'another runner is likely stuck mid-migration. Investigate before retrying.'
      )
    }
    await sleep(LOCK_RETRY_INTERVAL_MS)
  }
}

/**
 * Run pending migrations, retrying on lock timeout (55P03, found anywhere in
 * the wrapped `cause` chain). Each attempt re-verifies the lock session (pid)
 * and re-asserts the session timeouts — a migration file may have changed them,
 * and `SET` cannot be parameterized, hence `client.unsafe` with constants.
 * Replays are safe: drizzle rolls the batch back on failure, and post-COMMIT
 * CONCURRENTLY statements are idempotent by convention.
 */
async function runMigrationsWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    if (hasDirectMigrationUrl) {
      const [{ pid }] = await client`SELECT pg_backend_pid() AS pid`
      if (pid !== lockSessionPid) {
        throw new Error(
          `Database session changed mid-run (backend pid ${lockSessionPid} -> ${pid}); ` +
            'the migration advisory lock was lost. Aborting so a fresh runner can retry safely.'
        )
      }
    }
    await client.unsafe('SET statement_timeout = 0')
    await client.unsafe(`SET lock_timeout = '${DDL_LOCK_TIMEOUT}'`)
    try {
      await migrate(drizzle(client), { migrationsFolder: './migrations' })
      return
    } catch (error) {
      const isLockTimeout = getPostgresErrorCode(error) === '55P03'
      if (!isLockTimeout || attempt >= MAX_MIGRATE_ATTEMPTS) throw error
      const delayMs = backoffWithJitter(attempt, null, MIGRATE_RETRY_BACKOFF)
      console.warn(
        `WARN: migration DDL hit lock_timeout (attempt ${attempt}/${MAX_MIGRATE_ATTEMPTS}); ` +
          `retrying in ${Math.round(delayMs)}ms.`
      )
      await sleep(delayMs)
    }
  }
}

/**
 * A failed CONCURRENTLY build leaves an INVALID index that `IF NOT EXISTS`
 * silently skips forever — surface it (warn only; the migration committed).
 */
async function warnOnInvalidIndexes(): Promise<void> {
  try {
    const rows = await client`
      SELECT n.nspname AS schema, c.relname AS index
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT i.indisvalid
    `
    for (const row of rows) {
      console.warn(
        `WARN: invalid index ${row.schema}.${row.index} — a CONCURRENTLY build failed partway. ` +
          'Drop and rebuild it; IF NOT EXISTS will keep skipping it.'
      )
    }
  } catch (checkError) {
    console.warn('WARN: could not check for invalid indexes.', checkError)
  }
}

/**
 * Unlock errors are swallowed: the session lock auto-releases on disconnect,
 * and a thrown unlock would falsely report a committed migration as failed.
 */
async function releaseMigrationLock(): Promise<void> {
  try {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
  } catch (unlockError) {
    console.error(
      'WARN: pg_advisory_unlock failed; the session lock will auto-release on disconnect.',
      unlockError
    )
  }
}

/**
 * Print every diagnostic field a Postgres driver puts on a thrown error. The default
 * `error.message` loses the constraint name, affected table/column, PG code, and hint —
 * which are usually what you need to diagnose a failed migration.
 */
function printMigrationError(error: unknown): void {
  if (!(error instanceof Error)) {
    console.error(error)
    return
  }

  console.error(`message: ${error.message}`)

  const pgFields = [
    'code',
    'severity',
    'severity_local',
    'detail',
    'hint',
    'schema',
    'schema_name',
    'table',
    'table_name',
    'column',
    'column_name',
    'constraint',
    'constraint_name',
    'data_type',
    'where',
    'internal_query',
    'internal_position',
    'position',
    'routine',
    'file',
    'line',
  ] as const

  const err = error as Record<string, unknown>
  for (const field of pgFields) {
    const value = err[field]
    if (value !== undefined && value !== null && value !== '') {
      console.error(`${field}: ${String(value)}`)
    }
  }

  if (err.query && typeof err.query === 'string') {
    console.error('\nfailing query:')
    console.error(err.query)
  }

  if (err.parameters !== undefined) {
    console.error('\nparameters:')
    console.error(err.parameters)
  }

  if (error.cause) {
    console.error('\ncause:')
    printMigrationError(error.cause)
  }

  if (error.stack) {
    console.error('\nstack:')
    console.error(error.stack)
  }
}
