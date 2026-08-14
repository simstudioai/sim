/**
 * @vitest-environment node
 */
import { asyncJobs, tableJobs, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { createMockRequest, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_JOB_DURATION_SECONDS, MIN_JOB_DURATION_SECONDS } from '@/lib/core/async-jobs'

const { mockDeleteFile, mockVerifyCronAuth } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))

import { GET } from '@/app/api/cron/cleanup-stale-executions/route'

const cleanupLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'CleanupStaleExecutions')
  ].value

interface MockCondition {
  type?: string
  conditions?: unknown[]
  left?: unknown
  right?: unknown
  values?: unknown
  toSQL?: () => { sql: string; params: unknown[] }
}

function flattenConditions(condition: unknown): MockCondition[] {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as MockCondition
  return [node, ...(node.conditions?.flatMap((child) => flattenConditions(child)) ?? [])]
}

function hasToSQL(value: unknown): value is { toSQL: () => { sql: string; params: unknown[] } } {
  return typeof value === 'object' && value !== null && 'toSQL' in value
}

/**
 * Collects the leaves of a nested `sql` expression. The duration expression is
 * built by a shared helper, so the values it binds sit one level below the
 * fragment this route assembles rather than directly in its own params.
 */
function flattenSqlParams(expression: { sql: string; params: unknown[] }): unknown[] {
  return expression.params.flatMap((param) =>
    hasToSQL(param) ? flattenSqlParams(param.toSQL()) : [param]
  )
}

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/cleanup-stale-executions'
  )
}

