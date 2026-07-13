/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  asyncJobs: {
    attempts: 'attempts',
    id: 'id',
  },
  db: dbChainMock.db,
}))

import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

const EXISTING_JOB = {
  id: 'workflow:1',
  type: 'workflow-execution',
  payload: { executionId: 'execution-1' },
  status: 'pending',
  createdAt: new Date('2026-07-10T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
  attempts: 0,
  maxAttempts: 3,
  error: null,
  output: null,
  metadata: {},
}

describe('DatabaseJobQueue enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the deterministic job ID when verification finds an accepted insert', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('connection lost'))
    dbChainMockFns.limit.mockResolvedValueOnce([EXISTING_JOB])
    const queue = new DatabaseJobQueue()

    await expect(
      queue.enqueue('workflow-execution', { executionId: 'execution-1' }, { jobId: 'workflow:1' })
    ).resolves.toBe('workflow:1')
  })

  it('proves non-acceptance when verification succeeds without finding the job', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('insert rejected'))
    dbChainMockFns.limit.mockResolvedValueOnce([])
    const queue = new DatabaseJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'rejected',
      retryable: true,
    })
  })

  it('reports ambiguous acceptance when insert verification also fails', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('connection lost'))
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    const queue = new DatabaseJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'unknown',
      retryable: true,
    })
  })
})
