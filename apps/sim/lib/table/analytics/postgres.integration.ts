import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateShortId } from '@sim/utils/id'
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { queryTableAnalytics } from '@/lib/table/analytics/query'
import { analyticsQuerySchema } from '@/lib/table/analytics/schema'
import type { TableDefinition } from '@/lib/table/types'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/table/planner', () => ({
  withReadGuards: (callback: (tx: unknown) => unknown) => callback({ execute }),
}))

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
const assistsTable = {
  ...table,
  id: 'tbl_assists',
  schema: {
    columns: [
      { id: 'col_outcome', name: 'outcome', type: 'string' },
      {
        id: 'col_channel',
        name: 'channel',
        type: 'select',
        options: [
          { id: 'chat', name: 'Chat' },
          { id: 'email', name: 'Email' },
        ],
      },
    ],
  },
} as TableDefinition
const resolved = { field: 'outcome', op: 'eq', value: 'AI resolved' }
const quotedOutcome = "Resolved'); DROP TABLE user_table_rows; --"

describe('analytics on real PostgreSQL', () => {
  let client: ReturnType<typeof postgres>
  const schema = `analytics_${generateShortId()}`
  beforeAll(async () => {
    client = postgres(readTestDatabaseUrl(), { max: 1 })
    await client`CREATE SCHEMA ${client(schema)}`
    await client`SET search_path TO ${client(schema)}`
    await client.unsafe(`CREATE TABLE user_table_rows (id text primary key, table_id text, workspace_id text, created_at timestamp, updated_at timestamp, data jsonb);
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
    const outcomes = [
      'AI resolved',
      'Escalated',
      quotedOutcome,
      'AI resolved',
      'AI resolved',
      'AI resolved',
      null,
    ]
    const channels = ['chat', 'chat', 'email', 'chat', 'chat', 'email', 'email']
    for (const [index, outcome] of outcomes.entries()) {
      const day = index < 3 ? '2026-09-18' : '2026-09-19'
      await client`INSERT INTO user_table_rows VALUES (
        ${`assist_${index}`}, 'tbl_assists', 'workspace_test', ${day}, ${day},
        ${client.json({ col_outcome: outcome, col_channel: channels[index] })}
      )`
    }
    await client.unsafe(`INSERT INTO user_table_rows VALUES
      ('assist_foreign', 'tbl_assists', 'workspace_other', '2026-09-18', '2026-09-18', '{"col_outcome":"AI resolved"}'),
      ('assist_upper', 'tbl_assists', 'workspace_test', '2026-09-24', '2026-09-24', '{"col_outcome":"AI resolved"}');`)
    const database = drizzle(client)
    execute.mockImplementation((statement: SQL) => database.execute(statement))
  })
  afterAll(async () => {
    await client?.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client?.end()
  })
  it('computes a fractional percentage from the scoped population without filtering other measures', async () => {
    const result = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        aggregate: { total: { op: 'count' }, rate: { op: 'percent', filter: resolved } },
      })
    )
    expect(result.rows[0].total).toBe(7)
    expect(result.rows[0].rate).toBeCloseTo(400 / 7)
  })
  it('uses source filters for the denominator and nested per-measure conditions for the numerator', async () => {
    const result = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        filter: { field: 'channel', op: 'eq', value: 'Chat' },
        aggregate: {
          rate: {
            op: 'percent',
            filter: {
              all: [
                resolved,
                {
                  any: [
                    { field: 'channel', op: 'eq', value: 'Chat' },
                    { field: 'channel', op: 'eq', value: 'Email' },
                  ],
                },
              ],
            },
          },
        },
      })
    )
    expect(result.rows).toEqual([{ rate: 75 }])
  })
  it('calculates each group independently and fills missing time buckets with null', async () => {
    const grouped = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        groupBy: ['channel'],
        aggregate: { rate: { op: 'percent', filter: resolved } },
      })
    )
    expect(grouped.rows[0]).toEqual({ channel: 'Chat', rate: 75 })
    expect(grouped.rows[1].channel).toBe('Email')
    expect(grouped.rows[1].rate).toBeCloseTo(100 / 3)
    const daily = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        groupBy: ['createdAt'],
        bucket: 'day',
        aggregate: { rate: { op: 'percent', filter: resolved } },
      })
    )
    expect(daily.rows[0].rate).toBeNull()
    expect(daily.rows[1].rate).toBeCloseTo(100 / 3)
    expect(daily.rows[2].rate).toBe(75)
    expect(daily.rows).toHaveLength(7)
  })
  it('distinguishes an empty population from zero or all matches', async () => {
    const result = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        aggregate: {
          none: { op: 'percent', filter: { field: 'outcome', op: 'eq', value: 'No match' } },
          all: { op: 'percent', filter: { field: 'channel', op: 'in', value: ['Chat', 'Email'] } },
        },
      })
    )
    expect(result.rows).toEqual([{ none: 0, all: 100 }])
    const empty = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        from: '2026-09-20T00:00:00Z',
        to: bounds.to,
        aggregate: { rate: { op: 'percent', filter: resolved } },
      })
    )
    expect(empty.rows).toEqual([{ rate: null }])
  })
  it('treats quoted conditions as literal values and validates their table fields', async () => {
    const result = await queryTableAnalytics(
      assistsTable,
      analyticsQuerySchema.parse({
        ...bounds,
        aggregate: { rate: { op: 'percent', filter: { ...resolved, value: quotedOutcome } } },
      })
    )
    expect(result.rows[0].rate).toBeCloseTo(100 / 7)
    await expect(
      queryTableAnalytics(
        assistsTable,
        analyticsQuerySchema.parse({
          ...bounds,
          aggregate: { rate: { op: 'percent', filter: { ...resolved, field: 'missing' } } },
        })
      )
    ).rejects.toThrow(/missing/)
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
