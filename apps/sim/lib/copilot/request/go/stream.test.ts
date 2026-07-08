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

vi.mock('@/lib/copilot/request/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/request/session')>(
    '@/lib/copilot/request/session'
  )
  return {
    ...actual,
    hasAbortMarker: vi.fn().mockResolvedValue(false),
    upsertFilePreviewSession: vi.fn(async (session) => session),
  }
})

const resolveWorkspaceFileReferenceMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: resolveWorkspaceFileReferenceMock,
}))

vi.mock('@/lib/copilot/tools/server/files/file-preview', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/copilot/tools/server/files/file-preview')
  >('@/lib/copilot/tools/server/files/file-preview')
  return {
    ...actual,
    loadWorkspaceFileTextForPreview: vi.fn().mockResolvedValue(''),
  }
})

import {
  buildPreviewContentUpdate,
  decodeJsonStringPrefix,
  extractEditContent,
  runStreamLoop,
} from '@/lib/copilot/request/go/stream'
import { AbortReason, createEvent, hasAbortMarker } from '@/lib/copilot/request/session'
import { RequestTraceV1Outcome, TraceCollector } from '@/lib/copilot/request/trace'
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
    finalAssistantContent: '',
    sawMainToolCall: false,
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    subagentThinkingBlocks: new Map(),
    isInThinkingBlock: false,
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    activeFileIntents: new Map(),
    trace: new TraceCollector(),
  }
}

