/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  type AgentStreamEvent,
  type AgentStreamSink,
  createAgentEventReadableStream,
} from '@/providers/stream-events'
import { createAgentStreamPump, DEFAULT_MAX_THINKING_CHARS } from '@/providers/stream-pump'

async function readAllText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

function collectingSink() {
  const events: AgentStreamEvent[] = []
  const sink: AgentStreamSink = {
    onEvent: async (event) => {
      events.push(event)
    },
  }
  return { sink, events }
}

describe('createAgentStreamPump', () => {
  it('projects agent-events to final-turn answer text and full sink timeline', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'thinking_delta', text: 'plan ' },
      { type: 'thinking_delta', text: 'it' },
      { type: 'text_delta', text: 'Looking up…', turn: 'intermediate' },
      { type: 'tool_call_start', id: '1', name: 'search' },
      { type: 'tool_call_end', id: '1', name: 'search', status: 'success' },
      { type: 'text_delta', text: 'Done.', turn: 'final' },
    ]

    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream(events),
      streamFormat: 'agent-events-v1',
    })
    const { sink, events: seen } = collectingSink()
    pump.subscribe(sink)

    const textPromise = readAllText(pump.textStream)
    const result = await pump.run()
    const text = await textPromise

    expect(result.answerText).toBe('Done.')
    expect(result.fullyDrained).toBe(true)
    expect(text).toBe('Done.')
    expect(seen).toEqual(events)
  })

  it('treats legacy text streams as final-turn answer bytes and sink text_delta', async () => {
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('Hel'))
        controller.enqueue(encoder.encode('lo'))
        controller.close()
      },
    })

    const pump = createAgentStreamPump({ source, streamFormat: 'text' })
    const { sink, events } = collectingSink()
    pump.subscribe(sink)

    const textPromise = readAllText(pump.textStream)
    const result = await pump.run()

    expect(result.answerText).toBe('Hello')
    expect(await textPromise).toBe('Hello')
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel', turn: 'final' },
      { type: 'text_delta', text: 'lo', turn: 'final' },
    ])
  })

  it('handles UTF-8 characters split across byte chunks', async () => {
    // € in UTF-8 is E2 82 AC — split across two chunks
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xe2, 0x82))
        controller.enqueue(Uint8Array.of(0xac, 0x20, 0x6f, 0x6b))
        controller.close()
      },
    })

    const pump = createAgentStreamPump({ source, streamFormat: 'text' })
    const textPromise = readAllText(pump.textStream)
    const result = await pump.run()

    expect(result.answerText).toBe('€ ok')
    expect(await textPromise).toBe('€ ok')
  })

  it('drops thinking when no sink is subscribed (no unbounded thinking buffer)', async () => {
    const hugeThinking = 'x'.repeat(50_000)
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'thinking_delta', text: hugeThinking },
        { type: 'text_delta', text: 'hi', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
    })

    const textPromise = readAllText(pump.textStream)
    const result = await pump.run()

    expect(result.answerText).toBe('hi')
    expect(await textPromise).toBe('hi')
  })

  it('caps thinking forwarded to sinks', async () => {
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'thinking_delta', text: 'abcdef' },
        { type: 'thinking_delta', text: 'ghijkl' },
        { type: 'text_delta', text: 'out', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
      maxThinkingChars: 4,
    })
    const { sink, events } = collectingSink()
    pump.subscribe(sink)

    const textPromise = readAllText(pump.textStream)
    await pump.run()
    await textPromise

    expect(events.filter((e) => e.type === 'thinking_delta')).toEqual([
      { type: 'thinking_delta', text: 'abcd' },
    ])
    expect(DEFAULT_MAX_THINKING_CHARS).toBeGreaterThan(0)
  })

  it('allows late subscribers to receive only future events', async () => {
    let pullCount = 0
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const source = new ReadableStream<AgentStreamEvent>({
      async pull(controller) {
        pullCount += 1
        if (pullCount === 1) {
          controller.enqueue({ type: 'thinking_delta', text: 'early' })
          await firstGate
          return
        }
        if (pullCount === 2) {
          controller.enqueue({ type: 'text_delta', text: 'late', turn: 'final' })
          return
        }
        controller.close()
      },
    })

    const pump = createAgentStreamPump({ source, streamFormat: 'agent-events-v1' })
    const early = collectingSink()
    pump.subscribe(early.sink)

    const runPromise = pump.run()
    const textPromise = readAllText(pump.textStream)

    // Wait until first event has been dispatched to early sink
    await vi.waitFor(() => {
      expect(early.events.length).toBe(1)
    })

    const late = collectingSink()
    pump.subscribe(late.sink)
    releaseFirst()

    const result = await runPromise
    await textPromise

    expect(early.events.map((e) => e.type)).toEqual(['thinking_delta', 'text_delta'])
    expect(late.events.map((e) => e.type)).toEqual(['text_delta'])
    expect(result.answerText).toBe('late')
  })

  it('unsubscribe mid-stream detaches without failing the pump', async () => {
    const seen: AgentStreamEvent[] = []
    const sink: AgentStreamSink = {
      onEvent: async (event) => {
        seen.push(event)
        if (event.type === 'tool_call_start') {
          unsubscribe()
        }
      },
    }

    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'tool_call_start', id: '1', name: 'x' },
        { type: 'tool_call_end', id: '1', name: 'x', status: 'success' },
        { type: 'text_delta', text: 'ok', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
    })
    const unsubscribe = pump.subscribe(sink)

    const textPromise = readAllText(pump.textStream)
    const result = await pump.run()
    await textPromise

    expect(result.answerText).toBe('ok')
    expect(result.fullyDrained).toBe(true)
    expect(seen.map((e) => e.type)).toEqual(['tool_call_start'])
  })

  it('sinkMode skips text stream and still drains', async () => {
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'text_delta', text: 'only-sink', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    expect(pump.textStream).toBeNull()

    const { sink, events } = collectingSink()
    pump.subscribe(sink)
    const result = await pump.run()

    expect(result.answerText).toBe('only-sink')
    expect(events).toEqual([{ type: 'text_delta', text: 'only-sink', turn: 'final' }])
  })

  it('awaits each sink before pulling the next event (per-event sync)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let inFlight = 0
    let maxInFlight = 0

    const sink: AgentStreamSink = {
      onEvent: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await gate
        inFlight -= 1
      },
    }

    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'text_delta', text: '1', turn: 'final' },
        { type: 'text_delta', text: '2', turn: 'final' },
        { type: 'text_delta', text: '3', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    pump.subscribe(sink)

    const runPromise = pump.run()
    await vi.waitFor(() => {
      expect(maxInFlight).toBe(1)
    })
    release()
    await runPromise
    expect(maxInFlight).toBe(1)
  })

  it('fails the pump on invalid agent-events chunks (no soft success)', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'nope' })
        controller.close()
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })

    await expect(pump.run()).rejects.toThrow(/Invalid AgentStreamEvent/)
  })

  it('fails the pump when the provider source errors', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.error(new Error('provider down'))
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })

    await expect(pump.run()).rejects.toThrow(/provider down/)
  })

  it('maps abort to cancelled result and distinguishes timeout reason', async () => {
    const controller = new AbortController()
    let pullCount = 0
    const source = new ReadableStream<AgentStreamEvent>({
      async pull(ctrl) {
        pullCount += 1
        if (pullCount === 1) {
          ctrl.enqueue({ type: 'thinking_delta', text: '…' })
          controller.abort('timeout')
          return
        }
        ctrl.close()
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
      abortSignal: controller.signal,
    })

    const result = await pump.run()
    expect(result.cancelled).toBe(true)
    expect(result.cancelReason).toBe('timeout')
    expect(result.fullyDrained).toBe(false)
  })

  it('preserves drained answerText when user abort surfaces as AbortError from reader', async () => {
    const controller = new AbortController()
    const source = new ReadableStream<AgentStreamEvent>({
      start(c) {
        c.enqueue({ type: 'text_delta', text: 'kept answer', turn: 'final' })
        c.enqueue({ type: 'thinking_delta', text: 'still thinking' })
        // Abort while the reader is waiting for more — cancel() rejects read().
        queueMicrotask(() => controller.abort('user'))
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
      abortSignal: controller.signal,
    })

    const result = await pump.run()
    expect(result.cancelled).toBe(true)
    expect(result.cancelReason).toBe('user')
    expect(result.answerText).toBe('kept answer')
    expect(result.fullyDrained).toBe(false)
  })

  it('does not start until run() — subscribe-before-pull', async () => {
    let pulled = false
    const source = new ReadableStream<AgentStreamEvent>({
      pull(controller) {
        pulled = true
        controller.enqueue({ type: 'text_delta', text: 'x', turn: 'final' })
        controller.close()
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    const { sink, events } = collectingSink()
    pump.subscribe(sink)

    expect(pulled).toBe(false)
    await pump.run()
    expect(pulled).toBe(true)
    expect(events).toHaveLength(1)
  })

  it('rejects double run()', async () => {
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([{ type: 'text_delta', text: 'a', turn: 'final' }]),
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    await pump.run()
    await expect(pump.run()).rejects.toThrow(/already started/)
  })

  it('detaches a sink that throws without failing the pump', async () => {
    const bad: AgentStreamSink = {
      onEvent: async () => {
        throw new Error('sink exploded')
      },
    }
    const good = collectingSink()

    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'text_delta', text: 'a', turn: 'final' },
        { type: 'text_delta', text: 'b', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    pump.subscribe(bad)
    pump.subscribe(good.sink)

    const result = await pump.run()
    expect(result.answerText).toBe('ab')
    expect(good.events.length).toBe(2)
  })

  it('synthesizes tool_call_end cancelled for open tools on abort', async () => {
    const controller = new AbortController()
    const source = new ReadableStream<AgentStreamEvent>({
      start(c) {
        c.enqueue({ type: 'tool_call_start', id: 't1', name: 'search' })
        c.enqueue({ type: 'thinking_delta', text: 'working' })
        // Never emits tool_call_end — abort mid-flight.
        setTimeout(() => controller.abort('user'), 5)
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
      abortSignal: controller.signal,
    })
    const { sink, events } = collectingSink()
    pump.subscribe(sink)

    const result = await pump.run()
    expect(result.cancelled).toBe(true)
    expect(events).toContainEqual({
      type: 'tool_call_end',
      id: 't1',
      name: 'search',
      status: 'cancelled',
    })
  })

  it('synthesizes tool_call_end error for open tools on source failure', async () => {
    let pulled = 0
    const source = new ReadableStream<AgentStreamEvent>({
      pull(c) {
        pulled += 1
        if (pulled === 1) {
          c.enqueue({ type: 'tool_call_start', id: 't1', name: 'search' })
          return
        }
        c.error(new Error('provider reset'))
      },
    })

    const pump = createAgentStreamPump({
      source,
      streamFormat: 'agent-events-v1',
      sinkMode: true,
    })
    const { sink, events } = collectingSink()
    pump.subscribe(sink)

    await expect(pump.run()).rejects.toThrow('provider reset')
    expect(events).toContainEqual({
      type: 'tool_call_start',
      id: 't1',
      name: 'search',
    })
    expect(events).toContainEqual({
      type: 'tool_call_end',
      id: 't1',
      name: 'search',
      status: 'error',
    })
  })
})

describe('projectStreamingExecutionToByteStream', () => {
  it('projects agent-events final-turn text to UTF-8 bytes', async () => {
    const { projectStreamingExecutionToByteStream } = await import('@/providers/stream-pump')
    const byteStream = projectStreamingExecutionToByteStream({
      stream: createAgentEventReadableStream([
        { type: 'thinking_delta', text: 'secret' },
        { type: 'text_delta', text: 'Looking…', turn: 'intermediate' },
        { type: 'text_delta', text: 'Answer', turn: 'final' },
      ]),
      streamFormat: 'agent-events-v1',
    })

    expect(await readAllText(byteStream)).toBe('Answer')
  })

  it('passes through legacy text byte streams unchanged', async () => {
    const { projectStreamingExecutionToByteStream } = await import('@/providers/stream-pump')
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('raw'))
        c.close()
      },
    })
    const byteStream = projectStreamingExecutionToByteStream({
      stream: source,
      streamFormat: 'text',
    })
    expect(await readAllText(byteStream)).toBe('raw')
  })

  it('aborts the agent pump when the projected byte stream is cancelled', async () => {
    const { projectStreamingExecutionToByteStream } = await import('@/providers/stream-pump')
    let sourceCancelled = false
    let resolveHang!: () => void
    const hang = new Promise<void>((resolve) => {
      resolveHang = resolve
    })

    const source = new ReadableStream<AgentStreamEvent>({
      start(c) {
        c.enqueue({ type: 'text_delta', text: 'hi', turn: 'final' })
      },
      async pull() {
        // Stay open until the pump cancels the source on client disconnect.
        await hang
      },
      cancel() {
        sourceCancelled = true
        resolveHang()
      },
    })

    const byteStream = projectStreamingExecutionToByteStream({
      stream: source,
      streamFormat: 'agent-events-v1',
    })
    const reader = byteStream.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toBe('hi')

    await reader.cancel('client disconnect')
    await hang

    expect(sourceCancelled).toBe(true)
  })
})
