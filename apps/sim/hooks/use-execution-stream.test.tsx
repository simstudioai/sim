/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowExecutionStatusResponse } from '@/lib/api/contracts/workflows'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import {
  processSSEStream,
  SSEStreamInterruptedError,
  useExecutionStream,
} from '@/hooks/use-execution-stream'

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

function recordedExecution(
  status: WorkflowExecutionStatusResponse['status']
): WorkflowExecutionStatusResponse {
  return {
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    status,
    trigger: 'manual',
    level: status === 'failed' ? 'error' : 'info',
    startedAt: '2026-09-08T00:00:00Z',
    endedAt: '2026-09-08T00:00:01Z',
    totalDurationMs: 1000,
    paused: null,
    cost: null,
    error: status === 'failed' ? 'The integration returned an error' : null,
    finalOutput: { answer: 42 },
    blockOutputs: null,
  }
}

describe('reconnect execution outcome recovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['completed', 'failed', 'cancelled', 'paused'] as const)(
    'recovers the recorded %s outcome when the replay buffer expired',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json(recordedExecution(status)))
      vi.stubGlobal('fetch', fetchMock)
      const callbacks = {
        onExecutionCompleted: vi.fn(),
        onExecutionError: vi.fn(),
        onExecutionCancelled: vi.fn(),
        onExecutionPaused: vi.fn(),
      }
      const { result, unmount } = renderExecutionStreamHook()
      await result().reconnect({ workflowId: 'workflow-1', executionId: 'execution-1', callbacks })
      const expected = {
        completed: callbacks.onExecutionCompleted,
        failed: callbacks.onExecutionError,
        cancelled: callbacks.onExecutionCancelled,
        paused: callbacks.onExecutionPaused,
      }[status]
      expect(expected).toHaveBeenCalledOnce()
      for (const callback of Object.values(callbacks)) {
        if (callback !== expected) expect(callback).not.toHaveBeenCalled()
      }
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/workflows/workflow-1/executions/execution-1?includeOutput=true'
      )
      if (status === 'completed')
        expect(expected).toHaveBeenCalledWith(
          expect.objectContaining({ output: { answer: 42 }, duration: 1000 })
        )
      if (status === 'failed')
        expect(expected).toHaveBeenCalledWith({
          error: 'The integration returned an error',
          duration: 1000,
        })
      unmount()
    }
  )

  it.each(['clean-close', 'interrupted'])(
    'checks durable status after a %s without a terminal receipt',
    async (failure) => {
      const stream =
        failure === 'clean-close'
          ? streamEvents([])
          : new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error('Network connection lost'))
              },
            })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(stream))
        .mockResolvedValueOnce(Response.json(recordedExecution('completed')))
      vi.stubGlobal('fetch', fetchMock)
      const onExecutionCompleted = vi.fn()
      const { result, unmount } = renderExecutionStreamHook()
      await result().reconnect({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        callbacks: { onExecutionCompleted },
      })
      expect(onExecutionCompleted).toHaveBeenCalledOnce()
      unmount()
    }
  )

  it('keeps a recorded running execution retryable without manufacturing a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json(recordedExecution('running')))
    )
    const onExecutionError = vi.fn()
    const { result, unmount } = renderExecutionStreamHook()
    await expect(
      result().reconnect({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        callbacks: { onExecutionError },
      })
    ).rejects.toBeInstanceOf(SSEStreamInterruptedError)
    expect(onExecutionError).not.toHaveBeenCalled()
    unmount()
  })

  it.each([401, 403])('does not attempt recovery after access was denied (%s)', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderExecutionStreamHook()
    await expect(
      result().reconnect({ workflowId: 'workflow-1', executionId: 'execution-1' })
    ).rejects.toMatchObject({ httpStatus: status })
    expect(fetchMock).toHaveBeenCalledOnce()
    unmount()
  })

  it('ignores a delayed status result after reconnect is cancelled', async () => {
    let resolveLookup: ((response: Response) => void) | undefined
    const lookup = new Promise<Response>((resolve) => {
      resolveLookup = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockReturnValueOnce(lookup)
    vi.stubGlobal('fetch', fetchMock)
    const onExecutionCompleted = vi.fn()
    const { result, unmount } = renderExecutionStreamHook()
    const reconnect = result().reconnect({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      callbacks: { onExecutionCompleted },
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    result().cancelReconnect('workflow-1', 'execution-1')
    resolveLookup?.(Response.json(recordedExecution('completed')))
    await reconnect
    expect(onExecutionCompleted).not.toHaveBeenCalled()
    unmount()
  })
})

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
