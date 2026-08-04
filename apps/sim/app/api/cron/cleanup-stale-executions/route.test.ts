/**
 * @vitest-environment node
 */
import { asyncJobs, tableJobs, workflowExecutionLogs } from '@sim/db/schema'
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

interface MockCondition {
  type?: string
  conditions?: unknown[]
  left?: unknown
  right?: unknown
  toSQL?: () => { sql: string; params: unknown[] }
}

function flattenConditions(condition: unknown): MockCondition[] {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as MockCondition
  return [node, ...(node.conditions?.flatMap((child) => flattenConditions(child)) ?? [])]
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
    mockVerifyCronAuth.mockReturnValue(null)
  })

  it('waits five minutes past a workflow execution deadline in both cleanup predicates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:10:00.000Z'))
    queueTableRows(workflowExecutionLogs, [
      {
        id: 'log-1',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        startedAt: new Date('2026-08-03T11:00:00.000Z'),
        executionDeadlineAt: new Date('2026-08-03T12:00:00.000Z'),
      },
    ])
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
        executionData: { toSQL: () => { sql: string; params: unknown[] } }
      }
      const errorExpression = update.executionData.toSQL()

      expect(errorExpression.sql).toContain('CASE')
      expect(errorExpression.sql).toContain('IS NOT NULL')
      expect(errorExpression.params).toContain(workflowExecutionLogs.executionDeadlineAt)
      expect(errorExpression.params).toContain('Execution timed out')
      expect(errorExpression.params).toContain(
        'Execution terminated: worker timeout or crash after 70 minutes'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a worker cleanup deadline while preserving the generic stale fallback', async () => {
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

  it('caps every bulk mutation and returns only scalar export cleanup fields', async () => {
    const stateBatch = Array.from({ length: 1000 }, (_, index) => ({ id: `state-${index}` }))
    const retentionBatch = Array.from({ length: 2000 }, (_, index) => ({
      id: `retention-${index}`,
    }))
    const exportBatch = Array.from({ length: 100 }, (_, index) => ({
      type: 'export',
      resultKey: `workspace/workspace-1/exports/table-1/job-${index}/export.csv`,
    }))

    for (let batch = 0; batch < 10; batch++) {
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      dbChainMockFns.returning.mockResolvedValueOnce(exportBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      dbChainMockFns.returning.mockResolvedValueOnce(stateBatch)
    }
    for (let batch = 0; batch < 10; batch++) {
      dbChainMockFns.returning.mockResolvedValueOnce(retentionBatch)
    }
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
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
    expect(limits.filter((limit) => limit === 100)).toHaveLength(11)
    expect(limits.filter((limit) => limit === 1000)).toHaveLength(30)
    expect(limits.filter((limit) => limit === 2000)).toHaveLength(11)

    const returningShapes = dbChainMockFns.returning.mock.calls
      .map(([shape]) => shape)
      .filter((shape): shape is Record<string, unknown> => Boolean(shape))
    expect(returningShapes.some((shape) => 'payload' in shape)).toBe(false)
    expect(returningShapes.some((shape) => 'type' in shape && 'resultKey' in shape)).toBe(true)
  })
})
