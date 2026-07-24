/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  forwardAgentStreamToExecutionEvents,
  shouldForwardAnswerTextFromSink,
} from '@/lib/workflows/streaming/forward-agent-stream-events'
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

  it('does not forward text deltas by default (answer text rides the byte stream)', async () => {
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
    await sinkHandler!({ type: 'turn_end', turn: 'intermediate' })
    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('forwardAnswerText streams live text and resets intermediate turns', async () => {
    let sinkHandler: ((event: AgentStreamEvent) => void | Promise<void>) | undefined
    const sendEvent = vi.fn()

    forwardAgentStreamToExecutionEvents(
      makeStreamingExec((handler) => {
        sinkHandler = handler
      }),
      {
        blockId: 'agent-1',
        executionId: 'exec-1',
        workflowId: 'wf-1',
        sendEvent,
        forwardAnswerText: true,
      }
    )

    // Turn 1: preamble text, then tools follow → reset.
    await sinkHandler!({ type: 'text_delta', text: 'Let me check…', turn: 'pending' })
    await sinkHandler!({ type: 'turn_end', turn: 'intermediate' })
    // Turn 2: final answer.
    await sinkHandler!({ type: 'text_delta', text: 'Answer', turn: 'pending' })
    await sinkHandler!({ type: 'turn_end', turn: 'final' })
    // Intermediate-tagged deltas never forward.
    await sinkHandler!({ type: 'text_delta', text: 'hidden', turn: 'intermediate' })

    const calls = sendEvent.mock.calls.map(([event]) => ({ type: event.type, data: event.data }))
    expect(calls).toEqual([
      { type: 'stream:chunk', data: { blockId: 'agent-1', chunk: 'Let me check…' } },
      { type: 'stream:chunk_reset', data: { blockId: 'agent-1' } },
      { type: 'stream:chunk', data: { blockId: 'agent-1', chunk: 'Answer' } },
    ])
  })

  it('skips chunk_reset when no text was forwarded for the turn', async () => {
    let sinkHandler: ((event: AgentStreamEvent) => void | Promise<void>) | undefined
    const sendEvent = vi.fn()

    forwardAgentStreamToExecutionEvents(
      makeStreamingExec((handler) => {
        sinkHandler = handler
      }),
      {
        blockId: 'agent-1',
        executionId: 'exec-1',
        workflowId: 'wf-1',
        sendEvent,
        forwardAnswerText: true,
      }
    )

    // Tool-only turn (no text) resolves intermediate — nothing to clear.
    await sinkHandler!({ type: 'turn_end', turn: 'intermediate' })
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

describe('shouldForwardAnswerTextFromSink', () => {
  it('requires a sink and an untransformed client stream', () => {
    const base = {
      stream: new ReadableStream(),
      execution: { success: true, output: {} },
    } as StreamingExecution
    const subscribe = () => () => {}

    expect(shouldForwardAnswerTextFromSink(base)).toBe(false)
    expect(shouldForwardAnswerTextFromSink({ ...base, subscribe })).toBe(true)
    expect(
      shouldForwardAnswerTextFromSink({ ...base, subscribe, clientStreamTransformed: true })
    ).toBe(false)
  })
})
