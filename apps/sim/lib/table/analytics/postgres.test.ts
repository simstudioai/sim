/** @vitest-environment node */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { queryTableAnalytics } from '@/lib/table/analytics/query'
import { analyticsQuerySchema } from '@/lib/table/analytics/schema'
import type { TableDefinition } from '@/lib/table/types'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/table/planner', () => ({
  withReadGuards: (callback: (tx: unknown) => unknown) => callback({ execute }),
}))

/** Opt-in only: a disposable Unix-socket cluster, never the application's DATABASE_URL. */
const socket = process.env.DASHBOARD_TEST_SOCKET
if (socket && !socket.startsWith('/private/tmp/sim-dashboard-pg.'))
  throw new Error('Dashboard SQL tests require a disposable local socket')
const table = {
  id: 'tbl_metrics',
  workspaceId: 'workspace_test',
  schema: {
    columns: [
      { id: 'col_alarm', name: 'alarm_name', type: 'string' },
      { id: 'col_latency', name: 'latency', type: 'number' },
      { id: 'col_date', name: 'occurred_at', type: 'date' },
    ],
  },
} as TableDefinition
const bounds = { from: '2026-09-17T00:00:00Z', to: '2026-09-24T00:00:00Z' }

describe.runIf(Boolean(socket))('analytics on real PostgreSQL', () => {
  let client: ReturnType<typeof postgres>
  beforeAll(async () => {
    client = postgres({
      host: socket,
      port: 55441,
      username: 'dashboard_test',
      database: 'postgres',
      max: 1,
    })
    const dialect = new PgDialect()
    execute.mockImplementation((statement: SQL) => {
      const compiled = dialect.sqlToQuery(statement)
      return client.unsafe(compiled.sql, compiled.params as postgres.ParameterOrFragment<never>[])
    })
    await client.unsafe(`DROP TABLE IF EXISTS user_table_rows;
      CREATE TABLE user_table_rows (id text primary key, table_id text, workspace_id text, created_at timestamp, updated_at timestamp, data jsonb);
      CREATE INDEX ON user_table_rows(table_id, created_at, id);
      INSERT INTO user_table_rows SELECT n::text, 'tbl_metrics', 'workspace_test', '2026-09-18'::timestamp, '2026-09-18'::timestamp,
        jsonb_build_object('col_alarm', CASE WHEN n % 2 = 0 THEN 'A' ELSE 'B' END, 'col_latency', CASE WHEN n % 3 = 0 THEN NULL ELSE 10 END)
        FROM generate_series(1,6000) n;
      INSERT INTO user_table_rows VALUES
        ('before', 'tbl_metrics', 'workspace_test', '2026-09-16', '2026-09-16', '{}'),
        ('upper', 'tbl_metrics', 'workspace_test', '2026-09-24', '2026-09-24', '{}'),
        ('foreign', 'tbl_metrics', 'workspace_other', '2026-09-18', '2026-09-18', '{}'),
        ('other_table', 'tbl_other', 'workspace_test', '2026-09-18', '2026-09-18', '{}'),
        ('date1', 'tbl_dates', 'workspace_test', '2026-09-18', '2026-09-18', '{"col_date":"2026-09-17"}'),
        ('date2', 'tbl_dates', 'workspace_test', '2026-09-18', '2026-09-18', '{"col_date":"2026-09-16T17:00:00-07:00"}'),
        ('date3', 'tbl_dates', 'workspace_test', '2026-09-18', '2026-09-18', '{"col_date":"2026-09-24T00:00:00Z"}');`)
  })
  afterAll(async () => {
    await client?.end()
  })
  it('counts every matching row beyond chart sampling limits and excludes other tenants/ranges', async () => {
    const result = await queryTableAnalytics(
      table,
      analyticsQuerySchema.parse({
        ...bounds,
        aggregate: {
          n: { op: 'count' },
          present: { op: 'count', field: 'latency' },
          sum: { op: 'sum', field: 'latency' },
          mean: { op: 'avg', field: 'latency' },
          distinct: { op: 'countDistinct', field: 'alarm_name' },
        },
      })
    )
    expect(result.rows).toEqual([{ n: 6000, present: 4000, sum: 40000, mean: 10, distinct: 2 }])
  })
  it('groups real JSONB values, filters, and applies top-N after aggregation', async () => {
    const result = await queryTableAnalytics(
      table,
      analyticsQuerySchema.parse({
        ...bounds,
        groupBy: ['alarm_name'],
        aggregate: { n: { op: 'count' } },
        filter: { field: 'latency', op: 'gte', value: 10 },
        sort: [{ field: 'alarm_name', direction: 'asc' }],
        limit: 1,
      })
    )
    expect(result).toMatchObject({ rows: [{ alarm_name: 'A', n: 2000 }], truncated: true })
  })
  it('fills time buckets and preserves nulls for empty numeric aggregates', async () => {
    const result = await queryTableAnalytics(
      table,
      analyticsQuerySchema.parse({
        ...bounds,
        groupBy: ['createdAt'],
        bucket: 'day',
        aggregate: { n: { op: 'count' }, mean: { op: 'avg', field: 'latency' } },
      })
    )
    expect(result.rows).toHaveLength(7)
    expect(result.rows[0]).toEqual({ createdAt: '2026-09-17T00:00:00.000Z', n: 0, mean: null })
    expect(result.rows[1]).toEqual({ createdAt: '2026-09-18T00:00:00.000Z', n: 6000, mean: 10 })
  })
  it('normalizes date-only and explicit-offset event times independently of database timezone', async () => {
    await client.unsafe("SET TIME ZONE 'Pacific/Honolulu'")
    const result = await queryTableAnalytics(
      { ...table, id: 'tbl_dates' },
      analyticsQuerySchema.parse({
        ...bounds,
        timeField: 'occurred_at',
        groupBy: ['occurred_at'],
        bucket: 'day',
        aggregate: { n: { op: 'count' } },
      })
    )
    expect(result.rows[0]).toEqual({ occurred_at: '2026-09-17T00:00:00.000Z', n: 2 })
  })
  it('returns ordered bounded raw rows, and SQL errors remain errors', async () => {
    const result = await queryTableAnalytics(
      table,
      analyticsQuerySchema.parse({ ...bounds, columns: ['id', 'createdAt', 'latency'], limit: 2 })
    )
    expect(result.rows).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.rows[0].createdAt).toBe('2026-09-18T00:00:00.000Z')
    await client.unsafe(
      `INSERT INTO user_table_rows VALUES ('bad_date', 'tbl_bad', 'workspace_test', now(), now(), '{"col_date":"not-a-timestamp"}')`
    )
    await expect(
      queryTableAnalytics(
        { ...table, id: 'tbl_bad' },
        analyticsQuerySchema.parse({
          ...bounds,
          timeField: 'occurred_at',
          aggregate: { n: { op: 'count' } },
        })
      )
    ).rejects.toThrow()
  })
})
