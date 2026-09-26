/**
 * Runs the TTL expiry predicate against real PostgreSQL in a non-UTC session. The table rows live in
 * session temp tables, so the provisioned schema is untouched; locking, events, and triggers are
 * fixtures.
 */
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'

const { mockDeleteExecute, mockListExecute, mockWithLockedTable } = vi.hoisted(() => ({
  mockDeleteExecute: vi.fn(),
  mockListExecute: vi.fn(),
  mockWithLockedTable: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  dbFor: vi.fn(() => ({ execute: mockListExecute })),
}))
vi.mock('@trigger.dev/sdk', () => ({ task: vi.fn((config: unknown) => config) }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: vi.fn() }))
vi.mock('@/lib/table/constants', () => ({
  getDeleteSnapshotBatchSize: () => 500,
  TABLE_LIMITS: { DELETE_SNAPSHOT_BATCH_MAX_BYTES: 32 * 1024 * 1024 },
}))
vi.mock('@/lib/table/service', () => ({ withLockedTable: mockWithLockedTable }))
vi.mock('@/lib/table/ttl-availability', () => ({ isTableRowTtlEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: vi.fn() }))

import { runCleanupTableRowTtl } from '@/background/cleanup-table-row-ttl'

const dialect = new PgDialect()

const table = {
  id: 'table-1',
  name: 'Expiring rows',
  workspaceId: 'workspace-1',
  schema: { columns: [{ id: 'col-ttl', name: 'expires_at', type: 'ttl' }] },
  locks: { insertLocked: false, updateLocked: false, deleteLocked: false, schemaLocked: false },
}

describe('table row TTL predicate in PostgreSQL', () => {
  mockWithLockedTable.mockImplementation(
    async (
      _tableId: string,
      mutate: (fresh: typeof table, trx: { execute: typeof mockDeleteExecute }) => Promise<unknown>
    ) => mutate(table, { execute: mockDeleteExecute })
  )

  it('deletes only expired UTC cells in PostgreSQL with a non-UTC session', async () => {
    const client = postgres(readTestDatabaseUrl(), { max: 1 })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T12:00:00.500Z'))
    try {
      await client`SET TIME ZONE 'America/Los_Angeles'`
      await client`CREATE TEMP TABLE user_table_definitions (id text, workspace_id text, schema jsonb, archived_at timestamp, delete_locked boolean)`
      await client`CREATE TEMP TABLE user_table_rows (id text, table_id text, workspace_id text, data jsonb, created_at timestamp DEFAULT now())`
      await client`INSERT INTO user_table_definitions VALUES (${table.id}, ${table.workspaceId}, ${client.json(table.schema)}, NULL, false)`
      const values = {
        expired: '2026-09-07T11:59:59Z',
        equal: '2026-09-07T12:00:00Z',
        future: '2026-09-07T12:00:01Z',
        blank: null,
        epoch: 1_700_000_000,
        invalid: 'not-a-date',
        invalid_day: '2026-02-30T12:00:00Z',
        invalid_month: '2026-13-01T12:00:00Z',
        invalid_year: '0000-01-01T00:00:00Z',
        invalid_leap_day: '2025-02-29T12:00:00Z',
        invalid_century_leap_day: '1900-02-29T12:00:00Z',
        invalid_month_end: '2026-04-31T12:00:00Z',
        invalid_hour: '2026-09-06T24:00:00Z',
        invalid_minute: '2026-09-06T12:60:00Z',
        invalid_second: '2026-09-06T12:00:60Z',
        leap_day: '2024-02-29T12:00:00Z',
        century_leap_day: '2000-02-29T12:00:00Z',
        first_year: '0001-01-01T00:00:00Z',
        last_year: '9999-12-31T23:59:59Z',
        offset: '2026-09-06T12:00:00+00:00',
        fraction: '2026-09-06T12:00:00.000Z',
        negative_offset: '2026-09-07T04:59:59-07:00',
        positive_offset: '2026-09-07T18:00:00+06:00',
        future_offset: '2026-09-07T12:00:00-07:00',
        equal_fraction: '2026-09-07T12:00:00.500000Z',
        future_microsecond: '2026-09-07T12:00:00.500001Z',
        minute_precision: '2026-09-07T12:00Z',
        invalid_offset_day: '2026-02-30T12:00:00-07:00',
        invalid_offset: '2026-09-07T12:00:00+16:00',
        invalid_fraction: '2026-09-07T12:00:00.0000001Z',
        rounding_future: '2026-09-07T12:00:00.5000001Z',
        no_offset: '2020-01-01T00:00:00',
        day_only: '2020-01-01',
        relative_now: 'now',
        relative_today: 'today',
        relative_yesterday: 'yesterday',
        epoch_alias: 'epoch',
        past_infinity: '-infinity',
        compact_offset: '2020-01-01T00:00:00+0000',
        named_zone: '2020-01-01 00:00:00 America/Los_Angeles',
        trailing_newline: '2020-01-01T00:00:00Z\n',
      }
      for (const [id, value] of Object.entries(values)) {
        await client`INSERT INTO user_table_rows (id, table_id, workspace_id, data) VALUES (${id}, ${table.id}, ${table.workspaceId}, ${client.json({ 'col-ttl': value })})`
      }
      const execute = (statement: SQL) => {
        const query = dialect.sqlToQuery(statement)
        return client.unsafe(query.sql, query.params as (string | number)[])
      }
      mockListExecute.mockImplementation(execute)
      mockDeleteExecute.mockImplementation(execute)
      expect(await runCleanupTableRowTtl()).toEqual({
        batches: 2,
        deleted: 11,
        limitReached: false,
      })
      const remaining = await client<{ id: string }[]>`SELECT id FROM user_table_rows ORDER BY id`
      expect(remaining.map(({ id }) => id)).toEqual(
        Object.keys(values)
          .filter(
            (id) =>
              ![
                'expired',
                'equal',
                'leap_day',
                'century_leap_day',
                'first_year',
                'offset',
                'fraction',
                'negative_offset',
                'positive_offset',
                'equal_fraction',
                'minute_precision',
              ].includes(id)
          )
          .sort()
      )
    } finally {
      nowSpy.mockRestore()
      await client.end()
    }
  })
})