describe('copilot go stream helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    resolveWorkspaceFileReferenceMock.mockReset()
    resolveWorkspaceFileReferenceMock.mockResolvedValue(null)
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

  it('hydrates path-based workspace_file edits into file preview events before edit_content streams', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({
      id: 'file-1',
      name: 'notes.md',
    })

    const workspaceFileCall = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'workspace-file-path-1',
        toolName: 'workspace_file',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        arguments: {
          operation: 'update',
          target: { kind: 'path', path: 'files/notes.md' },
          title: 'Update notes',
        },
      },
    })
    const workspaceFileResult = createEvent({
      streamId: 'stream-1',
      cursor: '2',
      seq: 2,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'workspace-file-path-1',
        toolName: 'workspace_file',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: true,
        output: {
          success: true,
          data: { id: 'file-1', name: 'notes.md', operation: 'update' },
        },
      },
    })
    const editContentDelta = createEvent({
      streamId: 'stream-1',
      cursor: '3',
      seq: 3,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'edit-content-path-1',
        toolName: 'edit_content',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.args_delta,
        argumentsDelta: '{"content":"hello world',
      },
    })
    const editContentResult = createEvent({
      streamId: 'stream-1',
      cursor: '4',
      seq: 4,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'edit-content-path-1',
        toolName: 'edit_content',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: true,
        output: {
          success: true,
          data: { id: 'file-1', name: 'notes.md' },
        },
      },
    })
    const complete = createEvent({
      streamId: 'stream-1',
      cursor: '5',
      seq: 5,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.complete,
      },
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        workspaceFileCall,
        workspaceFileResult,
        editContentDelta,
        editContentResult,
        complete,
      ])
    )

    const onEvent = vi.fn()
    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      messageId: 'msg-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      onEvent,
      timeout: 1000,
    })

    const previewEvents = onEvent.mock.calls
      .map(([event]) => event)
      .filter(
        (event) =>
          event.type === MothershipStreamV1EventType.tool && 'previewPhase' in event.payload
      )

    expect(previewEvents.map((event) => event.payload.previewPhase)).toEqual([
      'file_preview_start',
      'file_preview_target',
      'file_preview_content',
      'file_preview_complete',
    ])
    expect(previewEvents[1].payload).toMatchObject({
      previewPhase: 'file_preview_target',
      target: { kind: 'file_id', fileId: 'file-1', fileName: 'notes.md' },
    })
    expect(previewEvents[2].payload).toMatchObject({
      previewPhase: 'file_preview_content',
      fileId: 'file-1',
      targetKind: 'file_id',
      content: 'hello world',
    })
    expect(previewEvents[3].payload).toMatchObject({
      previewPhase: 'file_preview_complete',
      fileId: 'file-1',
    })
    expect(resolveWorkspaceFileReferenceMock).toHaveBeenCalledWith('workspace-1', 'files/notes.md')
  })

  it('resolves workflow alias paths to the backing file before streaming previews', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({
      id: 'changelog-file-1',
      name: 'workflow-1.md',
    })

    const workspaceFileCall = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'workspace-file-alias-1',
        toolName: 'workspace_file',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        arguments: {
          operation: 'append',
          target: { kind: 'path', path: 'workflows/My%20Workflow/changelog.md' },
          title: 'Update changelog',
        },
      },
    })
    const editContentDelta = createEvent({
      streamId: 'stream-1',
      cursor: '2',
      seq: 2,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'edit-content-alias-1',
        toolName: 'edit_content',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.args_delta,
        argumentsDelta: '{"content":"\\n- Added a workflow step',
      },
    })
    const editContentResult = createEvent({
      streamId: 'stream-1',
      cursor: '3',
      seq: 3,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'edit-content-alias-1',
        toolName: 'edit_content',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: true,
        output: {
          success: true,
          data: { id: 'changelog-file-1', name: 'workflow-1.md' },
        },
      },
    })
    const complete = createEvent({
      streamId: 'stream-1',
      cursor: '4',
      seq: 4,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.complete,
      },
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([workspaceFileCall, editContentDelta, editContentResult, complete])
    )

    const onEvent = vi.fn()
    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      messageId: 'msg-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      onEvent,
      timeout: 1000,
    })

    const previewEvents = onEvent.mock.calls
      .map(([event]) => event)
      .filter(
        (event) =>
          event.type === MothershipStreamV1EventType.tool && 'previewPhase' in event.payload
      )

    expect(previewEvents.map((event) => event.payload.previewPhase)).toEqual([
      'file_preview_start',
      'file_preview_target',
      'file_preview_content',
      'file_preview_complete',
    ])
    expect(previewEvents[1].payload).toMatchObject({
      previewPhase: 'file_preview_target',
      target: { kind: 'file_id', fileId: 'changelog-file-1', fileName: 'workflow-1.md' },
    })
    expect(previewEvents[2].payload).toMatchObject({
      previewPhase: 'file_preview_content',
      fileId: 'changelog-file-1',
      targetKind: 'file_id',
      content: '\n- Added a workflow step',
    })
    expect(previewEvents[3].payload).toMatchObject({
      previewPhase: 'file_preview_complete',
      fileId: 'changelog-file-1',
    })
    expect(resolveWorkspaceFileReferenceMock).toHaveBeenCalledWith(
      'workspace-1',
      'workflows/My%20Workflow/changelog.md'
    )
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

  it('does not retry transient backend statuses because stream requests are not idempotent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toMatchObject({
      name: 'CopilotBackendError',
      status: 502,
      body: 'bad gateway',
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-transient backend statuses before the SSE stream opens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('limit reached', { status: 402 }))

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toThrow('Usage limit reached')

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry network errors because Go may already be executing the request', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
      })
    ).rejects.toThrow('fetch failed')

    expect(fetch).toHaveBeenCalledTimes(1)
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

  it('reclassifies as aborted when the body closes without terminal but the abort marker is set', async () => {
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
    vi.mocked(hasAbortMarker).mockResolvedValueOnce(true)

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      timeout: 1000,
    })

    expect(hasAbortMarker).toHaveBeenCalledWith(context.messageId)
    expect(context.wasAborted).toBe(true)
    expect(
      context.errors.some((message) =>
        message.includes('Copilot backend stream ended before a terminal event')
      )
    ).toBe(false)
  })

  it('invokes onAbortObserved with MarkerObservedAtBodyClose when reclassifying via the abort marker', async () => {
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
    vi.mocked(hasAbortMarker).mockResolvedValueOnce(true)

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }
    const onAbortObserved = vi.fn()

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      timeout: 1000,
      onAbortObserved,
    })

    expect(onAbortObserved).toHaveBeenCalledTimes(1)
    expect(onAbortObserved).toHaveBeenCalledWith(AbortReason.MarkerObservedAtBodyClose)
    expect(context.wasAborted).toBe(true)
  })

  it('does not invoke onAbortObserved when no abort marker is present at body close', async () => {
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
    vi.mocked(hasAbortMarker).mockResolvedValueOnce(false)

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }
    const onAbortObserved = vi.fn()

    await expect(
      runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
        timeout: 1000,
        onAbortObserved,
      })
    ).rejects.toThrow('Copilot backend stream ended before a terminal event')

    expect(onAbortObserved).not.toHaveBeenCalled()
  })

  it('still fails closed when the body closes without terminal and the abort marker check throws', async () => {
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
    vi.mocked(hasAbortMarker).mockRejectedValueOnce(new Error('redis unavailable'))

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
    expect(context.wasAborted).toBe(false)
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

  it('records a split canonical request id and go trace id from the stream envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        {
          v: 1,
          type: MothershipStreamV1EventType.text,
          seq: 1,
          ts: '2026-01-01T00:00:00.000Z',
          stream: { streamId: 'stream-1', cursor: '1' },
          trace: {
            requestId: 'sim-request-1',
            goTraceId: 'go-trace-1',
          },
          payload: {
            channel: 'assistant',
            text: 'hello',
          },
        },
        createEvent({
          streamId: 'stream-1',
          cursor: '2',
          seq: 2,
          requestId: 'sim-request-1',
          type: MothershipStreamV1EventType.complete,
          payload: {
            status: MothershipStreamV1CompletionStatus.complete,
          },
        }),
      ])
    )

    const context = createStreamingContext()
    context.requestId = 'sim-request-1'
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      timeout: 1000,
    })

    expect(context.requestId).toBe('sim-request-1')
    expect(
      context.trace.build({
        outcome: RequestTraceV1Outcome.success,
        simRequestId: 'sim-request-1',
      }).goTraceId
    ).toBe('go-trace-1')
  })

  it('records span identity on the subagent block from the scope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        createEvent({
          streamId: 'stream-1',
          cursor: '1',
          seq: 1,
          requestId: 'req-1',
          type: MothershipStreamV1EventType.span,
          scope: {
            lane: 'subagent',
            agentId: 'deploy',
            parentToolCallId: 'tc-deploy-inner',
            spanId: 'S2',
            parentSpanId: 'S1',
          },
          payload: {
            kind: 'subagent',
            event: 'start',
            agent: 'deploy',
            data: { tool_call_id: 'tc-deploy-inner', nested: true },
          },
        }),
        createEvent({
          streamId: 'stream-1',
          cursor: '2',
          seq: 2,
          requestId: 'req-1',
          type: MothershipStreamV1EventType.complete,
          payload: { status: MothershipStreamV1CompletionStatus.complete },
        }),
      ])
    )

    const context = createStreamingContext()
    const execContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }

    await runStreamLoop('https://example.com/mothership/stream', {}, context, execContext, {
      timeout: 1000,
    })

    const subagentBlock = context.contentBlocks.find((block) => block.type === 'subagent')
    expect(subagentBlock).toBeDefined()
    expect(subagentBlock?.spanId).toBe('S2')
    expect(subagentBlock?.parentSpanId).toBe('S1')
    expect(subagentBlock?.parentToolCallId).toBe('tc-deploy-inner')
  })
})
