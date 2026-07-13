/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockApiError, mockResolveTriggerRegion, mockTrigger } = vi.hoisted(() => {
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
    mockResolveTriggerRegion: vi.fn(),
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
    retrieve: vi.fn(),
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
