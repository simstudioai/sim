import { readFileSync } from 'node:fs'
import {
  applyMigration,
  migrationTestDatabaseUrl,
  withMigrationSchema,
} from '@sim/db/scripts/migration-fixture'
import type postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/0348_drop_retired_usage_columns.sql', import.meta.url),
  'utf8'
)
const bridge = readFileSync(
  new URL('../migrations/0308_workspace_file_size_cutover.sql', import.meta.url),
  'utf8'
)
const retiredStats = [
  'total_manual_executions',
  'total_api_calls',
  'total_webhook_triggers',
  'total_scheduled_executions',
  'total_chat_executions',
  'total_mcp_executions',
  'total_tokens_used',
  'total_cost',
  'current_period_cost',
  'pro_period_cost_snapshot',
  'pro_period_cost_snapshot_at',
  'total_copilot_cost',
  'current_period_copilot_cost',
  'total_copilot_tokens',
  'total_copilot_calls',
  'total_mcp_copilot_calls',
  'total_mcp_copilot_cost',
  'current_period_mcp_copilot_cost',
  'last_active',
]
const receipts = [
  '0008_backfill_workspace_file_size_bytes',
  '0009_backfill_wel_residual_cost_total',
]

async function fixture(run: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  await withMigrationSchema('retired_columns', async (sql) => {
    await sql`CREATE TABLE script_migrations (name text PRIMARY KEY)`
    await sql`CREATE TABLE organization (id text, departed_member_usage numeric, credit_balance numeric)`
    await sql`CREATE TABLE user_stats (id text, credit_balance numeric)`
    for (const column of retiredStats) {
      await sql`ALTER TABLE user_stats ADD COLUMN ${sql(column)} text`
    }
    await sql`CREATE TABLE workflow_execution_logs (id text, cost jsonb, cost_total numeric)`
    await sql`CREATE TABLE workspace_files (id text, size integer NOT NULL, size_bytes bigint)`
    await sql.unsafe(bridge)
    await run(sql)
  })
}

const apply = (sql: postgres.Sql) => applyMigration(sql, migration)

describe.skipIf(!migrationTestDatabaseUrl)('retired-column contract migration', () => {
  it('allows a fresh database and replays after the columns are gone', async () => {
    await fixture(async (sql) => {
      await apply(sql)
      await apply(sql)
      await sql`INSERT INTO workspace_files (id, size_bytes) VALUES ('new-file', 5000000000)`
      expect(await sql`SELECT size_bytes::text AS size FROM workspace_files`).toEqual([
        { size: '5000000000' },
      ])
    })
  })

  it.each(receipts)(
    'blocks a populated database missing %s before dropping anything',
    async (missing) => {
      await fixture(async (sql) => {
        for (const receipt of receipts.filter((name) => name !== missing)) {
          await sql`INSERT INTO script_migrations (name) VALUES (${receipt})`
        }
        await sql`INSERT INTO workspace_files (id, size_bytes) VALUES ('file', 5000000000)`
        await sql`INSERT INTO workflow_execution_logs (id, cost, cost_total) VALUES ('log', '{"total": 1.25}', 1.25)`
        await expect(apply(sql)).rejects.toThrow(missing)
        expect(await sql`SELECT size FROM workspace_files`).toEqual([{ size: 2147483647 }])
        expect(await sql`SELECT cost FROM workflow_execution_logs`).toEqual([
          { cost: { total: 1.25 } },
        ])
      })
    }
  )

  it('preserves canonical values and removes all retired columns and the bridge', async () => {
    await fixture(async (sql) => {
      for (const receipt of receipts) {
        await sql`INSERT INTO script_migrations (name) VALUES (${receipt})`
      }
      await sql`INSERT INTO workspace_files (id, size_bytes) VALUES ('file', 5000000000)`
      await sql`INSERT INTO workflow_execution_logs (id, cost, cost_total) VALUES ('log', '{"total": 1.25}', 1.25)`
      await sql`INSERT INTO user_stats (id, credit_balance) VALUES ('user', 12.50)`
      await sql`INSERT INTO organization (id, credit_balance) VALUES ('org', 25.75)`
      await apply(sql)
      await apply(sql)
      expect(await sql`SELECT * FROM workspace_files`).toEqual([
        { id: 'file', size_bytes: '5000000000' },
      ])
      expect(await sql`SELECT * FROM workflow_execution_logs`).toEqual([
        { id: 'log', cost_total: '1.25' },
      ])
      expect(await sql`SELECT * FROM user_stats`).toEqual([{ id: 'user', credit_balance: '12.50' }])
      expect(await sql`SELECT * FROM organization`).toEqual([
        { id: 'org', credit_balance: '25.75' },
      ])
      expect(
        await sql`SELECT 1 FROM pg_trigger WHERE tgrelid = 'workspace_files'::regclass AND tgname = 'workspace_files_sync_size_columns'`
      ).toEqual([])
      expect(
        await sql`SELECT to_regprocedure('sync_workspace_file_size_columns()') AS bridge`
      ).toEqual([{ bridge: null }])
    })
  })
})
