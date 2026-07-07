import type { Sql } from 'postgres'
import { backfillTableOrderKeys } from './0001_backfill_table_order_keys'
import type { ScriptMigration } from './types'

export type { ScriptMigration } from './types'

/**
 * Ordered, append-only registry of script migrations. An entry may be deleted
 * once a later SQL migration supersedes it (accepting that deployments which
 * never ran it skip the backfill) — never renamed or reordered.
 */
export const scriptMigrations: readonly ScriptMigration[] = [backfillTableOrderKeys]

/**
 * Applies pending script migrations in registry order, recording each by name.
 * Runs inside the migration advisory-lock session, immediately after drizzle's
 * SQL migrations succeed — so a script always sees the fully-migrated schema of
 * the release that ships it. The tracking table is runner-managed (like
 * drizzle's own `__drizzle_migrations`), not part of the app schema.
 *
 * Fails fast: a missing required env var or a throwing `up` aborts the run
 * before the name is recorded, so the migration retries on the next upgrade.
 */
export async function runScriptMigrations(sql: Sql): Promise<void> {
  const names = new Set<string>()
  for (const migration of scriptMigrations) {
    if (names.has(migration.name)) {
      throw new Error(`Duplicate script migration name: ${migration.name}`)
    }
    names.add(migration.name)
  }

  await sql`
    CREATE TABLE IF NOT EXISTS script_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `
  const appliedRows = await sql<{ name: string }[]>`SELECT name FROM script_migrations`
  const applied = new Set(appliedRows.map((row) => row.name))

  const pending = scriptMigrations.filter((migration) => !applied.has(migration.name))
  if (pending.length === 0) {
    console.log('No pending script migrations.')
    return
  }

  for (const migration of pending) {
    for (const key of migration.requiredEnv ?? []) {
      if (!process.env[key]) {
        throw new Error(
          `Script migration ${migration.name} requires env var ${key}; set it on the migrations container.`
        )
      }
    }
    console.log(`Applying script migration ${migration.name}...`)
    const startedAt = Date.now()
    await migration.up(sql)
    await sql`INSERT INTO script_migrations (name) VALUES (${migration.name})`
    console.log(`Script migration ${migration.name} applied in ${Date.now() - startedAt}ms.`)
  }
}
