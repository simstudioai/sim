/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockRecordCostCharged, mockRecordFailed } = vi.hoisted(() => ({
  mockRecordCostCharged: vi.fn(),
  mockRecordFailed: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 1, output: 2, total: 3, pricing: {} })),
}))
vi.mock('@/lib/core/config/env-flags', () => ({ getCostMultiplier: () => 1 }))
vi.mock('@/lib/monitoring/metrics', () => ({
  hostedKeyMetrics: { recordCostCharged: mockRecordCostCharged, recordFailed: mockRecordFailed },
}))
vi.mock('@/lib/api-key/hosted-cost', () => ({
  classifyHostedKeyFailure: () => 'other',
}))

import type { NormalizedBlockOutput } from '@/executor/types'
import {
  createStreamingExecution,
  recordHostedStreamFailure,
} from '@/providers/streaming-execution'

/**
 * Builds a fake stream factory mirroring the providers' `createReadableStreamFrom*`
 * helpers: it returns a sentinel stream and synchronously invokes the drain
 * callback so the test can assert the populated output without a real stream.
 */
function fakeStreamFactory(
  drain: (handles: { output: NormalizedBlockOutput; finalizeTiming: () => void }) => void
) {
  const stream = new ReadableStream()
  return {
    stream,
    createStream: (handles: { output: NormalizedBlockOutput; finalizeTiming: () => void }) => {
      drain(handles)
      return stream
    },
  }
}

