import { reconcileOAuthProviderLifecycleMigration } from '@sim/db/script-migrations/0012_reconcile_oauth_provider_lifecycle'
import type { Sql } from 'postgres'
import { backfillTableOrderKeys } from './0001_backfill_table_order_keys'
import { backfillPausedBillingAttribution } from './0002_backfill_paused_billing_attribution'
import { backfillWorkspaceStorageUsage } from './0003_backfill_workspace_storage_usage'
import { backfillForkKnowledgeBaseFileOwnership } from './0004_backfill_fork_kb_file_ownership'
import { repairUnknownTableRowProvenance } from './0005_repair_unknown_table_row_provenance'
import { repairUnknownTableRowProvenanceSecondPass } from './0006_repair_unknown_table_row_provenance_second_pass'
import { repairUnknownWorkspaceFileProvenance } from './0007_repair_unknown_workspace_file_provenance'
import { backfillWorkspaceFileSizeBytesMigration } from './0008_backfill_workspace_file_size_bytes'
import { backfillWelResidualCostTotalMigration } from './0009_backfill_wel_residual_cost_total'
import { backfillCredentialGroupResourcePolicies } from './0010_backfill_credential_group_resource_policies'
import { remapLegacyKnowledgeConnectorCredentialsMigration } from './0011_remap_legacy_knowledge_connector_credentials'
import type { ScriptMigration } from './types'

export type { ScriptMigration } from './types'

/**
 * Ordered, append-only registry of script migrations. An entry may be deleted
 * once a later SQL migration supersedes it (accepting that deployments which
 * never ran it skip the backfill) — never renamed or reordered.
 */
export const scriptMigrations: readonly ScriptMigration[] = [
  backfillTableOrderKeys,
  backfillPausedBillingAttribution,
  backfillWorkspaceStorageUsage,
  backfillForkKnowledgeBaseFileOwnership,
  repairUnknownTableRowProvenance,
  repairUnknownTableRowProvenanceSecondPass,
  repairUnknownWorkspaceFileProvenance,
  backfillWorkspaceFileSizeBytesMigration,
  backfillWelResidualCostTotalMigration,
  backfillCredentialGroupResourcePolicies,
  remapLegacyKnowledgeConnectorCredentialsMigration,
  reconcileOAuthProviderLifecycleMigration,
]

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

  /**
   * The SQL-migration phase leaves `lock_timeout = '5s'` on this session (DDL
   * must fail fast rather than queue a table-wide stall). Script migrations
   * want the opposite: they block on app-held row/advisory locks (e.g. the
   * per-table insert lock in the order_key backfill) and must wait them out —
   * exactly like the standalone scripts they replace, which ran on fresh
   * connections with the Postgres defaults. `SET` cannot be parameterized,
   * hence `unsafe` with constants.
   */
  await sql.unsafe('SET statement_timeout = 0')
  await sql.unsafe('SET lock_timeout = 0')

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
    await sql`
      INSERT INTO script_migrations (name) VALUES (${migration.name})
      ON CONFLICT (name) DO NOTHING
    `
    console.log(`Script migration ${migration.name} applied in ${Date.now() - startedAt}ms.`)
  }
}
