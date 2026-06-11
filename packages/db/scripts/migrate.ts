import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Concurrent-index convention (avoid write-blocking index builds on large tables)
 * --------------------------------------------------------------------------------
 * drizzle-kit emits plain `CREATE INDEX`, which takes a SHARE lock and blocks all
 * writes for the build duration — on a big, write-hot table (e.g.
 * workflow_execution_logs, usage_log) that stalls every in-flight workflow
 * completion for minutes. drizzle runs migrations inside a transaction, and
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
 *
 * So, after generating a migration that adds an index on a large/hot table, edit
 * the generated SQL to end drizzle's transaction first, clear the session
 * `lock_timeout` (set below for fail-fast DDL; it would cancel CONCURRENTLY's
 * legitimate waits on old transactions and leave an INVALID index), build
 * concurrently and idempotently, then RESTORE the fail-fast timeout so later
 * statements and files in the same run keep the protection (the SET is
 * session-level and would otherwise persist):
 *
 *   COMMIT;--> statement-breakpoint
 *   SET lock_timeout = 0;--> statement-breakpoint
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_name" ON "table" (...);--> statement-breakpoint
 *   SET lock_timeout = '5s';
 *
 * Notes:
 *  - Put the `COMMIT` breakpoint AFTER all transactional DDL (ALTER TABLE/TYPE)
 *    in the file and only the concurrent CREATE INDEX statements below it.
 *  - drizzle's migrate() wraps ALL pending files in ONE transaction, so the
 *    embedded `COMMIT` ends that batch transaction: everything after it — in
 *    this file AND any later pending files — runs in autocommit, one statement
 *    at a time. This is why EVERY statement in a file using this convention,
 *    and in any file that can follow it in a batch, must be idempotent
 *    (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`):
 *    a failure after the COMMIT cannot roll back, and the re-run replays every
 *    file whose journal record has not yet committed.
 *  - CONCURRENTLY only takes a SHARE UPDATE EXCLUSIVE lock (allows reads/writes).
 *  - Always validate on staging before prod; a failed CONCURRENTLY build can
 *    leave an INVALID index that must be dropped and rebuilt — the
 *    `warnOnInvalidIndexes` check below logs any such index after every run.
 */

/**
 * Migrations must run on a DIRECT Postgres connection, never through a
 * transaction-pooling PgBouncer. Session-level advisory locks, session `SET`s
 * (`statement_timeout`/`lock_timeout` below), and `pg_advisory_unlock` are all
 * officially unsupported in transaction pooling — statements can land on
 * different server connections, so the lock may not guard the migration, the
 * unlock can strand the lock on a pooled connection (wedging the NEXT deploy
 * for the full acquisition deadline), and timeout settings can leak into app
 * traffic. This is the same reason Prisma requires `directUrl` for migrate.
 *
 * Set MIGRATION_DATABASE_URL to the direct (non-pooled) DSN in environments
 * where DATABASE_URL points at a PgBouncer; it falls back to DATABASE_URL for
 * dev/self-hosted setups that connect directly anyway.
 */
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  console.error('ERROR: Missing DATABASE_URL environment variable.')
  console.error('Ensure packages/db/.env is configured.')
  process.exit(1)
}

/**
 * The backend-pid session guard below is only sound on a DIRECT connection:
 * through a transaction-pooling PgBouncer, consecutive statements can
 * legitimately run on different server backends, so a pid change does not mean
 * the session was lost and the guard would false-positive on every run.
 * MIGRATION_DATABASE_URL is by contract the direct DSN; when falling back to
 * DATABASE_URL (which may be pooled), the guard is skipped.
 */
const hasDirectMigrationUrl = Boolean(process.env.MIGRATION_DATABASE_URL)

/**
 * `max_lifetime: null` is load-bearing: postgres-js defaults to recycling the
 * connection after a randomized 30–60 minutes, and a transparent reconnect
 * silently drops the session advisory lock and session `SET`s. The migration
 * session must live exactly as long as the run.
 */
const client = postgres(url, { max: 1, connect_timeout: 10, max_lifetime: null })

/**
 * Cross-process migration lock key (a stable, app-wide 64-bit constant).
 *
 * drizzle's `migrate()` has no built-in lock, so when a deployment starts N app
 * replicas at once — each with a migration sidecar — all N read
 * `__drizzle_migrations`, all see the same migration pending, and all try to apply
 * it concurrently. One wins; the losers run the same DDL against already-mutated
 * state and die (e.g. `DROP TABLE "form"` → `table "form" does not exist`,
 * exit 1 / TaskFailedToStart).
 *
 * Acquisition is a bounded `pg_try_advisory_lock` retry loop rather than a plain
 * `pg_advisory_lock`: an unbounded wait meant one wedged runner silently hung
 * every other deploy sidecar (and the whole ECS deployment) behind it. With a
 * deadline, a stuck winner turns into a visible non-zero exit on the losers that
 * the deploy orchestrator can retry or surface. Session locks auto-release if
 * the connection drops, so a crashed runner never wedges the lock.
 */
const MIGRATION_LOCK_KEY = 4_961_002_270n
const LOCK_ACQUIRE_DEADLINE_MS = 30 * 60_000
const LOCK_RETRY_INTERVAL_MS = 5_000

/**
 * How long any single migration statement may QUEUE for a table lock before
 * failing with SQLSTATE 55P03. Without this, DDL needing an AccessExclusiveLock
 * (e.g. `DROP TABLE ... CASCADE`) queues indefinitely behind long-running reads
 * — and every other query on that table queues behind the pending exclusive
 * lock, stalling all reads/writes table-wide until the DDL gets its turn
 * (observed in production: a ~15-minute full stall). Failing fast keeps the
 * world unblocked; we retry below, then let the deploy retry.
 */
const DDL_LOCK_TIMEOUT = '5s'
const MAX_MIGRATE_ATTEMPTS = 8
const MIGRATE_RETRY_BACKOFF = { baseMs: 2_000, maxMs: 30_000 } as const

/**
 * Backend pid of the session that acquired the advisory lock. Re-checked at the
 * top of every migration attempt: if the connection was silently replaced
 * (server restart, network failure), the new session does NOT hold the lock,
 * and running migrations on it would break mutual exclusion — abort loudly.
 */
let lockSessionPid = 0

try {
  await acquireMigrationLock()
  try {
    await runMigrationsWithRetry()
    console.log('Migrations applied successfully.')
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
 * Run pending migrations, retrying when a statement loses the `lock_timeout`
 * race (SQLSTATE 55P03, detected anywhere in the error's `cause` chain since
 * drizzle wraps driver failures).
 *
 * Every attempt starts by verifying the session still holds the advisory lock
 * (backend pid unchanged) and re-asserting the session timeouts:
 * `statement_timeout = 0` because index builds (esp. CONCURRENTLY on large
 * tables) can run far longer than any app default and must never be killed
 * mid-build, and the fail-fast `lock_timeout` because a prior attempt's
 * migration file may have left the session at `lock_timeout = 0` (the
 * CONCURRENTLY convention above). `SET` is rejected by Postgres when
 * parameterized, so the constants are inlined via `client.unsafe`.
 *
 * Retry safety: drizzle wraps the whole pending batch in one transaction, so a
 * lock-timeout failure rolls the batch back and the retry resumes from the
 * first file whose journal record has not committed. Files using the
 * embedded-`COMMIT` CONCURRENTLY convention break out of that transaction —
 * their post-COMMIT statements are required to be idempotent (see the
 * convention notes above) precisely so a replay is safe.
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
 * A `CREATE INDEX CONCURRENTLY` that fails partway leaves an INVALID index that
 * `IF NOT EXISTS` then silently skips on every future run. Surface any such
 * index loudly (warn, don't fail — the migration itself committed) so it can be
 * dropped and rebuilt.
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
 * Release the advisory lock without ever failing the process. The session-level
 * lock auto-releases when the connection closes, so a thrown unlock — e.g. the
 * connection dropped right after `migrate()` committed — must be swallowed.
 * Letting it reach the outer `catch` would exit 1 and falsely report a
 * successful migration as failed to the deploy orchestrator.
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
