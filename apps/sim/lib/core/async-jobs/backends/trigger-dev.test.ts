import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import {
  MockTriggerApiError as MockApiError,
  triggerSdkMockFns,
} from '@sim/testing/mocks/trigger-sdk.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordCancellationResult } = vi.hoisted(() => ({
  mockRecordCancellationResult: vi.fn(),
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordExecutionCancellationBackendResult: mockRecordCancellationResult,
}))

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)

import { TriggerDevJobQueue } from '@/lib/core/async-jobs/backends/trigger-dev'
import { AsyncJobEnqueueError, JOB_PENDING_RETENTION_HOURS } from '@/lib/core/async-jobs/types'

const {
  mockTasksBatchTriggerAndWait: mockBatchTriggerAndWait,
  mockRunsCancel: mockCancel,
  mockRunsList: mockList,
  mockRunsRetrieve: mockRetrieve,
  mockTasksTrigger: mockTrigger,
} = triggerSdkMockFns

const mockLogger = getMockLogger('TriggerDevJobQueue')
const mockResolveTriggerRegion = asyncJobsRegionMockFns.mockResolveTriggerRegion

interface MockListedRun {
  id: string
  tags: string[]
  taskIdentifier?: string
}

function createListPage(items: MockListedRun[]) {
  const runs = items.map((item) => ({
    taskIdentifier: 'workflow-execution',
    ...item,
  }))
  return {
    data: runs,
    async *[Symbol.asyncIterator]() {
      for (const item of runs) yield item
    },
  }
}

function createPaginatedList(pages: MockListedRun[][]) {
  const normalizedPages = pages.map((page) =>
    page.map((item) => ({ taskIdentifier: 'workflow-execution', ...item }))
  )
  return {
    data: normalizedPages[0] ?? [],
    async *[Symbol.asyncIterator]() {
      for (const page of normalizedPages) {
        for (const item of page) yield item
      }
    },
  }
}

describe('TriggerDevJobQueue enqueue', () => {
  beforeEach(() => {
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
  })

  it('uses the provided job ID as the Trigger.dev idempotency key', async () => {
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.enqueue('workflow-execution', { executionId: 'execution-1' }, { jobId: 'workflow:1' })
    ).resolves.toBe('run-1')

    expect(mockTrigger).toHaveBeenCalledWith(
      'workflow-execution',
      { executionId: 'execution-1' },
      expect.objectContaining({
        idempotencyKey: 'workflow:1',
        idempotencyKeyTTL: '14d',
      })
    )
  })

  it('passes the execution timeout and execution ID tag to Trigger.dev', async () => {
    const queue = new TriggerDevJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      {
        maxDurationSeconds: 3600,
        metadata: {
          correlation: {
            executionId: 'execution-1',
            requestId: 'request-1',
            source: 'workflow',
            workflowId: 'workflow-1',
          },
        },
      }
    )

    expect(mockTrigger).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({ executionId: 'execution-1' }),
      expect.objectContaining({
        maxDuration: 3600,
        tags: expect.arrayContaining(['executionId:execution-1', 'workflowId:workflow-1']),
      })
    )
  })

  it('hashes a long execution ID into a valid Trigger.dev tag', async () => {
    const queue = new TriggerDevJobQueue()
    const executionId = 'execution-'.padEnd(128, 'x')

    await queue.enqueue(
      'workflow-execution',
      { executionId },
      {
        metadata: {
          correlation: {
            executionId,
            requestId: 'request-1',
            source: 'workflow',
            workflowId: 'workflow-1',
          },
        },
      }
    )

    const triggerOptions = mockTrigger.mock.calls[0]?.[2] as { tags?: string[] }
    const executionTag = triggerOptions.tags?.find((tag) => tag.startsWith('executionId'))
    expect(executionTag).toMatch(/^executionIdHash:[a-f0-9]{64}$/)
    expect(executionTag?.length).toBeLessThanOrEqual(128)
  })

  it.each([1.5, 4])(
    'rejects invalid execution timeout %s before triggering a run',
    async (maxDurationSeconds) => {
      const queue = new TriggerDevJobQueue()

      const error = await queue
        .enqueue('workflow-execution', {}, { maxDurationSeconds })
        .catch((cause: unknown) => cause)

      expect(error).toMatchObject({ acceptance: 'rejected', retryable: false })
      expect(mockTrigger).not.toHaveBeenCalled()
    }
  )

  it('validates an entire batch before triggering its first run', async () => {
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.batchEnqueue('workflow-execution', [
        { payload: {}, options: { maxDurationSeconds: 60 } },
        { payload: {}, options: { maxDurationSeconds: 1.5 } },
      ])
    ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false })

    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('classifies a client response as proven non-acceptance', async () => {
    mockTrigger.mockRejectedValueOnce(new MockApiError(422, 'invalid payload'))
    const queue = new TriggerDevJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'rejected',
      retryable: false,
    })
  })

  it('classifies a server response as ambiguous and retryable', async () => {
    mockTrigger.mockRejectedValueOnce(new MockApiError(503, 'service unavailable'))
    const queue = new TriggerDevJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'unknown',
      retryable: true,
    })
  })

  it('classifies region resolution failure as proven non-acceptance', async () => {
    mockResolveTriggerRegion.mockRejectedValueOnce(new Error('region unavailable'))
    const queue = new TriggerDevJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'rejected',
      retryable: true,
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })
})

