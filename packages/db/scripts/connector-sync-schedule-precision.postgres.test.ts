import { readFileSync } from 'node:fs'
import {
  applyMigration,
  migrationTestDatabaseUrl,
  withMigrationSchema,
} from '@sim/db/scripts/migration-fixture'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/0363_connector_sync_schedule_precision.sql', import.meta.url),
  'utf8'
)

/**
 * Written as a SQL literal rather than a bound parameter, because that is the only way such a
 * value reaches the column: the driver truncates bound parameters, so only SQL doing its own
 * arithmetic — a backfill computing `LEAST(next_member_sync_at, …)` — can store one.
 */
const SUB_MILLISECOND = '2026-09-16 17:15:28.261433'

describe.skipIf(!migrationTestDatabaseUrl)('connector sync schedule precision', () => {
  it('discards sub-millisecond precision a SQL writer would otherwise store', async () => {
    await withMigrationSchema('sync_precision', async (sql) => {
      await sql`CREATE TABLE knowledge_connector (
        id text PRIMARY KEY,
        next_member_sync_at timestamp,
        next_sync_at timestamp
      )`
      await applyMigration(sql, migration)
      await applyMigration(sql, migration)

      await sql.unsafe(`INSERT INTO knowledge_connector (id, next_member_sync_at, next_sync_at)
        VALUES ('c1', TIMESTAMP '${SUB_MILLISECOND}', TIMESTAMP '${SUB_MILLISECOND}')`)

      const [stored] = await sql<{ member_sub_ms: number; content_sub_ms: number }[]>`
        SELECT EXTRACT(microseconds FROM next_member_sync_at)::int % 1000 AS member_sub_ms,
               EXTRACT(microseconds FROM next_sync_at)::int % 1000 AS content_sub_ms
        FROM knowledge_connector WHERE id = 'c1'`
      expect([stored.member_sub_ms, stored.content_sub_ms]).toEqual([0, 0])

      const declared = await sql<{ column_name: string; datetime_precision: number }[]>`
        SELECT column_name, datetime_precision FROM information_schema.columns
        WHERE table_name = 'knowledge_connector'
          AND column_name IN ('next_member_sync_at', 'next_sync_at')
        ORDER BY column_name`
      expect(declared.map((c) => [c.column_name, c.datetime_precision])).toEqual([
        ['next_member_sync_at', 3],
        ['next_sync_at', 3],
      ])
    })
  })
})
