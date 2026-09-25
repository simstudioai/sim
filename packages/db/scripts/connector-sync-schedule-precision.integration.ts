import { readFileSync } from 'node:fs'
import {
  applyMigration,
  migrationTestDatabaseUrl,
  withMigrationSchema,
} from '@sim/db/scripts/migration-fixture'
import type postgres from 'postgres'
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

function insertSchedule(sql: postgres.Sql, id: string): Promise<unknown> {
  return sql.unsafe(`INSERT INTO knowledge_connector (id, next_member_sync_at, next_sync_at)
    VALUES ('${id}', TIMESTAMP '${SUB_MILLISECOND}', TIMESTAMP '${SUB_MILLISECOND}')`)
}

/** The sub-millisecond remainder of each schedule, which a `Date` round trip cannot carry. */
async function subMillisecondsOf(sql: postgres.Sql, id: string): Promise<number[]> {
  const [row] = await sql<{ member: number; content: number }[]>`
    SELECT EXTRACT(microseconds FROM next_member_sync_at)::int % 1000 AS member,
           EXTRACT(microseconds FROM next_sync_at)::int % 1000 AS content
    FROM knowledge_connector WHERE id = ${id}`
  return [row.member, row.content]
}

describe.skipIf(!migrationTestDatabaseUrl)('connector sync schedule precision', () => {
  it('rounds schedules a SQL writer stored, and refuses to store new ones', async () => {
    await withMigrationSchema('sync_precision', async (sql) => {
      await sql`CREATE TABLE knowledge_connector (
        id text PRIMARY KEY,
        next_member_sync_at timestamp,
        next_sync_at timestamp
      )`
      await insertSchedule(sql, 'wedged')
      expect(await subMillisecondsOf(sql, 'wedged')).toEqual([433, 433])

      await applyMigration(sql, migration)
      await applyMigration(sql, migration)

      expect(await subMillisecondsOf(sql, 'wedged')).toEqual([0, 0])
      await insertSchedule(sql, 'fresh')
      expect(await subMillisecondsOf(sql, 'fresh')).toEqual([0, 0])

      const declared = await sql<{ column_name: string; datetime_precision: number }[]>`
        SELECT column_name, datetime_precision FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'knowledge_connector'
          AND column_name IN ('next_member_sync_at', 'next_sync_at')
        ORDER BY column_name`
      expect(declared.map((c) => [c.column_name, c.datetime_precision])).toEqual([
        ['next_member_sync_at', 3],
        ['next_sync_at', 3],
      ])
    })
  })
})
