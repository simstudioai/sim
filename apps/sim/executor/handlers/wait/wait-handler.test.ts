/**
 * @vitest-environment node
 */
import '@sim/testing/mocks/executor'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { WaitBlockHandler } from '@/executor/handlers/wait/wait-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

describe('WaitBlockHandler', () => {
  let handler: WaitBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()

    handler = new WaitBlockHandler()

    mockBlock = {
      id: 'wait-block-1',
      metadata: { id: BlockType.WAIT, name: 'Test Wait' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.WAIT, params: {} },
      inputs: { timeValue: 'string', timeUnit: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle wait blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonWaitBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonWaitBlock)).toBe(false)
  })

  it('should wait in-process for short waits in seconds', async () => {
    const inputs = { timeValue: '5', timeUnit: 'seconds' }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(5000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 5000,
      status: 'completed',
    })
  })

  it('should wait in-process for short waits in minutes', async () => {
    const inputs = { timeValue: '2', timeUnit: 'minutes' }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(120_000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 120_000,
      status: 'completed',
    })
  })

  it('should default to 10 seconds when inputs are not provided', async () => {
    const executePromise = handler.execute(mockContext, mockBlock, {})

    await vi.advanceTimersByTimeAsync(10_000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 10_000,
      status: 'completed',
    })
  })

  it('should reject negative wait amounts', async () => {
    await expect(
      handler.execute(mockContext, mockBlock, { timeValue: '-5', timeUnit: 'seconds' })
    ).rejects.toThrow('Wait amount must be a positive number')
  })

  it('should reject zero wait amounts', async () => {
    await expect(
      handler.execute(mockContext, mockBlock, { timeValue: '0', timeUnit: 'seconds' })
    ).rejects.toThrow('Wait amount must be a positive number')
  })

  it('should reject non-numeric wait amounts', async () => {
    await expect(
      handler.execute(mockContext, mockBlock, { timeValue: 'abc', timeUnit: 'seconds' })
    ).rejects.toThrow('Wait amount must be a positive number')
  })

  it('should reject unknown wait units', async () => {
    await expect(
      handler.execute(mockContext, mockBlock, { timeValue: '5', timeUnit: 'fortnights' })
    ).rejects.toThrow('Unknown wait unit: fortnights')
  })

  it('should reject waits longer than the 30-day ceiling', async () => {
    await expect(
      handler.execute(mockContext, mockBlock, { timeValue: '31', timeUnit: 'days' })
    ).rejects.toThrow('Wait time exceeds maximum of 30 days')
  })

  it('should still execute in-process at the 5-minute boundary', async () => {
    const inputs = { timeValue: '5', timeUnit: 'minutes' }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 5 * 60 * 1000,
      status: 'completed',
    })
  })

  it('should suspend the workflow when wait exceeds the in-process threshold', async () => {
    vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'))

    const inputs = { timeValue: '10', timeUnit: 'minutes' }

    const result = (await handler.execute(mockContext, mockBlock, inputs)) as Record<string, any>

    const waitMs = 10 * 60 * 1000
    const expectedResumeAt = new Date(Date.now() + waitMs).toISOString()

    expect(result.status).toBe('waiting')
    expect(result.waitDuration).toBe(waitMs)
    expect(result.resumeAt).toBe(expectedResumeAt)

    const pauseMetadata = result._pauseMetadata
    expect(pauseMetadata).toBeDefined()
    expect(pauseMetadata.pauseKind).toBe('time')
    expect(pauseMetadata.resumeAt).toBe(expectedResumeAt)
    expect(pauseMetadata.contextId).toBe('wait-block-1')
    expect(pauseMetadata.blockId).toBe('wait-block-1')
    expect(pauseMetadata.response).toEqual({ waitDuration: waitMs, resumeAt: expectedResumeAt })
  })

  it('should suspend the workflow for multi-day waits', async () => {
    vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'))

    const inputs = { timeValue: '2', timeUnit: 'days' }

    const result = (await handler.execute(mockContext, mockBlock, inputs)) as Record<string, any>

    const waitMs = 2 * 24 * 60 * 60 * 1000
    const expectedResumeAt = new Date(Date.now() + waitMs).toISOString()

    expect(result.status).toBe('waiting')
    expect(result.waitDuration).toBe(waitMs)
    expect(result.resumeAt).toBe(expectedResumeAt)
    expect(result._pauseMetadata.pauseKind).toBe('time')
    expect(result._pauseMetadata.resumeAt).toBe(expectedResumeAt)
  })

  it('should accept hours and convert to milliseconds', async () => {
    vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'))

    const result = (await handler.execute(mockContext, mockBlock, {
      timeValue: '3',
      timeUnit: 'hours',
    })) as Record<string, any>

    const waitMs = 3 * 60 * 60 * 1000
    expect(result.waitDuration).toBe(waitMs)
    expect(result.status).toBe('waiting')
    expect(result._pauseMetadata.pauseKind).toBe('time')
  })

  it('should handle cancellation via AbortSignal', async () => {
    const abortController = new AbortController()
    mockContext.abortSignal = abortController.signal

    const inputs = { timeValue: '30', timeUnit: 'seconds' }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(10000)
    abortController.abort()
    await vi.advanceTimersByTimeAsync(1)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 30000,
      status: 'cancelled',
    })
  })

  it('should return cancelled immediately if signal is already aborted', async () => {
    const abortController = new AbortController()
    abortController.abort()
    mockContext.abortSignal = abortController.signal

    const inputs = { timeValue: '10', timeUnit: 'seconds' }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual({
      waitDuration: 10000,
      status: 'cancelled',
    })
  })

  it('should not invoke the in-process sleep when suspending; AbortSignal is irrelevant for long waits', async () => {
    vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'))
    const abortController = new AbortController()
    abortController.abort()
    mockContext.abortSignal = abortController.signal

    const result = (await handler.execute(mockContext, mockBlock, {
      timeValue: '1',
      timeUnit: 'hours',
    })) as Record<string, any>

    expect(result.status).toBe('waiting')
    expect(result._pauseMetadata.pauseKind).toBe('time')
  })

  it('should preserve fractional time values for larger units', async () => {
    const inputs = { timeValue: '5.5', timeUnit: 'seconds' }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(5500)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 5500,
      status: 'completed',
    })
  })

  it('should suspend a 1.5-day wait without truncating', async () => {
    vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'))

    const result = (await handler.execute(mockContext, mockBlock, {
      timeValue: '1.5',
      timeUnit: 'days',
    })) as Record<string, any>

    const waitMs = 1.5 * 24 * 60 * 60 * 1000
    expect(result.waitDuration).toBe(waitMs)
    expect(result.status).toBe('waiting')
    expect(result._pauseMetadata.pauseKind).toBe('time')
  })
})
