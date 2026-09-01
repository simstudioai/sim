/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import { processSSEStream, useExecutionStream } from '@/hooks/use-execution-stream'

interface HookHarness {
  result: () => ReturnType<typeof useExecutionStream>
  unmount: () => void
}

function renderExecutionStreamHook(): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: ReturnType<typeof useExecutionStream>

  function Probe() {
    latest = useExecutionStream()
    return null
  }

  act(() => root.render(<Probe />))

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

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
        data: { blockId: 'agent-1', text: 'reasoning ' },
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
      text: 'reasoning ',
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

describe('useExecutionStream executeFromBlock', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'X-Execution-Id': 'execution-2' },
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends current draft state and client identity without changing snapshot resume fields', async () => {
    const sourceSnapshot = {
      blockStates: { start: { output: { value: 'cached' } } },
      executedBlocks: ['start'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['start'],
    }
    const workflowStateOverride = {
      blocks: {
        function: {
          id: 'function',
          type: 'function',
          name: 'Function',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {
            code: { id: 'code', type: 'code', value: 'return "current editor state"' },
          },
          outputs: {},
        },
      },
      edges: [
        {
          id: 'start-function',
          source: 'start',
          target: 'function',
          sourceHandle: null,
          targetHandle: null,
        },
      ],
      loops: {},
      parallels: {},
    }
    const { result, unmount } = renderExecutionStreamHook()

    await act(async () => {
      await result().executeFromBlock({
        workflowId: 'workflow-1',
        startBlockId: 'function',
        sourceSnapshot,
        sourceExecutionId: 'execution-1',
        input: { message: 'hello' },
        useDraftState: true,
        isClientSession: true,
        workflowStateOverride,
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows/workflow-1/execute',
      expect.objectContaining({ method: 'POST' })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(request.body as string)).toEqual({
      stream: true,
      input: { message: 'hello' },
      useDraftState: true,
      isClientSession: true,
      workflowStateOverride,
      runFromBlock: {
        startBlockId: 'function',
        executionId: 'execution-1',
        sourceSnapshot,
      },
    })

    unmount()
  })
})