describe('createStreamingExecution', () => {
  const providerStartTime = 1_000
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  it('settles hosted-key cost on stream drain even when finalizeTiming is never called (post-tool path)', async () => {
    mockRecordCostCharged.mockClear()
    // A source stream that closes immediately, mirroring a drained provider stream.
    const sourceStream = new ReadableStream({ start: (c) => c.close() })

    const result = createStreamingExecution({
      model: 'test-model',
      providerStartTime,
      providerStartTimeISO,
      timing: {
        kind: 'accumulated',
        modelTime: 1,
        toolsTime: 0,
        firstResponseTime: 1,
        iterations: 1,
        timeSegments: [],
      },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      hostedKey: { provider: 'openai', envVar: 'OPENAI_API_KEY_1' },
      cached: false,
      // Post-tool streaming path: sets final tokens but never calls finalizeTiming.
      createStream: ({ output }) => {
        output.tokens = { input: 100, output: 50, total: 150 }
        return sourceStream
      },
    })

    // Cost not settled until the stream is actually drained.
    expect(mockRecordCostCharged).not.toHaveBeenCalled()

    const reader = result.stream.getReader()
    while (!(await reader.read()).done) {
      // drain
    }

    // Settlement ran on drain: cost recomputed from final tokens, metric emitted once.
    expect(result.execution.output.cost).toEqual({ input: 1, output: 2, total: 3, pricing: {} })
    expect(mockRecordCostCharged).toHaveBeenCalledTimes(1)
    expect(mockRecordCostCharged).toHaveBeenCalledWith(3, {
      provider: 'openai',
      tool: 'test-model',
    })
    expect(mockRecordFailed).not.toHaveBeenCalled()
  })

  it('recordHostedStreamFailure records a failure (not cost) when the stream errors', async () => {
    mockRecordCostCharged.mockClear()
    mockRecordFailed.mockClear()
    const boom = new Error('upstream 500')
    const sourceStream = new ReadableStream({ pull: (c) => c.error(boom) })

    const wrapped = recordHostedStreamFailure(
      sourceStream,
      { provider: 'openai', envVar: 'OPENAI_API_KEY_1' },
      'test-model'
    )

    const reader = wrapped.getReader()
    await expect(reader.read()).rejects.toThrow('upstream 500')

    // Failure recorded once; no cost charged for a failed stream.
    expect(mockRecordFailed).toHaveBeenCalledTimes(1)
    expect(mockRecordFailed).toHaveBeenCalledWith({
      provider: 'openai',
      tool: 'test-model',
      key: 'OPENAI_API_KEY_1',
      reason: 'other',
    })
    expect(mockRecordCostCharged).not.toHaveBeenCalled()
  })

  it('recordHostedStreamFailure does not record a failure when the stream completes', async () => {
    mockRecordFailed.mockClear()
    const wrapped = recordHostedStreamFailure(
      new ReadableStream({ start: (c) => c.close() }),
      { provider: 'openai', envVar: 'OPENAI_API_KEY_1' },
      'test-model'
    )
    const reader = wrapped.getReader()
    while (!(await reader.read()).done) {
      // drain
    }
    expect(mockRecordFailed).not.toHaveBeenCalled()
  })

  it('assembles the simple (no-tools) shape and finalizes timing on drain', () => {
    const drainTime = 5_000
    vi.spyOn(Date, 'now').mockReturnValue(drainTime)

    const { stream, createStream } = fakeStreamFactory(({ output, finalizeTiming }) => {
      output.content = 'hello'
      output.tokens = { input: 10, output: 20, total: 30 }
      output.cost = { input: 0.1, output: 0.2, total: 0.3 }
      finalizeTiming()
    })

    const result = createStreamingExecution({
      model: 'test-model',
      providerStartTime,
      providerStartTimeISO,
      timing: { kind: 'simple', segmentName: 'test-model' },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      isStreaming: true,
      createStream,
    })

    expect(result.stream).toBe(stream)

    const output = result.execution.output
    expect(output.content).toBe('hello')
    expect(output.model).toBe('test-model')
    expect(output.tokens).toEqual({ input: 10, output: 20, total: 30 })
    expect(output.cost).toEqual({ input: 0.1, output: 0.2, total: 0.3 })
    expect(output.toolCalls).toBeUndefined()

    const timing = output.providerTiming
    expect(timing?.startTime).toBe(providerStartTimeISO)
    expect(timing?.endTime).toBe(new Date(drainTime).toISOString())
    expect(timing?.duration).toBe(drainTime - providerStartTime)
    expect(timing?.modelTime).toBeUndefined()

    const segment = timing?.timeSegments?.[0]
    expect(segment).toMatchObject({
      type: 'model',
      name: 'test-model',
      startTime: providerStartTime,
    })
    expect(segment?.endTime).toBe(drainTime)
    expect(segment?.duration).toBe(drainTime - providerStartTime)

    expect(result.execution.success).toBe(true)
    expect(result.execution.logs).toEqual([])
    expect(result.execution.isStreaming).toBe(true)
    expect(result.execution.metadata?.startTime).toBe(providerStartTimeISO)

    vi.restoreAllMocks()
  })

  it('assembles the accumulated (post-tools) shape with pre-built segments', () => {
    const drainTime = 7_000
    vi.spyOn(Date, 'now').mockReturnValue(drainTime)

    const timeSegments = [
      { type: 'model' as const, name: 'iter 1', startTime: 1_000, endTime: 2_000, duration: 1_000 },
      { type: 'tool' as const, name: 'lookup', startTime: 2_000, endTime: 2_500, duration: 500 },
    ]

    const { createStream } = fakeStreamFactory(({ output }) => {
      output.content = 'final'
      output.tokens = { input: 110, output: 220, total: 330 }
      output.cost = { input: 1.1, output: 2.2, toolCost: 0.5, total: 3.8 }
    })

    const result = createStreamingExecution({
      model: 'tool-model',
      providerStartTime,
      providerStartTimeISO,
      timing: {
        kind: 'accumulated',
        modelTime: 1_500,
        toolsTime: 500,
        firstResponseTime: 800,
        iterations: 2,
        timeSegments,
      },
      initialTokens: { input: 100, output: 200, total: 300 },
      initialCost: { input: 1, output: 2, toolCost: undefined, total: 3 },
      toolCalls: { list: [{ name: 'lookup' }], count: 1 },
      isStreaming: true,
      createStream,
    })

    const output = result.execution.output
    expect(output.content).toBe('final')
    expect(output.tokens).toEqual({ input: 110, output: 220, total: 330 })
    expect(output.cost).toEqual({ input: 1.1, output: 2.2, toolCost: 0.5, total: 3.8 })
    expect(output.toolCalls).toEqual({ list: [{ name: 'lookup' }], count: 1 })

    const timing = output.providerTiming
    expect(timing?.modelTime).toBe(1_500)
    expect(timing?.toolsTime).toBe(500)
    expect(timing?.firstResponseTime).toBe(800)
    expect(timing?.iterations).toBe(2)
    expect(timing?.timeSegments).toBe(timeSegments)
    expect(timing?.startTime).toBe(providerStartTimeISO)
    expect(timing?.endTime).toBe(new Date(drainTime).toISOString())
    expect(timing?.duration).toBe(drainTime - providerStartTime)

    vi.restoreAllMocks()
  })

  it('only finalizes timing when the provider calls finalizeTiming', () => {
    const constructTime = 1_200
    vi.spyOn(Date, 'now').mockReturnValue(constructTime)

    const result = createStreamingExecution({
      model: 'no-finalize',
      providerStartTime,
      providerStartTimeISO,
      timing: {
        kind: 'accumulated',
        modelTime: 0,
        toolsTime: 0,
        firstResponseTime: 0,
        iterations: 1,
        timeSegments: [],
      },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      createStream: ({ output }) => {
        output.content = 'no-timing-mutation'
        return new ReadableStream()
      },
    })

    const timing = result.execution.output.providerTiming
    expect(timing?.endTime).toBe(new Date(constructTime).toISOString())
    expect(timing?.duration).toBe(constructTime - providerStartTime)
    expect(result.execution.isStreaming).toBeUndefined()

    vi.restoreAllMocks()
  })

  it('finalizeTiming touches only top-level aggregate for accumulated timing', () => {
    const constructTime = 1_000
    const drainTime = 9_000
    const nowMock = vi.spyOn(Date, 'now').mockReturnValue(constructTime)

    const segment = { type: 'model' as const, name: 's', startTime: 1, endTime: 2, duration: 1 }

    const result = createStreamingExecution({
      model: 'm',
      providerStartTime,
      providerStartTimeISO,
      timing: {
        kind: 'accumulated',
        modelTime: 0,
        toolsTime: 0,
        firstResponseTime: 0,
        iterations: 1,
        timeSegments: [segment],
      },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      createStream: ({ finalizeTiming }) => {
        nowMock.mockReturnValue(drainTime)
        finalizeTiming()
        return new ReadableStream()
      },
    })

    const timing = result.execution.output.providerTiming
    expect(timing?.endTime).toBe(new Date(drainTime).toISOString())
    expect(timing?.duration).toBe(drainTime - providerStartTime)
    expect(timing?.timeSegments?.[0]).toEqual({
      type: 'model',
      name: 's',
      startTime: 1,
      endTime: 2,
      duration: 1,
    })

    vi.restoreAllMocks()
  })
})
