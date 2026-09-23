/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'

const { peekFileIntentMock, executeCopilotFileUseCaseMock, resolveFileReferenceMock } = vi.hoisted(
  () => ({
    peekFileIntentMock: vi.fn(),
    executeCopilotFileUseCaseMock: vi.fn(),
    resolveFileReferenceMock: vi.fn(),
  })
)

vi.mock('@/lib/mothership/tools/server/files/file-intent-store', () => ({
  peekFileIntent: peekFileIntentMock,
}))

vi.mock('@/lib/mothership/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: executeCopilotFileUseCaseMock,
  resolveCopilotWorkspaceFileReference: resolveFileReferenceMock,
}))

import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import {
  createFilePreviewAdapterState,
  type FilePreviewAdapterState,
  processFilePreviewStreamEvent,
} from '@/lib/mothership/request/go/file-preview-adapter'
import { createEvent, eventToStreamEvent } from '@/lib/mothership/request/session'
import type {
  ActiveFileIntent,
  ExecutionContext,
  StreamEvent,
} from '@/lib/mothership/request/types'

const STREAM_ID = 'stream-1'
const EDIT_TOOL_CALL_ID = 'edit-content-1'
const WORKSPACE_FILE_TOOL_CALL_ID = 'workspace-file-1'
const BASE_VERSION_MS = 900_000

function toolEvent(payload: Record<string, unknown>): StreamEvent {
  return eventToStreamEvent(
    createEvent({
      streamId: STREAM_ID,
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        ...payload,
      },
    })
  )
}

/** One args_delta chunk of the streamed `apply_file_edit` JSON, as a driveable StreamEvent. */
function editContentDelta(argumentsDelta: string): StreamEvent {
  return toolEvent({
    toolCallId: EDIT_TOOL_CALL_ID,
    toolName: 'apply_file_edit',
    phase: MothershipStreamV1ToolPhase.args_delta,
    argumentsDelta,
  })
}

/** The authoritative `prepare_file_edit` call frame for a path-targeted update. */
function workspaceFileCall(): StreamEvent {
  return toolEvent({
    toolCallId: WORKSPACE_FILE_TOOL_CALL_ID,
    toolName: 'prepare_file_edit',
    phase: MothershipStreamV1ToolPhase.call,
    arguments: {
      operation: 'update',
      title: 'Refresh the runbook',
      target: { kind: 'path', path: 'files/notes.md' },
    },
  })
}

function makeIntent(overrides: {
  operation: string
  fileId?: string
  fileName: string
}): ActiveFileIntent {
  return {
    toolCallId: WORKSPACE_FILE_TOOL_CALL_ID,
    operation: overrides.operation,
    target: {
      kind: 'file_id',
      ...(overrides.fileId ? { fileId: overrides.fileId } : {}),
      fileName: overrides.fileName,
    },
  }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * The copilot preview adapter no longer merges the growing content into the file's live collaborative
 * Y.Doc server-side — that is done client-side by the open editor as minimal CRDT diffs (see
 * `applyStreamedMarkdownToLiveDoc`). These tests guard the surviving contract: the adapter still emits
 * the growing `file_preview_content` events that drive the chat's inline preview.
 */
describe('processFilePreviewStreamEvent — preview content emission', () => {
  let state: FilePreviewAdapterState
  const execContext: ExecutionContext = {
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
  }
  const events: Array<{ payload: Record<string, unknown> }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    // An append base is available (a non-empty file) at durable version BASE_VERSION_MS, so the preview
    // text is composed as base + streamed content.
    peekFileIntentMock.mockResolvedValue({
      existingContent: 'Base.',
      fileRecord: { contentUpdatedAt: new Date(BASE_VERSION_MS) },
    })
    state = createFilePreviewAdapterState()
  })

  async function drive(streamEvent: StreamEvent, intent: ActiveFileIntent) {
    const context = createStreamingContext()
    context.activeFileIntents.set('', intent)
    await processFilePreviewStreamEvent({
      streamId: STREAM_ID,
      streamEvent,
      context,
      execContext,
      options: {
        onEvent: (event) => {
          events.push(event as { payload: Record<string, unknown> })
        },
      },
      state,
    })
  }

  function previewContent(): string {
    return events
      .filter((e) => e.payload?.previewPhase === 'file_preview_content')
      .map((e) => String(e.payload?.content ?? ''))
      .join('')
  }

  it('emits the growing preview content (base + streamed) for an append stream', async () => {
    const intent = makeIntent({ operation: 'append', fileId: 'file-grow', fileName: 'notes.md' })

    await drive(editContentDelta('{"content":"Hello'), intent)
    await flushMicrotasks()
    await drive(editContentDelta(' world'), intent)
    await flushMicrotasks()

    const combined = previewContent()
    expect(combined).toContain('Base.')
    expect(combined).toContain('Hello')
    expect(combined).toContain('world')
  })
})

/**
 * The adapter runs while the tool-call frame is still on the wire, so the
 * execution context it receives is turn-scoped and carries no `toolCallId`.
 * The file delegation requires one, so the adapter has to supply the frame's
 * own id — otherwise resolving the preview target throws, the SSE handler
 * abandons the rest of the event, and the tool call is later dispatched with
 * no arguments at all.
 */
describe('processFilePreviewStreamEvent — preview target resolution', () => {
  const TURN_EXEC_CONTEXT: ExecutionContext = {
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
    copilotToolExecution: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveFileReferenceMock.mockResolvedValue({
      id: 'file-9',
      name: 'notes.md',
      folderPath: null,
    })
  })

  it('resolves the path target under the streaming tool call identity', async () => {
    const context = createStreamingContext()

    await processFilePreviewStreamEvent({
      streamId: STREAM_ID,
      streamEvent: workspaceFileCall(),
      context,
      execContext: TURN_EXEC_CONTEXT,
      options: { onEvent: () => {} },
      state: createFilePreviewAdapterState(),
    })

    expect(resolveFileReferenceMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        copilotToolExecution: true,
        toolCallId: WORKSPACE_FILE_TOOL_CALL_ID,
      }),
      expect.objectContaining({ id: 'files.read_metadata', minimumRole: 'read' }),
      { workspaceId: 'workspace-1', reference: 'files/notes.md' }
    )
    expect(executeCopilotFileUseCaseMock).not.toHaveBeenCalled()
    expect(context.activeFileIntents.get('')?.target).toEqual({
      kind: 'file_id',
      fileId: 'file-9',
      fileName: 'notes.md',
      path: 'files/notes.md',
    })
  })

  it.each([
    new OrchestrationError('not_found', 'File not found'),
    new OrchestrationError('forbidden', 'Access denied'),
    new Error('Workspace file lookup unavailable'),
  ])('keeps the path target and does not throw when resolution fails', async (error) => {
    resolveFileReferenceMock.mockRejectedValue(error)
    const context = createStreamingContext()

    await expect(
      processFilePreviewStreamEvent({
        streamId: STREAM_ID,
        streamEvent: workspaceFileCall(),
        context,
        execContext: TURN_EXEC_CONTEXT,
        options: { onEvent: () => {} },
        state: createFilePreviewAdapterState(),
      })
    ).resolves.toBeUndefined()

    expect(context.activeFileIntents.get('')?.target).toEqual({
      kind: 'path',
      path: 'files/notes.md',
    })
  })
})
