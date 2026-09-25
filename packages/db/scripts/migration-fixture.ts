import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'

/**
 * Runs `body` against a disposable schema on its own connection, dropping both afterwards even if
 * the body throws. Suites share one database, so an escaped schema is charged to whichever runs
 * next — the nested `finally` is what keeps a failed drop from also leaking the connection.
 */
export async function withMigrationSchema(
  prefix: string,
  body: (sql: postgres.Sql) => Promise<void>
): Promise<void> {
  const sql = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
  const schemaName = `${prefix}_${generateId().replaceAll('-', '')}`
  try {
    await sql`CREATE SCHEMA ${sql(schemaName)}`
    await sql`SET search_path = ${sql(schemaName)}`
    await body(sql)
  } finally {
    try {
      await sql`DROP SCHEMA IF EXISTS ${sql(schemaName)} CASCADE`
    } finally {
      await sql.end()
    }
  }
}

/**
 * Replays a migration file the way the migrator does, splitting on the breakpoint Drizzle writes.
 * Blank trailing fragments are skipped rather than sent as empty queries.
 */
export async function applyMigration(sql: postgres.Sql, migration: string): Promise<void> {
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await sql.unsafe(statement)
  }
}
