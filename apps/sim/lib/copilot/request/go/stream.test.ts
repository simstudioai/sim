/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  buildPreviewContentUpdate,
  decodeJsonStringPrefix,
  extractEditContent,
  runStreamLoop,
} from '@/lib/copilot/request/go/stream'
import { createEvent } from '@/lib/copilot/request/session'
import { TraceCollector } from '@/lib/copilot/request/trace'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'

function createSseResponse(events: unknown[]): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    }
  )
}

function createRawSseResponse(payload: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    }
  )
}

function createStreamingContext(): StreamingContext {
  return {
    messageId: 'msg-1',
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentToolCallId: undefined,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    activeFileIntent: null,
    trace: new TraceCollector(),
  }
}

describe('copilot go stream helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes complete escapes and stops at incomplete unicode escapes', () => {
    expect(decodeJsonStringPrefix('hello\\nworld')).toBe('hello\nworld')
    expect(decodeJsonStringPrefix('emoji \\u263A')).toBe('emoji ☺')
    expect(decodeJsonStringPrefix('partial \\u26')).toBe('partial ')
  })

  it('extracts the streamed edit_content prefix from partial JSON', () => {
    expect(extractEditContent('{"content":"hello\\nwor')).toBe('hello\nwor')
    expect(extractEditContent('{"content":"tab\\tvalue"}')).toBe('tab\tvalue')
  })

  it('emits full snapshots for append (sidebar viewer uses replace mode; no delta merge)', () => {
    expect(buildPreviewContentUpdate('hello', 'hello world', 100, 200, 'append')).toEqual({
      content: 'hello world',
      contentMode: 'snapshot',
      lastSnapshotAt: 200,
    })
  })

  it('emits deltas for update when the preview extends the previous text', () => {
    expect(buildPreviewContentUpdate('hello', 'hello world', 100, 200, 'update')).toEqual({
      content: ' world',
      contentMode: 'delta',
      lastSnapshotAt: 100,
    })
  })

  it('falls back to snapshots for patches and divergent content', () => {
    expect(buildPreviewContentUpdate('hello', 'goodbye', 100, 200, 'update')).toEqual({
      content: 'goodbye',
      contentMode: 'snapshot',
      lastSnapshotAt: 200,
    })

    expect(buildPreviewContentUpdate('hello', 'hello world', 100, 200, 'patch')).toEqual({
      content: 'hello world',
      contentMode: 'snapshot',
      lastSnapshotAt: 200,
    })
  })

  it('drops duplicate tool_result events before forwarding them', async () => {
    const toolResult = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'tool-result-dedupe',
        toolName: 'search_online',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: true,
        output: { value: 'ok' },
      },
    })
    const complete = createEvent({
      streamId: 'stream-1',
      cursor: '2',
      seq: 2,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.complete,
      },
    })

    vi.mocked(fetch).mockResolvedValueOnce(createSseResponse([toolResult, toolResult, complete]))

    const onEvent = vi.fn()
    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      onEvent,
      timeout: 1000,
    })

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      MothershipStreamV1EventType.tool,
      MothershipStreamV1EventType.complete,
    ])
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'tool-result-dedupe',
          phase: MothershipStreamV1ToolPhase.result,
        }),
      })
    )
    expect(context.toolCalls.get('tool-result-dedupe')).toEqual(
      expect.objectContaining({
        id: 'tool-result-dedupe',
        name: 'search_online',
        status: MothershipStreamV1ToolOutcome.success,
        result: { success: true, output: { value: 'ok' } },
      })
    )
  })

  it('fails closed when the shared stream ends before a terminal event', async () => {
    const textEvent = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: 'assistant',
        text: 'partial response',
      },
    })

    vi.mocked(fetch).mockResolvedValueOnce(createSseResponse([textEvent]))

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toThrow('Copilot backend stream ended before a terminal event')
    expect(
      context.errors.some((message) =>
        message.includes('Copilot backend stream ended before a terminal event')
      )
    ).toBe(true)
  })

  it('fails closed when the shared stream receives an invalid event', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        {
          v: 1,
          type: MothershipStreamV1EventType.tool,
          seq: 1,
          ts: '2026-01-01T00:00:00.000Z',
          stream: { streamId: 'stream-1', cursor: '1' },
          payload: {
            phase: MothershipStreamV1ToolPhase.result,
          },
        },
      ])
    )

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toThrow('Received invalid stream event on shared path')
    expect(
      context.errors.some((message) =>
        message.includes('Received invalid stream event on shared path')
      )
    ).toBe(true)
  })

  it('fails closed when the shared stream receives malformed JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createRawSseResponse('data: {"v":1,"type":"text","payload":\n\n')
    )

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toThrow('Failed to parse SSE event JSON')
    expect(
      context.errors.some((message) => message.includes('Failed to parse SSE event JSON'))
    ).toBe(true)
  })
})
