/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedBlockOutput } from '@/executor/types'
import { createAgentEventReadableStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'

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

  it('defaults streamFormat to text and can attach agent-events-v1 object streams', async () => {
    const textResult = createStreamingExecution({
      model: 'm',
      providerStartTime,
      providerStartTimeISO,
      timing: { kind: 'simple', segmentName: 'm' },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      createStream: () => new ReadableStream(),
    })
    expect(textResult.streamFormat).toBe('text')

    const events = [
      { type: 'thinking_delta' as const, text: 'reason' },
      { type: 'text_delta' as const, text: 'answer', turn: 'final' as const },
    ]
    const eventResult = createStreamingExecution({
      model: 'm',
      providerStartTime,
      providerStartTimeISO,
      timing: { kind: 'simple', segmentName: 'm' },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { input: 0, output: 0, total: 0 },
      streamFormat: 'agent-events-v1',
      createStream: () => createAgentEventReadableStream(events),
    })

    expect(eventResult.streamFormat).toBe('agent-events-v1')
    const reader = eventResult.stream.getReader()
    const received = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received.push(value)
    }
    expect(received).toEqual(events)
  })
})
