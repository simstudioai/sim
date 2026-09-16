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

/** Table side effects are not exercised here, and the real module loads the table application layer. */
vi.mock('@/lib/copilot/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

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
const listAllWorkspaceFilesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: resolveWorkspaceFileReferenceMock,
  findWorkspaceFileRecord: (
    files: Array<{ name: string; folderPath?: string | null }>,
    path: string
  ) =>
    files.find((file) => {
      const normalized = path.replace(/^files\//, '').replaceAll('%20', ' ')
      const filePath = file.folderPath ? `${file.folderPath}/${file.name}` : file.name
      return filePath === normalized
    }) ?? null,
}))
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: { execute: listAllWorkspaceFilesMock },
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: (
    context: { userId: string; workspaceId: string; toolCallId: string },
    useCase: { execute: (args: unknown) => unknown },
    input: unknown
  ) =>
    useCase.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: context.userId,
        workspaceId: context.workspaceId,
        delegationId: context.toolCallId,
      },
      input,
    }),
}))

vi.mock('@/lib/copilot/tools/server/files/file-preview', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/copilot/tools/server/files/file-preview')
  >('@/lib/copilot/tools/server/files/file-preview')
  return {
    ...actual,
    // Returns the file's preview base as a `WorkspaceFilePreviewBase` ({ text }), NOT a bare string —
    // the adapter reads `previewBase.text` to seed an append/patch base. An empty base ('') is defined,
    // so a base-less append doesn't fail closed.
    loadWorkspaceFileTextForPreview: vi.fn().mockResolvedValue({ text: '' }),
  }
})

import {
  buildPreviewContentUpdate,
  decodeJsonStringPrefix,
  extractEditContent,
  runStreamLoop,
  STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE,
  StreamEndedWithoutTerminalError,
} from '@/lib/copilot/request/go/stream'
import {
  createProviderToolCallIdentity,
  PROVIDER_TOOL_CALL_IDENTITY_LIMITS,
  scopeProviderToolCallId,
} from '@/lib/copilot/request/go/tool-call-identity'
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
    toolPermissions: {
      enabled: false,
      autoAllowed: new Set(),
      autoAllowPermitted: true,
    },
  }
}

/**
 * The turn-scoped execution context exactly as the chat lifecycle builds it: no
 * `toolCallId`, because that identity only exists per dispatched tool call. The
 * file preview adapter has to take it from the frame it is processing.
 */
function turnScopedExecContext(): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    messageId: 'msg-1',
    copilotToolExecution: true,
  }
}