describe('TriggerDevJobQueue status mapping', () => {
  it.each([
    ['PENDING_VERSION', 'pending'],
    ['DELAYED', 'pending'],
    ['QUEUED', 'pending'],
    ['DEQUEUED', 'processing'],
    ['EXECUTING', 'processing'],
    ['WAITING', 'processing'],
  ])('maps active Trigger.dev status %s to %s', async (triggerStatus, jobStatus) => {
    mockRetrieve.mockResolvedValueOnce({
      id: 'run-1',
      payload: {},
      status: triggerStatus,
      taskIdentifier: 'workflow-execution',
    })
    const queue = new TriggerDevJobQueue()

    await expect(queue.getJob('run-1')).resolves.toMatchObject({ status: jobStatus })
  })

  it('dates a run cancelled before it was dequeued by its last transition', async () => {
    mockRetrieve.mockResolvedValueOnce({
      id: 'run-1',
      payload: {},
      status: 'CANCELED',
      taskIdentifier: 'workflow-execution',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      updatedAt: new Date('2026-08-05T12:00:02.000Z'),
    })
    const queue = new TriggerDevJobQueue()

    await expect(queue.getJob('run-1')).resolves.toMatchObject({
      status: 'cancelled',
      startedAt: undefined,
      completedAt: new Date('2026-08-05T12:00:02.000Z'),
    })
  })

  it('prefers the reported finish over the last transition once the run has drained', async () => {
    mockRetrieve.mockResolvedValueOnce({
      id: 'run-1',
      payload: {},
      status: 'COMPLETED',
      taskIdentifier: 'workflow-execution',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      startedAt: new Date('2026-08-05T12:00:01.000Z'),
      finishedAt: new Date('2026-08-05T12:00:04.000Z'),
      updatedAt: new Date('2026-08-05T12:00:09.000Z'),
    })
    const queue = new TriggerDevJobQueue()

    await expect(queue.getJob('run-1')).resolves.toMatchObject({
      status: 'completed',
      completedAt: new Date('2026-08-05T12:00:04.000Z'),
    })
  })
})

