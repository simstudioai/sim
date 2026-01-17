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

  it('should wait for specified seconds', async () => {
    const inputs = {
      timeValue: '5',
      timeUnit: 'seconds',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(5000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 5000,
      status: 'completed',
    })
  })

  it('should wait for specified minutes', async () => {
    const inputs = {
      timeValue: '2',
      timeUnit: 'minutes',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(120000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 120000,
      status: 'completed',
    })
  })

  it('should use default values when not provided', async () => {
    const inputs = {}

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(10000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 10000,
      status: 'completed',
    })
  })

  it('should throw error for negative wait times', async () => {
    const inputs = {
      timeValue: '-5',
      timeUnit: 'seconds',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Wait amount must be a positive number'
    )
  })

  it('should throw error for zero wait time', async () => {
    const inputs = {
      timeValue: '0',
      timeUnit: 'seconds',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Wait amount must be a positive number'
    )
  })

  it('should throw error for non-numeric wait times', async () => {
    const inputs = {
      timeValue: 'abc',
      timeUnit: 'seconds',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Wait amount must be a positive number'
    )
  })

  it('should throw error when wait time exceeds maximum (seconds)', async () => {
    const inputs = {
      timeValue: '601',
      timeUnit: 'seconds',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Wait time exceeds maximum of 600 seconds'
    )
  })

  it('should throw error when wait time exceeds maximum (minutes)', async () => {
    const inputs = {
      timeValue: '11',
      timeUnit: 'minutes',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Wait time exceeds maximum of 10 minutes'
    )
  })

  it('should allow maximum wait time of exactly 10 minutes', async () => {
    const inputs = {
      timeValue: '10',
      timeUnit: 'minutes',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(600000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 600000,
      status: 'completed',
    })
  })

  it('should allow maximum wait time of exactly 600 seconds', async () => {
    const inputs = {
      timeValue: '600',
      timeUnit: 'seconds',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(600000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 600000,
      status: 'completed',
    })
  })

  it('should handle cancellation via AbortSignal', async () => {
    const abortController = new AbortController()
    mockContext.abortSignal = abortController.signal

    const inputs = {
      timeValue: '30',
      timeUnit: 'seconds',
    }

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

    const inputs = {
      timeValue: '10',
      timeUnit: 'seconds',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual({
      waitDuration: 10000,
      status: 'cancelled',
    })
  })

  it('should handle partial completion before cancellation', async () => {
    const abortController = new AbortController()
    mockContext.abortSignal = abortController.signal

    const inputs = {
      timeValue: '100',
      timeUnit: 'seconds',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(50000)
    abortController.abort()
    await vi.advanceTimersByTimeAsync(1)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 100000,
      status: 'cancelled',
    })
  })

  it('should handle fractional seconds by converting to integers', async () => {
    const inputs = {
      timeValue: '5.7',
      timeUnit: 'seconds',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(5000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 5000,
      status: 'completed',
    })
  })

  it('should handle very short wait times', async () => {
    const inputs = {
      timeValue: '1',
      timeUnit: 'seconds',
    }

    const executePromise = handler.execute(mockContext, mockBlock, inputs)

    await vi.advanceTimersByTimeAsync(1000)

    const result = await executePromise

    expect(result).toEqual({
      waitDuration: 1000,
      status: 'completed',
    })
  })
})
