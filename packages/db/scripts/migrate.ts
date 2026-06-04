import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Concurrent-index convention (avoid write-blocking index builds on large tables)
 * --------------------------------------------------------------------------------
 * drizzle-kit emits plain `CREATE INDEX`, which takes a SHARE lock and blocks all
 * writes for the build duration — on a big, write-hot table (e.g.
 * workflow_execution_logs, usage_log) that stalls every in-flight workflow
 * completion for minutes. drizzle wraps each migration in a transaction, and
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
 *
 * So, after generating a migration that adds an index on a large/hot table, edit
 * the generated SQL to end drizzle's transaction first, then build concurrently
 * and idempotently:
 *
 *   COMMIT;--> statement-breakpoint
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_name" ON "table" (...);
 *
 * Notes:
 *  - Put the `COMMIT` breakpoint AFTER all transactional DDL (ALTER TABLE/TYPE)
 *    in the file and only the concurrent CREATE INDEX statements below it.
 *  - Use `IF NOT EXISTS` (and make sibling DDL idempotent, e.g.
 *    `ADD COLUMN IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`) so a re-run after a
 *    failed CONCURRENTLY build is safe — fresh DBs and re-applies both work.
 *  - CONCURRENTLY only takes a SHARE UPDATE EXCLUSIVE lock (allows reads/writes).
 *  - Always validate on staging before prod; a failed CONCURRENTLY build can
 *    leave an INVALID index that must be dropped and rebuilt.
 */

const url = process.env.DATABASE_URL
if (!url) {
  console.error('ERROR: Missing DATABASE_URL environment variable.')
  console.error('Ensure packages/db/.env is configured.')
  process.exit(1)
}

const client = postgres(url, { max: 1, connect_timeout: 10 })

try {
  // statement_timeout=0: index builds (esp. CONCURRENTLY on large tables) can run
  // far longer than the app default; a migration must never be killed mid-build.
  await client`SET statement_timeout = 0`
  await migrate(drizzle(client), { migrationsFolder: './migrations' })
  console.log('Migrations applied successfully.')
} catch (error) {
  console.error('ERROR: Migration failed.')
  printMigrationError(error)
  process.exit(1)
} finally {
  await client.end()
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
