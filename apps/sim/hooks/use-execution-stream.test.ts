/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import { processSSEStream } from '@/hooks/use-execution-stream'

function streamEvents(events: ExecutionEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

describe('processSSEStream', () => {
  it('acknowledges event ids only after the matching handler completes', async () => {
    const order: string[] = []
    const event: ExecutionEvent = {
      type: 'block:started',
      eventId: 5,
      timestamp: new Date().toISOString(),
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: {
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'function',
        executionOrder: 1,
      },
    }

    await processSSEStream(
      streamEvents([event]).getReader(),
      {
        onBlockStarted: async () => {
          order.push('handler:start')
          await Promise.resolve()
          order.push('handler:end')
        },
        onEventId: vi.fn(async () => {
          order.push('event-id')
        }),
      },
      'test'
    )

    expect(order).toEqual(['handler:start', 'handler:end', 'event-id'])
  })

  it('routes stream:thinking and stream:tool without requiring event ids', async () => {
    const onStreamThinking = vi.fn()
    const onStreamTool = vi.fn()
    const onStreamChunk = vi.fn()
    const onEventId = vi.fn()

    const events: ExecutionEvent[] = [
      {
        type: 'stream:thinking',
        timestamp: new Date().toISOString(),
        executionId: 'exec-1',
        workflowId: 'wf-1',
        data: { blockId: 'agent-1', data: 'reasoning ' },
      },
      {
        type: 'stream:tool',
        timestamp: new Date().toISOString(),
        executionId: 'exec-1',
        workflowId: 'wf-1',
        data: {
          blockId: 'agent-1',
          phase: 'start',
          id: 'tool_1',
          name: 'http_request',
        },
      },
      {
        type: 'stream:chunk',
        timestamp: new Date().toISOString(),
        executionId: 'exec-1',
        workflowId: 'wf-1',
        data: { blockId: 'agent-1', chunk: 'answer' },
      },
    ]

    await processSSEStream(
      streamEvents(events).getReader(),
      { onStreamThinking, onStreamTool, onStreamChunk, onEventId },
      'test'
    )

    expect(onStreamThinking).toHaveBeenCalledWith({
      blockId: 'agent-1',
      data: 'reasoning ',
    })
    expect(onStreamTool).toHaveBeenCalledWith({
      blockId: 'agent-1',
      phase: 'start',
      id: 'tool_1',
      name: 'http_request',
    })
    expect(onStreamChunk).toHaveBeenCalledWith({ blockId: 'agent-1', chunk: 'answer' })
    expect(onEventId).not.toHaveBeenCalled()
  })

  it('propagates callback failures without acknowledging the event id', async () => {
    const event: ExecutionEvent = {
      type: 'block:started',
      eventId: 6,
      timestamp: new Date().toISOString(),
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: {
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'function',
        executionOrder: 1,
      },
    }
    const onEventId = vi.fn()

    await expect(
      processSSEStream(
        streamEvents([event]).getReader(),
        {
          onBlockStarted: async () => {
            throw new Error('handler failed')
          },
          onEventId,
        },
        'test'
      )
    ).rejects.toThrow('handler failed')

    expect(onEventId).not.toHaveBeenCalled()
  })

  it('releases the reader lock after the stream completes', async () => {
    const stream = streamEvents([])
    const reader = stream.getReader()
    expect(stream.locked).toBe(true)

    await processSSEStream(reader, {}, 'test')

    expect(stream.locked).toBe(false)
  })

  it('releases the reader lock even when a handler throws', async () => {
    const event: ExecutionEvent = {
      type: 'block:started',
      eventId: 7,
      timestamp: new Date().toISOString(),
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: {
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'function',
        executionOrder: 1,
      },
    }
    const stream = streamEvents([event])
    const reader = stream.getReader()

    await expect(
      processSSEStream(
        reader,
        {
          onBlockStarted: () => {
            throw new Error('boom')
          },
        },
        'test'
      )
    ).rejects.toThrow('boom')

    expect(stream.locked).toBe(false)
  })
})
