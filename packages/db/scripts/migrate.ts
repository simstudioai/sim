import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('ERROR: Missing DATABASE_URL environment variable.')
  console.error('Ensure packages/db/.env is configured.')
  process.exit(1)
}

const client = postgres(url, { max: 1, connect_timeout: 10 })

try {
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
