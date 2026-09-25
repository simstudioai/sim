/** @vitest-environment node */
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fillAnalyticsBuckets, resolveAnalyticsBucket } from '@/lib/table/analytics/buckets'
import { buildAnalyticsQuery, queryTableAnalytics } from '@/lib/table/analytics/query'
import { analyticsQuerySchema } from '@/lib/table/analytics/schema'
import type { TableDefinition } from '@/lib/table/types'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
const { execute, guards } = vi.hoisted(() => ({ execute: vi.fn(), guards: vi.fn() }))
vi.mock('@/lib/table/planner', () => ({ withReadGuards: guards }))
const table = {
  id: 'tbl_test',
  workspaceId: 'workspace_test',
  schema: {
    columns: [
      { id: 'col_alarm', name: 'alarm_name', type: 'string' },
      { id: 'col_latency', name: 'latency', type: 'number' },
      { id: 'col_date', name: 'occurred_at', type: 'date' },
      { id: 'col_json', name: 'payload', type: 'json' },
    ],
  },
} as TableDefinition
const base = {
  from: '2026-09-17T00:00:00Z',
  to: '2026-09-24T00:00:00Z',
  aggregate: { total: { op: 'count' as const } },
}
const dialect = new PgDialect()
beforeEach(() => {
  vi.clearAllMocks()
  guards.mockImplementation((cb) => cb({ execute }))
  execute.mockResolvedValue([{ data: { total: 0 } }])
})
describe('table analytics SQL', () => {
  it('binds tenant and UTC bounds and limits only the result', () => {
    const compiled = dialect.sqlToQuery(
      buildAnalyticsQuery(table, analyticsQuerySchema.parse(base)).statement
    )
    expect(compiled.sql).toContain('count(*)')
    expect(compiled.sql).toContain('"user_table_rows"."workspace_id" =')
    expect(compiled.sql).toContain('"user_table_rows"."created_at" >=')
    expect(compiled.sql).toContain('"user_table_rows"."created_at" <')
    expect(compiled.params).toEqual(
      expect.arrayContaining(['tbl_test', 'workspace_test', base.from, base.to, 501])
    )
    expect(compiled.sql.indexOf('LIMIT')).toBeGreaterThan(compiled.sql.indexOf('count(*)'))
    expect(compiled.sql).toContain('octet_length')
  })
  it('resolves names and IDs, groups by position and parameterizes values', () => {
    const query = analyticsQuerySchema.parse({
      ...base,
      groupBy: ['alarm_name'],
      aggregate: { mean: { op: 'avg', field: 'col_latency' } },
      filter: { field: 'alarm_name', op: 'eq', value: "'); DROP TABLE x; --" },
    })
    const compiled = dialect.sqlToQuery(buildAnalyticsQuery(table, query).statement)
    expect(compiled.sql).toContain('GROUP BY 1')
    expect(compiled.sql).not.toContain('DROP TABLE')
    expect(compiled.params).toContain('col_latency')
    expect(compiled.params).toContain('col_alarm')
  })
  it.each([
    { columns: ['unknown'] },
    { columns: ['payload'] },
    { columns: ['id'], timeField: 'alarm_name' },
    { aggregate: { v: { op: 'sum', field: 'alarm_name' } } },
    { aggregate: { v: { op: 'count' } }, sort: [{ field: 'missing', direction: 'desc' }] },
    { aggregate: { v: { op: 'count' } }, filter: { field: 'missing', op: 'eq', value: 'x' } },
  ])('refuses invalid schema references: %j', (selection) =>
    expect(() =>
      buildAnalyticsQuery(
        table,
        analyticsQuerySchema.parse({ from: base.from, to: base.to, ...selection })
      )
    ).toThrow()
  )
  it('uses explicit UTC for date columns', () => {
    const query = analyticsQuerySchema.parse({
      ...base,
      timeField: 'occurred_at',
      groupBy: ['occurred_at'],
      bucket: 'day',
    })
    const compiled = dialect.sqlToQuery(buildAnalyticsQuery(table, query).statement)
    expect(compiled.sql).toContain("AT TIME ZONE 'UTC'")
    expect(compiled.sql).toContain('[0-9]{4}')
    expect(compiled.params).toContain('day')
  })
  it('preserves null sums and uses bounded read guards', async () => {
    execute.mockResolvedValue([{ data: { total: 0, sum: null } }])
    const result = await queryTableAnalytics(
      table,
      analyticsQuerySchema.parse({
        ...base,
        aggregate: { ...base.aggregate, sum: { op: 'sum', field: 'latency' } },
      })
    )
    expect(result.rows).toEqual([{ total: 0, sum: null }])
    expect(guards).toHaveBeenCalledWith(expect.any(Function), {
      seqscanOff: true,
      repeatableRead: true,
    })
  })
  it('fails on overflow or oversized output and marks top-N', async () => {
    execute.mockResolvedValue(
      Array.from({ length: 501 }, (_, i) => ({ data: { alarm_name: String(i), total: 1 } }))
    )
    const query = analyticsQuerySchema.parse({ ...base, groupBy: ['alarm_name'] })
    await expect(queryTableAnalytics(table, query)).rejects.toThrow('More than 500 groups')
    expect(await queryTableAnalytics(table, { ...query, limit: 5 })).toMatchObject({
      truncated: true,
    })
    execute.mockResolvedValue([{ data: null }])
    await expect(queryTableAnalytics(table, query)).rejects.toThrow('exceeds 8 KB')
  })
  it('propagates database failures', async () => {
    execute.mockRejectedValue(new Error('database unavailable'))
    await expect(queryTableAnalytics(table, analyticsQuerySchema.parse(base))).rejects.toThrow(
      'database unavailable'
    )
  })
})
describe('time buckets', () => {
  it('bounds automatic points and rejects excessively fine buckets', () => {
    expect(resolveAnalyticsBucket({ ...base, groupBy: ['createdAt'] })).toBe('day')
    expect(() =>
      resolveAnalyticsBucket({ ...base, groupBy: ['createdAt'], bucket: 'minute' })
    ).toThrow('Too many')
  })
  it('fills count gaps with zero, average gaps with null and excludes the end', () => {
    const query = analyticsQuerySchema.parse({
      ...base,
      groupBy: ['createdAt'],
      bucket: 'day',
      aggregate: { ...base.aggregate, mean: { op: 'avg', field: 'latency' } },
    })
    const rows = fillAnalyticsBuckets(
      [{ createdAt: '2026-09-18T00:00:00.000Z', total: 3, mean: 10 }],
      query,
      'day'
    )
    expect(rows).toHaveLength(7)
    expect(rows[0]).toEqual({ createdAt: '2026-09-17T00:00:00.000Z', total: 0, mean: null })
    expect(rows[1].total).toBe(3)
    expect(rows[6].createdAt).toBe('2026-09-23T00:00:00.000Z')
  })
  it('uses calendar months and Monday weeks including partial first buckets', () => {
    expect(
      fillAnalyticsBuckets(
        [],
        {
          ...base,
          from: '2026-01-31T12:00:00Z',
          to: '2026-03-01T00:00:00Z',
          groupBy: ['createdAt'],
        },
        'month'
      ).map((r) => r.createdAt)
    ).toEqual(['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'])
    expect(
      fillAnalyticsBuckets(
        [],
        {
          ...base,
          from: '2026-09-20T12:00:00Z',
          to: '2026-09-22T00:00:00Z',
          groupBy: ['createdAt'],
        },
        'week'
      ).map((r) => r.createdAt)
    ).toEqual(['2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'])
  })
})
