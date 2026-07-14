/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { attachAgentStreamSink } from '@/lib/workflows/streaming/attach-agent-stream-sink'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { StreamingExecution } from '@/executor/types'

describe('attachAgentStreamSink (Step 10)', () => {
  it('subscribes in sync window and routes thinking/tool events', async () => {
    let sinkHandler: ((event: AgentStreamEvent) => void | Promise<void>) | undefined
    const unsubscribe = vi.fn()
    const streamingExec = {
      stream: new ReadableStream(),
      execution: { success: true, output: {} },
      subscribe: (sink: { onEvent: (event: AgentStreamEvent) => void | Promise<void> }) => {
        sinkHandler = sink.onEvent
        return unsubscribe
      },
    } as StreamingExecution

    const onThinkingDelta = vi.fn()
    const onToolCallStart = vi.fn()
    const onToolCallEnd = vi.fn()

    const unsub = attachAgentStreamSink(streamingExec, {
      onThinkingDelta,
      onToolCallStart,
      onToolCallEnd,
    })

    expect(sinkHandler).toBeTypeOf('function')

    await sinkHandler!({ type: 'thinking_delta', text: 'plan ' })
    await sinkHandler!({ type: 'tool_call_start', id: 't1', name: 'http_request' })
    await sinkHandler!({
      type: 'tool_call_end',
      id: 't1',
      name: 'http_request',
      status: 'success',
    })
    await sinkHandler!({ type: 'text_delta', text: 'hi', turn: 'final' })

    expect(onThinkingDelta).toHaveBeenCalledWith('plan ')
    expect(onToolCallStart).toHaveBeenCalledWith('t1', 'http_request')
    expect(onToolCallEnd).toHaveBeenCalledWith('t1', 'http_request', 'success')

    unsub()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('no-ops when subscribe is absent', () => {
    const streamingExec = {
      stream: new ReadableStream(),
      execution: { success: true, output: {} },
    } as StreamingExecution

    const unsub = attachAgentStreamSink(streamingExec, {
      onThinkingDelta: vi.fn(),
    })
    expect(() => unsub()).not.toThrow()
  })
})
