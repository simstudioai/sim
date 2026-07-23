/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { forwardAgentStreamToExecutionEvents } from '@/lib/workflows/streaming/forward-agent-stream-events'
import type { StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent } from '@/providers/stream-events'

function makeStreamingExec(
  onSubscribe: (handler: (event: AgentStreamEvent) => void | Promise<void>) => void,
  unsubscribe = vi.fn()
): StreamingExecution {
  return {
    stream: new ReadableStream(),
    execution: { success: true, output: {} },
    subscribe: (sink: { onEvent: (event: AgentStreamEvent) => void | Promise<void> }) => {
      onSubscribe(sink.onEvent)
      return unsubscribe
    },
  } as StreamingExecution
}

describe('forwardAgentStreamToExecutionEvents', () => {
  it('subscribes in the sync window and maps sink events to execution events', async () => {
    let sinkHandler: ((event: AgentStreamEvent) => void | Promise<void>) | undefined
    const unsubscribe = vi.fn()
    const sendEvent = vi.fn()

    const unsub = forwardAgentStreamToExecutionEvents(
      makeStreamingExec((handler) => {
        sinkHandler = handler
      }, unsubscribe),
      { blockId: 'agent-1', executionId: 'exec-1', workflowId: 'wf-1', sendEvent }
    )

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

    expect(sendEvent).toHaveBeenCalledTimes(3)
    expect(sendEvent.mock.calls[0][0]).toMatchObject({
      type: 'stream:thinking',
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: { blockId: 'agent-1', text: 'plan ' },
    })
    expect(sendEvent.mock.calls[1][0]).toMatchObject({
      type: 'stream:tool',
      data: { blockId: 'agent-1', phase: 'start', id: 't1', name: 'http_request' },
    })
    expect(sendEvent.mock.calls[2][0]).toMatchObject({
      type: 'stream:tool',
      data: { blockId: 'agent-1', phase: 'end', id: 't1', name: 'http_request', status: 'success' },
    })

    unsub()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('never forwards text deltas (answer text rides the byte stream)', async () => {
    let sinkHandler: ((event: AgentStreamEvent) => void | Promise<void>) | undefined
    const sendEvent = vi.fn()

    forwardAgentStreamToExecutionEvents(
      makeStreamingExec((handler) => {
        sinkHandler = handler
      }),
      { blockId: 'agent-1', executionId: 'exec-1', workflowId: 'wf-1', sendEvent }
    )

    await sinkHandler!({ type: 'text_delta', text: 'answer', turn: 'final' })
    await sinkHandler!({ type: 'text_delta', text: 'preamble', turn: 'intermediate' })
    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('no-ops when subscribe is absent', () => {
    const streamingExec = {
      stream: new ReadableStream(),
      execution: { success: true, output: {} },
    } as StreamingExecution

    const unsub = forwardAgentStreamToExecutionEvents(streamingExec, {
      blockId: 'agent-1',
      executionId: 'exec-1',
      workflowId: 'wf-1',
      sendEvent: vi.fn(),
    })
    expect(() => unsub()).not.toThrow()
  })
})