describe('copilot go stream helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    resolveWorkspaceFileReferenceMock.mockReset()
    resolveWorkspaceFileReferenceMock.mockResolvedValue(null)
    listAllWorkspaceFilesMock.mockReset()
    listAllWorkspaceFilesMock.mockResolvedValue({ files: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('terminates the stream on an exhausted identity budget before forwarding later events', async () => {
    const identity = createProviderToolCallIdentity('exhausted-identity-run')
    identity.retainedBytes = PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxRetainedBytes
    const context = createStreamingContext()
    context.providerToolCallIdentity = identity
    const onEvent = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        createEvent({
          streamId: 'identity-budget-stream',
          cursor: '1',
          requestId: 'identity-budget-request',
          seq: 1,
          type: 'tool',
          payload: {
            phase: 'call',
            toolCallId: 'new-call-over-budget',
            toolName: 'glob',
            executor: 'client',
            mode: 'async',
            arguments: { path: 'files' },
          },
        }),
        createEvent({
          streamId: 'identity-budget-stream',
          cursor: '2',
          requestId: 'identity-budget-request',
          seq: 2,
          type: 'complete',
          payload: { status: 'complete' },
        }),
      ])
    )

    await expect(
      runStreamLoop('https://example.com/api/mothership', {}, context, turnScopedExecContext(), {
        timeout: 1000,
        onEvent,
      })
    ).rejects.toThrow('Provider tool call identity budget exceeded')
    expect(onEvent).not.toHaveBeenCalled()
    expect(context.completionStatus).toBeUndefined()
    expect(context.errors).toContain('Provider tool call identity budget exceeded')
  })

  it('namespaces repeated provider IDs before forwarding and checkpoint handling', async () => {
    for (const runId of ['stream-identity-run-1', 'stream-identity-run-2']) {
      const identity = createProviderToolCallIdentity(runId)
      const context = createStreamingContext()
      context.providerToolCallIdentity = identity
      const onEvent = vi.fn()
      vi.mocked(fetch).mockResolvedValueOnce(
        createSseResponse([
          createEvent({
            streamId: 'identity-stream',
            cursor: '1',
            requestId: 'identity-request',
            seq: 1,
            type: 'tool',
            payload: {
              phase: 'call',
              toolCallId: 'shared-provider-call',
              toolName: 'glob',
              executor: 'client',
              mode: 'async',
              arguments: { path: 'files', toolCallId: 'unchanged-user-argument' },
            },
          }),
          createEvent({
            streamId: 'identity-stream',
            cursor: '2',
            requestId: 'identity-request',
            seq: 2,
            type: 'run',
            payload: {
              kind: 'checkpoint_pause',
              checkpointId: 'identity-checkpoint',
              executionId: 'identity-execution',
              runId: 'provider-run',
              pendingToolCallIds: ['shared-provider-call'],
            },
          }),
        ])
      )
      await runStreamLoop(
        'https://example.com/api/mothership',
        {},
        context,
        turnScopedExecContext(),
        { timeout: 1000, onEvent, onBeforeDispatch: (event) => event.type === 'tool' }
      )

      const canonicalId = scopeProviderToolCallId('shared-provider-call', identity)
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool',
          payload: expect.objectContaining({
            toolCallId: canonicalId,
            arguments: { path: 'files', toolCallId: 'unchanged-user-argument' },
          }),
        })
      )
      expect(context.awaitingAsyncContinuation?.pendingToolCallIds).toEqual([canonicalId])
    }
  })

  it('decodes complete escapes and stops at incomplete unicode escapes', () => {
    expect(decodeJsonStringPrefix('hello\\nworld')).toBe('hello\nworld')
    expect(decodeJsonStringPrefix('emoji \\u263A')).toBe('emoji ☺')
    expect(decodeJsonStringPrefix('partial \\u26')).toBe('partial ')
  })

  it('extracts the streamed apply_file_edit prefix from partial JSON', () => {
    expect(extractEditContent('{"content":"hello\\nwor')).toBe('hello\nwor')
    expect(extractEditContent('{"content":"tab\\tvalue"}')).toBe('tab\tvalue')
  })

  /**
   * Append extends its own text, so it deltas like `update` does.
   *
   * It forced a snapshot per emission until the only consumer that could not merge a
   * delta was gone — `apply-file-preview-phase.ts` has accumulated them since #4923.
   * Because an append preview is `existingContent + streamed`, a snapshot per chunk
   * re-sent the whole file on every streamed token, which is `O(file x tokens)` into
   * the stream buffer: one 250 KB file cost gigabytes of Redis.
   */
  it('emits deltas for append when the preview extends the previous text', () => {
    expect(buildPreviewContentUpdate('hello', 'hello world', 100, 200, 'append')).toEqual({
      content: ' world',
      contentMode: 'delta',
      lastSnapshotAt: 100,
    })
  })

  it('still snapshots an append whose base changed underneath it', () => {
    expect(buildPreviewContentUpdate('hello', 'HELLO world', 100, 200, 'append')).toEqual({
      content: 'HELLO world',
      contentMode: 'snapshot',
      lastSnapshotAt: 200,
    })
  })

  it('still checkpoints an append with a full snapshot on the interval', () => {
    expect(buildPreviewContentUpdate('hello', 'hello world', 0, 1_000, 'append')).toEqual({
      content: 'hello world',
      contentMode: 'snapshot',
      lastSnapshotAt: 1_000,
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

  it('hydrates path-based prepare_file_edit edits into file preview events before apply_file_edit streams', async () => {
    listAllWorkspaceFilesMock.mockResolvedValue({
      files: [{ id: 'file-1', name: 'notes.md', folderPath: null }],
    })

    const workspaceFileCall = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'workspace-file-path-1',
        toolName: 'prepare_file_edit',
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
        toolName: 'prepare_file_edit',
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
        toolName: 'apply_file_edit',
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
        toolName: 'apply_file_edit',
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
    const execContext = turnScopedExecContext()

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
    expect(listAllWorkspaceFilesMock).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        workspaceId: 'workspace-1',
      }),
      input: { workspaceId: 'workspace-1', scope: 'active' },
    })
  })

  it('resolves workflow alias paths to the backing file before streaming previews', async () => {
    listAllWorkspaceFilesMock.mockResolvedValue({
      files: [
        {
          id: 'changelog-file-1',
          name: 'changelog.md',
          folderPath: 'workflows/My Workflow',
        },
      ],
    })

    const workspaceFileCall = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'workspace-file-alias-1',
        toolName: 'prepare_file_edit',
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
        toolName: 'apply_file_edit',
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
        toolName: 'apply_file_edit',
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
    const execContext = turnScopedExecContext()

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
      target: { kind: 'file_id', fileId: 'changelog-file-1', fileName: 'changelog.md' },
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
    expect(listAllWorkspaceFilesMock).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        workspaceId: 'workspace-1',
      }),
      input: { workspaceId: 'workspace-1', scope: 'active' },
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
        toolName: 'web_search',
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
        name: 'web_search',
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

    const failure = await runStreamLoop(
      'https://example.com/mothership/stream',
      {},
      context,
      execContext,
      { timeout: 1000 }
    ).then(
      () => undefined,
      (error: unknown) => error
    )

    // The backend answered 200 and ran the leg, so the failure must not
    // masquerade as an HTTP status the resume loop treats as transient.
    expect(failure).toBeInstanceOf(StreamEndedWithoutTerminalError)
    expect(failure).not.toHaveProperty('status')
    expect(failure).toMatchObject({ path: '/mothership/stream' })
    expect((failure as Error).message).toBe(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
    expect(context.errors).toEqual([STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE])
  })

  it('tells the user what happened without promising that a retry helps', () => {
    expect(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE).not.toMatch(/try again/i)
    expect(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE).not.toMatch(/\/api\//)
    expect(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE).toMatch(/saved/i)
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
    expect(context.errors).toEqual([])
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
    ).rejects.toThrow(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)

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
    ).rejects.toThrow(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
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

  it('backfills the display name when only the second subagent start carries it', async () => {
    const scope = {
      lane: 'subagent' as const,
      agentId: 'research',
      parentToolCallId: 'tc-research',
      spanId: 'S3',
      parentSpanId: 'S1',
    }
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse([
        // Dispatch-time start: fires before the trigger args stream, so no name.
        createEvent({
          streamId: 'stream-1',
          cursor: '1',
          seq: 1,
          requestId: 'req-1',
          type: MothershipStreamV1EventType.span,
          scope,
          payload: {
            kind: 'subagent',
            event: 'start',
            agent: 'research',
            data: { tool_call_id: 'tc-research' },
          },
        }),
        // Phase-3 start re-announces the lane WITH the orchestrator-chosen name.
        createEvent({
          streamId: 'stream-1',
          cursor: '2',
          seq: 2,
          requestId: 'req-1',
          type: MothershipStreamV1EventType.span,
          scope,
          payload: {
            kind: 'subagent',
            event: 'start',
            agent: 'research',
            data: { tool_call_id: 'tc-research', name: 'Pricing research' },
          },
        }),
        createEvent({
          streamId: 'stream-1',
          cursor: '3',
          seq: 3,
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

    const subagentBlocks = context.contentBlocks.filter((block) => block.type === 'subagent')
    expect(subagentBlocks).toHaveLength(1)
    expect(subagentBlocks[0]?.subagentName).toBe('Pricing research')
  })
})
