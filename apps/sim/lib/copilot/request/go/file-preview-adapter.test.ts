/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'

const { peekFileIntentMock } = vi.hoisted(() => ({
  peekFileIntentMock: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/server/files/file-intent-store', () => ({
  peekFileIntent: peekFileIntentMock,
}))

import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import {
  createFilePreviewAdapterState,
  type FilePreviewAdapterState,
  processFilePreviewStreamEvent,
} from '@/lib/copilot/request/go/file-preview-adapter'
import { createEvent, eventToStreamEvent } from '@/lib/copilot/request/session'
import type { ActiveFileIntent, ExecutionContext, StreamEvent } from '@/lib/copilot/request/types'

const STREAM_ID = 'stream-1'
const EDIT_TOOL_CALL_ID = 'edit-content-1'
const WORKSPACE_FILE_TOOL_CALL_ID = 'workspace-file-1'
const BASE_VERSION_MS = 900_000

/** One args_delta chunk of the streamed `edit_content` JSON, as a driveable StreamEvent. */
function editContentDelta(argumentsDelta: string): StreamEvent {
  return eventToStreamEvent(
    createEvent({
      streamId: STREAM_ID,
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: EDIT_TOOL_CALL_ID,
        toolName: 'edit_content',
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.args_delta,
        argumentsDelta,
      },
    })
  )
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
