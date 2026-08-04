/**
 * @vitest-environment node
 */
import { asyncJobs, workflowExecutionLogs } from '@sim/db/schema'
import { createMockRequest, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a configured job duration cap while preserving the generic stale fallback', async () => {
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

    expect(errorExpression.sql).toContain("->>'maxDurationSeconds'")
    expect(errorExpression.sql).toContain(
      "'Job terminated: exceeded configured maximum duration of '"
    )
    expect(errorExpression.sql).toContain("|| ' seconds'")
    expect(errorExpression.params).toContainEqual(
      expect.stringMatching(/^Job terminated: stuck in processing for more than \d+ minutes$/)
    )
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
