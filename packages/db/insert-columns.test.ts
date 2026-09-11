import { withInsertColumns } from '@sim/db/insert-columns'
import {
  organization,
  organizationColumns,
  userStats,
  userStatsColumns,
  workflowExecutionLogColumns,
  workflowExecutionLogs,
  workspaceFileColumns,
  workspaceFiles,
} from '@sim/db/schema'
import { getTableColumns, getTableName, sql } from 'drizzle-orm'
import { getTableConfig, type PgTable, pgSchema, text } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

const db = drizzle(async () => ({ rows: [] }))

describe('withInsertColumns', () => {
  it.each([
    { table: userStats, columns: userStatsColumns, retired: 'total_manual_executions' },
    { table: organization, columns: organizationColumns, retired: 'departed_member_usage' },
    { table: workflowExecutionLogs, columns: workflowExecutionLogColumns, retired: 'cost' },
    { table: workspaceFiles, columns: workspaceFileColumns, retired: 'size' },
  ])('excludes every retired column from $retired inserts and RETURNING', ({ table, columns }) => {
    const originalColumns = getTableColumns(table)
    const originalConfig = getTableConfig(table)
    const target = withInsertColumns(table, columns)
    const query = db.insert(target).values({ id: 'example' }).returning().toSQL()
    const fullQuery = db.insert(table).values({ id: 'example' }).returning().toSQL()

    for (const [key, column] of Object.entries(originalColumns)) {
      expect(fullQuery.sql).toContain(`"${column.name}"`)
      if (key in columns) expect(query.sql).toContain(`"${column.name}"`)
      else expect(query.sql).not.toContain(`"${column.name}"`)
    }
    expect(getTableName(target)).toBe(getTableName(table))
    expect(getTableColumns(target)).toBe(columns)
    expect(getTableColumns(table)).toBe(originalColumns)
    expect(getTableConfig(table)).toEqual(originalConfig)
  })

  it('retains live insert types and excludes retired fields', () => {
    const target = withInsertColumns(userStats, userStatsColumns)
    type Insert = typeof target.$inferInsert
    expectTypeOf<Insert['userId']>().toEqualTypeOf<string>()
    expectTypeOf<Insert['currentUsageLimit']>().toEqualTypeOf<string | null | undefined>()
    expectTypeOf<Insert['billingBlockedReason']>().toEqualTypeOf<
      'payment_failed' | 'dispute' | null | undefined
    >()
    expectTypeOf<'totalManualExecutions'>().not.toExtend<keyof Insert>()
    expectTypeOf<'currentPeriodCost'>().not.toExtend<keyof Insert>()
  })

  it('preserves bulk values, explicit nulls, defaults, and conflict handling', () => {
    const target = withInsertColumns(userStats, userStatsColumns)
    const query = db
      .insert(target)
      .values([
        { id: 'stats-1', userId: 'user-1', currentUsageLimit: null },
        { id: 'stats-2', userId: 'user-2', currentUsageLimit: '5' },
      ])
      .onConflictDoUpdate({
        target: userStats.userId,
        set: { currentUsageLimit: sql`excluded.current_usage_limit` },
      })
      .returning({ id: userStats.id })
      .toSQL()

    expect(query.params).toEqual(['stats-1', 'user-1', null, 'stats-2', 'user-2', '5'])
    expect(query.sql).toContain('default')
    expect(query.sql).toContain(
      'on conflict ("user_id") do update set "current_usage_limit" = excluded.current_usage_limit'
    )
    expect(query.sql).toContain('returning "id"')
    expect(query.sql).not.toContain('total_manual_executions')
    expect(
      db.insert(target).values({ id: 'stats-3', userId: 'user-3' }).onConflictDoNothing().toSQL()
        .sql
    ).toContain('on conflict do nothing')
  })

  it('preserves parameter encoders and RETURNING decoders', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z')
    const payload = { sample: true }
    const execute = vi.fn(async () => ({
      rows: [['2026-01-01 00:00:00', payload, '{model-a,model-b}']],
    }))
    const connection = drizzle(execute)
    const rows = await connection
      .insert(withInsertColumns(workflowExecutionLogs, workflowExecutionLogColumns))
      .values({
        id: 'log-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        stateSnapshotId: 'snapshot-1',
        level: 'info',
        status: 'running',
        trigger: 'manual',
        startedAt,
        executionData: payload,
        modelsUsed: ['model-a', 'model-b'],
      })
      .returning({
        startedAt: workflowExecutionLogs.startedAt,
        executionData: workflowExecutionLogs.executionData,
        modelsUsed: workflowExecutionLogs.modelsUsed,
      })

    expect(rows).toEqual([
      { startedAt, executionData: payload, modelsUsed: ['model-a', 'model-b'] },
    ])
    expect(execute).toHaveBeenCalledWith(
      expect.not.stringContaining('"cost"'),
      expect.arrayContaining([
        startedAt.toISOString(),
        JSON.stringify(payload),
        '{"model-a","model-b"}',
      ]),
      'all',
      expect.arrayContaining(['timestamp', 'json'])
    )
  })

  it('retains schema-qualified names and runtime defaults', () => {
    const table = pgSchema('insert_test').table('records', {
      id: text('id').$defaultFn(() => 'generated-id'),
      retired: text('retired'),
    })
    const query = db
      .insert(withInsertColumns(table, { id: table.id }))
      .values({})
      .toSQL()
    expect(query.sql).toBe('insert into "insert_test"."records" ("id") values ($1)')
    expect(query.params).toEqual(['generated-id'])
  })

  it('rejects a column from a different table', () => {
    const table: PgTable = userStats
    expect(() => withInsertColumns(table, { id: organization.id })).toThrow(
      'INSERT column id does not belong to the target table'
    )
  })
})
