/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockApiError, mockListRuns, mockResolveTriggerRegion, mockRetrieveRun, mockTrigger } =
  vi.hoisted(() => {
    class MockApiError extends Error {
      constructor(
        readonly status: number | undefined,
        message: string
      ) {
        super(message)
      }
    }

    return {
      MockApiError,
      mockListRuns: vi.fn(),
      mockResolveTriggerRegion: vi.fn(),
      mockRetrieveRun: vi.fn(),
      mockTrigger: vi.fn(),
    }
  })

vi.mock('@trigger.dev/core/v3', () => ({
  taskContext: { isInsideTask: false },
}))

vi.mock('@trigger.dev/sdk', () => ({
  ApiError: MockApiError,
  runs: {
    cancel: vi.fn(),
    list: mockListRuns,
    retrieve: mockRetrieveRun,
  },
  tasks: {
    batchTriggerAndWait: vi.fn(),
    trigger: mockTrigger,
  },
}))

vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))

import { TriggerDevJobQueue } from '@/lib/core/async-jobs/backends/trigger-dev'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

describe('TriggerDevJobQueue enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        tags: ['jobId:workflow:1'],
      })
    )
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

describe('TriggerDevJobQueue getJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a deterministic job ID through its Trigger.dev tag', async () => {
    mockRetrieveRun
      .mockRejectedValueOnce(new MockApiError(404, 'run not found'))
      .mockResolvedValueOnce({
        id: 'run-1',
        taskIdentifier: 'workflow-execution',
        payload: { workflowId: 'workflow-1' },
        status: 'COMPLETED',
        createdAt: '2026-08-05T12:00:00.000Z',
        finishedAt: '2026-08-05T12:00:05.000Z',
        attemptCount: 1,
        output: { output: { answer: 42 } },
      })
    mockListRuns.mockReturnValueOnce(
      (async function* () {
        yield { id: 'run-1' }
      })()
    )
    const queue = new TriggerDevJobQueue()

    const job = await queue.getJob('workflow-execution:execution-1')

    expect(mockListRuns).toHaveBeenCalledWith({
      tag: 'jobId:workflow-execution:execution-1',
      limit: 1,
    })
    expect(mockRetrieveRun).toHaveBeenNthCalledWith(2, 'run-1')
    expect(job).toMatchObject({
      id: 'run-1',
      status: 'completed',
      output: { output: { answer: 42 } },
      metadata: { workflowId: 'workflow-1' },
    })
  })

  it('preserves a cancelled Trigger.dev run as cancelled', async () => {
    mockRetrieveRun.mockResolvedValueOnce({
      id: 'run-cancelled',
      taskIdentifier: 'workflow-execution',
      payload: { workflowId: 'workflow-1' },
      status: 'CANCELED',
      createdAt: '2026-08-05T12:00:00.000Z',
      finishedAt: '2026-08-05T12:00:01.000Z',
      attemptCount: 0,
    })
    const queue = new TriggerDevJobQueue()

    const job = await queue.getJob('run-cancelled')

    expect(job).toMatchObject({ id: 'run-cancelled', status: 'cancelled' })
  })
})