describe('stale execution cleanup deadline grace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    cleanupLogger.info.mockReset()
    mockVerifyCronAuth.mockReturnValue(null)
  })

  it('waits five minutes past a workflow execution deadline in both cleanup predicates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:10:00.000Z'))
    queueTableRows(workflowExecutionLogs, [{ id: 'log-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'log-1' }])

    try {
      const response = await GET(createRequest())

      expect(response.status).toBe(200)
      const expectedThreshold = new Date('2026-08-03T12:05:00.000Z')
      const deadlineComparisons = dbChainMockFns.where.mock.calls
        .flatMap(([condition]) => flattenConditions(condition))
        .filter(
          (condition) =>
            condition.type === 'lt' &&
            condition.right instanceof Date &&
            condition.right.getTime() === expectedThreshold.getTime()
        )

      expect(deadlineComparisons).toHaveLength(2)
      expect(deadlineComparisons.map(({ right }) => right)).toEqual([
        expectedThreshold,
        expectedThreshold,
      ])

      const executionUpdateIndex = dbChainMockFns.update.mock.calls.findIndex(
        ([table]) => table === workflowExecutionLogs
      )
      const update = dbChainMockFns.set.mock.calls[executionUpdateIndex]?.[0] as {
        endedAt: Date
        totalDurationMs: { toSQL: () => { sql: string; params: unknown[] } }
        executionData: { toSQL: () => { sql: string; params: unknown[] } }
      }
      const errorExpression = update.executionData.toSQL()
      const staleDurationExpression = errorExpression.params.find(
        (value): value is { toSQL: () => { sql: string; params: unknown[] } } =>
          typeof value === 'object' &&
          value !== null &&
          'toSQL' in value &&
          value.toSQL().sql.includes('EXTRACT(EPOCH')
      )
      const totalDurationLeaves = flattenSqlParams(update.totalDurationMs.toSQL())

      expect(errorExpression.sql).toContain('CASE')
      expect(errorExpression.sql).toContain('IS NOT NULL')
      expect(errorExpression.params).toContain(workflowExecutionLogs.executionDeadlineAt)
      expect(errorExpression.params).toContain('Execution timed out')
      expect(errorExpression.params).toContain(
        'Execution terminated: worker timeout or crash after '
      )
      expect(staleDurationExpression?.toSQL().sql).toContain('ROUND')
      expect(staleDurationExpression?.toSQL().params).toContain(workflowExecutionLogs.startedAt)
      expect(totalDurationLeaves).toContain(2_147_483_647)
      expect(totalDurationLeaves).toContain(workflowExecutionLogs.startedAt)
      expect(totalDurationLeaves).toContainEqual(new Date('2026-08-03T12:10:00.000Z'))
      expect(update.endedAt).toEqual(new Date('2026-08-03T12:10:00.000Z'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a worker cleanup deadline while preserving the generic stale fallback', async () => {
    queueTableRows(asyncJobs, [{ id: 'async-job-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'async-job-1' }])

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    const staleProcessingUpdateIndex = dbChainMockFns.update.mock.calls.findIndex(
      ([table]) => table === asyncJobs
    )
    expect(staleProcessingUpdateIndex).toBeGreaterThanOrEqual(0)

    const update = dbChainMockFns.set.mock.calls[staleProcessingUpdateIndex]?.[0] as {
      error: { toSQL: () => { sql: string; params: unknown[] } }
    }
    const errorExpression = update.error.toSQL()
    const maxDurationGuard = errorExpression.params.find(
      (value): value is { toSQL: () => { sql: string; params: unknown[] } } =>
        typeof value === 'object' && value !== null && 'toSQL' in value
    )
    const durationPredicate = dbChainMockFns.where.mock.calls
      .flatMap(([condition]) => flattenConditions(condition))
      .find((condition) => condition.toSQL?.().sql.includes("interval '1 second'"))
      ?.toSQL?.()

    expect(errorExpression.sql).toContain("->>'maxDurationSeconds'")
    const guardExpression = maxDurationGuard?.toSQL()
    expect(guardExpression?.sql).toContain("jsonb_typeof(?->'maxDurationSeconds') = 'number'")
    expect(guardExpression?.sql).toContain('>=')
    expect(guardExpression?.sql).toContain('trunc(')
    expect(guardExpression?.sql).toContain('<=')
    expect(guardExpression?.params).toContain(MAX_JOB_DURATION_SECONDS)
    expect(guardExpression?.params).toContain(MIN_JOB_DURATION_SECONDS)
    expect(durationPredicate?.sql).toContain('CASE')
    expect(durationPredicate?.sql).toContain('ELSE')
    expect(durationPredicate?.sql).toContain('::double precision')
    expect(errorExpression.sql).toContain("'Job terminated: stuck in processing for more than '")
    expect(errorExpression.sql).toContain("|| ' seconds (worker cleanup deadline)'")
    expect(errorExpression.sql).not.toContain('configured maximum duration')
    expect(errorExpression.params).toContainEqual(
      expect.stringMatching(/^Job terminated: stuck in processing for more than \d+ minutes$/)
    )
  })

  it('keeps table-job heartbeat cleanup independent from workflow timeout policy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    queueTableRows(tableJobs, [{ id: 'table-job-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'table-job-1' }])

    try {
      const response = await GET(createRequest())

      expect(response.status).toBe(200)
      const expectedThreshold = new Date('2026-08-03T10:25:00.000Z')
      const tableJobComparisons = dbChainMockFns.where.mock.calls
        .flatMap(([condition]) => flattenConditions(condition))
        .filter(
          (condition) =>
            condition.type === 'lt' &&
            condition.left === tableJobs.updatedAt &&
            condition.right instanceof Date &&
            condition.right.getTime() === expectedThreshold.getTime()
        )

      expect(tableJobComparisons).toHaveLength(2)
      expect(tableJobComparisons.map(({ right }) => right)).toEqual([
        expectedThreshold,
        expectedThreshold,
      ])

      const tableJobUpdateIndex = dbChainMockFns.update.mock.calls.findIndex(
        ([table]) => table === tableJobs
      )
      const update = dbChainMockFns.set.mock.calls[tableJobUpdateIndex]?.[0] as {
        error: string
      }
      expect(update.error).toBe(
        'Job terminated: no progress for more than 95 minutes (worker timeout or crash)'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('claims every cleanup page without overlapping concurrent workers', async () => {
    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(7)
    expect(dbChainMockFns.for).toHaveBeenCalledTimes(7)
    for (const [strength, options] of dbChainMockFns.for.mock.calls) {
      expect(strength).toBe('update')
      expect(options).toEqual({ skipLocked: true })
    }
  })

  it('caps every bulk mutation and returns only scalar export cleanup fields', async () => {
    const stateBatch = Array.from({ length: 1000 }, (_, index) => ({ id: `state-${index}` }))
    const retentionBatch = Array.from({ length: 2000 }, (_, index) => ({
      id: `retention-${index}`,
    }))
    const exportBatch = Array.from({ length: 100 }, (_, index) => ({
      type: 'export',
      resultKey: `workspace/workspace-1/exports/table-1/job-${index}/export.csv`,
    }))
    const exportCandidates = Array.from({ length: 100 }, (_, index) => ({
      id: `export-${index}`,
    }))

    for (let batch = 0; batch < 10; batch++) {
      const workflowBatch = Array.from({ length: 100 }, (_, index) => ({
        id: `workflow-state-${batch}-${index}`,
      }))
      queueTableRows(workflowExecutionLogs, workflowBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(workflowBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      queueTableRows(asyncJobs, stateBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      queueTableRows(tableJobs, stateBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      queueTableRows(tableJobs, exportCandidates)
      dbChainMockFns.returning.mockResolvedValueOnce(exportBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      queueTableRows(asyncJobs, stateBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      queueTableRows(asyncJobs, retentionBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(retentionBatch)
    }
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      executions: {
        found: 1000,
        cleaned: 1000,
        failed: 0,
      },
      asyncJobs: {
        staleProcessingMarkedFailed: 10_000,
        stalePendingMarkedFailed: 10_000,
        oldDeleted: 20_000,
      },
      tableJobs: {
        staleMarkedFailed: 10_000,
      },
    })
    expect(mockDeleteFile).toHaveBeenCalledTimes(1000)

    const limits = dbChainMockFns.limit.mock.calls.map(([limit]) => limit)
    expect(limits.filter((limit) => limit === 100)).toHaveLength(20)
    expect(limits.filter((limit) => limit === 1000)).toHaveLength(30)
    expect(limits.filter((limit) => limit === 2000)).toHaveLength(11)

    const workflowUpdates = dbChainMockFns.update.mock.calls.filter(
      ([table]) => table === workflowExecutionLogs
    )
    expect(workflowUpdates).toHaveLength(10)

    const returningShapes = dbChainMockFns.returning.mock.calls
      .map(([shape]) => shape)
      .filter((shape): shape is Record<string, unknown> => Boolean(shape))
    expect(returningShapes.some((shape) => 'payload' in shape)).toBe(false)
    expect(returningShapes.some((shape) => 'type' in shape && 'resultKey' in shape)).toBe(true)

    const claimedIds = dbChainMockFns.where.mock.calls
      .flatMap(([condition]) => flattenConditions(condition))
      .filter((condition) => condition.type === 'inArray')
      .map((condition) => condition.values)
    expect(claimedIds.length).toBeGreaterThan(0)
    expect(claimedIds.every((ids) => Array.isArray(ids))).toBe(true)
  })

  it('drains more than the legacy 100-row workflow cap in one bounded run', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `execution-${index}`,
    }))
    const secondBatch = [{ id: 'execution-100' }]
    queueTableRows(workflowExecutionLogs, firstBatch)
    queueTableRows(workflowExecutionLogs, secondBatch)
    dbChainMockFns.returning.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch)

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      executions: {
        found: 101,
        cleaned: 101,
        failed: 0,
      },
    })
    expect(
      dbChainMockFns.update.mock.calls.filter(([table]) => table === workflowExecutionLogs)
    ).toHaveLength(2)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(100)
  })

  it('preserves committed workflow cleanup counts when a later batch fails', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `execution-${index}`,
    }))
    const failedBatch = Array.from({ length: 37 }, (_, index) => ({
      id: `failed-execution-${index}`,
    }))
    queueTableRows(workflowExecutionLogs, firstBatch)
    queueTableRows(workflowExecutionLogs, failedBatch)
    queueTableRows(asyncJobs, [{ id: 'async-job-1' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce(firstBatch)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([{ id: 'async-job-1' }])

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      executions: {
        found: 137,
        cleaned: 100,
        failed: 37,
      },
    })
    expect(
      dbChainMockFns.update.mock.calls.filter(([table]) => table === workflowExecutionLogs)
    ).toHaveLength(2)
    expect(dbChainMockFns.update.mock.calls.some(([table]) => table === asyncJobs)).toBe(true)
  })

  it('does not mark a committed workflow batch as failed when later bookkeeping throws', async () => {
    for (let batch = 0; batch < 10; batch++) {
      const workflowBatch = Array.from({ length: 100 }, (_, index) => ({
        id: `execution-${batch}-${index}`,
      }))
      queueTableRows(workflowExecutionLogs, workflowBatch)
      dbChainMockFns.returning.mockResolvedValueOnce(workflowBatch)
    }
    cleanupLogger.info.mockImplementation((message: string) => {
      if (
        message === 'Deferred remaining stale workflow executions after reaching the per-run cap'
      ) {
        throw new Error('logger unavailable')
      }
    })

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      executions: {
        found: 1000,
        cleaned: 1000,
        failed: 0,
      },
    })
  })

  it('continues draining when an atomic race updates fewer rows than were selected', async () => {
    const firstCandidates = Array.from({ length: 100 }, (_, index) => ({
      id: `execution-${index}`,
    }))
    const firstUpdated = firstCandidates.slice(0, 99)
    const secondBatch = [{ id: 'execution-100' }]
    queueTableRows(workflowExecutionLogs, firstCandidates)
    queueTableRows(workflowExecutionLogs, secondBatch)
    dbChainMockFns.returning.mockResolvedValueOnce(firstUpdated).mockResolvedValueOnce(secondBatch)

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      executions: {
        found: 101,
        cleaned: 100,
        failed: 0,
      },
    })
    expect(
      dbChainMockFns.update.mock.calls.filter(([table]) => table === workflowExecutionLogs)
    ).toHaveLength(2)
  })
})