describe('TriggerDevJobQueue cancellation', () => {
  beforeEach(() => {
    mockList.mockReturnValue(
      createListPage([
        {
          id: 'run-1',
          tags: ['workflowId:workflow-1', 'executionId:execution-1'],
        },
        {
          id: 'run-2',
          tags: ['workflowId:workflow-1', 'executionId:execution-1'],
        },
      ])
    )
    mockCancel.mockResolvedValue(undefined)
  })

  it('cancels all active runs tagged with the execution ID', async () => {
    const queue = new TriggerDevJobQueue()
    const beforeCancellation = Date.now()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(2)
    const afterCancellation = Date.now()

    expect(mockList).toHaveBeenCalledWith({
      tag: ['workflowId:workflow-1', 'executionId:execution-1'],
      status: ['PENDING_VERSION', 'DELAYED', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING'],
      from: expect.any(Date),
      limit: 25,
    })
    const retentionMs = JOB_PENDING_RETENTION_HOURS * 60 * 60 * 1000
    expect(mockList).toHaveBeenCalledTimes(3)
    for (const [params] of mockList.mock.calls) {
      const from = params.from as Date
      expect(from.getTime()).toBeGreaterThanOrEqual(beforeCancellation - retentionMs)
      expect(from.getTime()).toBeLessThanOrEqual(afterCancellation - retentionMs)
      expect(params.limit).toBe(25)
    }
    expect(mockCancel).toHaveBeenCalledTimes(2)
    expect(mockCancel).toHaveBeenCalledWith('run-1')
    expect(mockCancel).toHaveBeenCalledWith('run-2')
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'trigger_dev',
      result: 'cancelled',
    })
  })

  it('never cancels a workflow-group carrier through standalone execution cancellation', async () => {
    mockList
      .mockReturnValueOnce(
        createListPage([
          {
            id: 'group-carrier',
            tags: ['workflowId:workflow-1', 'executionId:execution-1'],
            taskIdentifier: 'workflow-group-cell',
          },
          {
            id: 'workflow-run',
            tags: ['workflowId:workflow-1', 'executionId:execution-1'],
            taskIdentifier: 'workflow-execution',
          },
        ])
      )
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage([]))
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(1)

    expect(mockCancel).toHaveBeenCalledOnce()
    expect(mockCancel).toHaveBeenCalledWith('workflow-run')
    expect(mockCancel).not.toHaveBeenCalledWith('group-carrier')
  })

  it('targets only resume jobs in resume cancellation scope', async () => {
    mockList
      .mockReturnValueOnce(
        createListPage([
          {
            id: 'workflow-run',
            tags: ['workflowId:workflow-1', 'executionId:execution-1'],
            taskIdentifier: 'workflow-execution',
          },
          {
            id: 'resume-run',
            tags: ['workflowId:workflow-1', 'executionId:execution-1'],
            taskIdentifier: 'resume-execution',
          },
        ])
      )
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage([]))
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution({ workflowId: 'workflow-1', executionId: 'execution-1' }, 'resume')
    ).resolves.toBe(1)

    expect(mockCancel).toHaveBeenCalledOnce()
    expect(mockCancel).toHaveBeenCalledWith('resume-run')
  })

  it('attempts later matches and discovery phases before reporting a partial failure', async () => {
    const taggedRuns = Array.from({ length: 12 }, (_, index) => ({
      id: `run-${index}`,
      tags: ['workflowId:workflow-1', 'executionId:execution-1'],
    }))
    mockList
      .mockReturnValueOnce(createListPage(taggedRuns))
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage([]))
    mockCancel.mockImplementation(async (runId: string) => {
      if (runId === 'run-0') throw new Error('provider unavailable')
    })
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).rejects.toThrow('provider unavailable')

    expect(mockList).toHaveBeenCalledTimes(3)
    expect(mockCancel).toHaveBeenCalledTimes(12)
    expect(mockCancel).toHaveBeenCalledWith('run-11')
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to cancel trigger.dev runs for execution',
      expect.objectContaining({
        cancelledJobs: 11,
        failureCount: 1,
      })
    )
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'trigger_dev',
      result: 'error',
    })
  })

  it('cancels legacy workflow-tagged runs only after payload verification', async () => {
    mockList.mockReturnValueOnce(createListPage([])).mockReturnValueOnce(
      createListPage([
        {
          id: 'matching-run',
          tags: ['workflowId:workflow-1'],
        },
        {
          id: 'other-run',
          tags: ['workflowId:workflow-1'],
        },
      ])
    )
    mockRetrieve
      .mockResolvedValueOnce({
        payload: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
      .mockResolvedValueOnce({
        payload: { workflowId: 'workflow-1', executionId: 'execution-2' },
      })
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(1)

    expect(mockCancel).toHaveBeenCalledOnce()
    expect(mockCancel).toHaveBeenCalledWith('matching-run')
  })

  it('payload-verifies every page of legacy untagged workflow runs', async () => {
    mockList
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(
        createPaginatedList([
          [
            { id: 'other-run', tags: [] },
            { id: 'tagged-run', tags: ['workspaceId:workspace-1'] },
          ],
          [{ id: 'matching-resume-run', tags: [] }],
        ])
      )
    mockRetrieve
      .mockResolvedValueOnce({
        payload: { workflowId: 'workflow-1', executionId: 'execution-2' },
      })
      .mockResolvedValueOnce({
        payload: {
          workflowId: 'workflow-1',
          parentExecutionId: 'execution-1',
          resumeExecutionId: 'execution-1',
        },
      })
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(1)

    expect(mockList).toHaveBeenNthCalledWith(3, {
      taskIdentifier: ['workflow-execution', 'schedule-execution', 'webhook-execution'],
      status: ['PENDING_VERSION', 'DELAYED', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING'],
      from: expect.any(Date),
      limit: 25,
    })
    expect(mockRetrieve).toHaveBeenCalledTimes(2)
    expect(mockRetrieve).not.toHaveBeenCalledWith('tagged-run')
    expect(mockCancel).toHaveBeenCalledOnce()
    expect(mockCancel).toHaveBeenCalledWith('matching-resume-run')
  })

  it('streams every provider page and cancels runs beyond the former scan cap', async () => {
    const taggedRuns = Array.from({ length: 75 }, (_, index) => ({
      id: `run-${index}`,
      tags: ['workflowId:workflow-1', 'executionId:execution-1'],
    }))
    mockList
      .mockReturnValueOnce(
        createPaginatedList([
          taggedRuns.slice(0, 25),
          taggedRuns.slice(25, 50),
          taggedRuns.slice(50),
        ])
      )
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage([]))
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(75)

    expect(mockCancel).toHaveBeenCalledTimes(75)
    expect(mockCancel).toHaveBeenCalledWith('run-50')
    expect(mockCancel).toHaveBeenCalledWith('run-74')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('limits legacy verification and cancellation concurrency to bounded chunks', async () => {
    const legacyRuns = Array.from({ length: 20 }, (_, index) => ({
      id: `legacy-run-${index}`,
      tags: ['workflowId:workflow-1'],
    }))
    mockList
      .mockReturnValueOnce(createListPage([]))
      .mockReturnValueOnce(createListPage(legacyRuns))
      .mockReturnValueOnce(createListPage([]))

    let activeRetrievals = 0
    let maxActiveRetrievals = 0
    mockRetrieve.mockImplementation(async () => {
      activeRetrievals += 1
      maxActiveRetrievals = Math.max(maxActiveRetrievals, activeRetrievals)
      await Promise.resolve()
      activeRetrievals -= 1
      return { payload: { workflowId: 'workflow-1', executionId: 'execution-1' } }
    })

    let activeCancellations = 0
    let maxActiveCancellations = 0
    mockCancel.mockImplementation(async () => {
      activeCancellations += 1
      maxActiveCancellations = Math.max(maxActiveCancellations, activeCancellations)
      await Promise.resolve()
      activeCancellations -= 1
    })
    const queue = new TriggerDevJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(20)

    expect(maxActiveRetrievals).toBe(10)
    expect(maxActiveCancellations).toBe(10)
  })
})
