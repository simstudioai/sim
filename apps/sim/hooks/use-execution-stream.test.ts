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
})
