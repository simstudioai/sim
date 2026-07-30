/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'

const { mergeEditIntoLiveFileDocMock, isLiveDocMergeInFlightMock } = vi.hoisted(() => ({
  mergeEditIntoLiveFileDocMock:
    vi.fn<(fileId: string, markdown: string, version?: number) => Promise<void>>(),
  isLiveDocMergeInFlightMock: vi.fn<(fileId: string) => boolean>(),
}))

const { peekFileIntentMock } = vi.hoisted(() => ({
  peekFileIntentMock: vi.fn(),
}))

vi.mock('@/lib/realtime/notify', () => ({
  mergeEditIntoLiveFileDoc: mergeEditIntoLiveFileDocMock,
  isLiveDocMergeInFlight: isLiveDocMergeInFlightMock,
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

describe('processFilePreviewStreamEvent — live-doc streaming merge', () => {
  let state: FilePreviewAdapterState
  let nowMs: number
  const execContext: ExecutionContext = {
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mergeEditIntoLiveFileDocMock.mockResolvedValue(undefined)
    isLiveDocMergeInFlightMock.mockReturnValue(false)
    // Default: an append/patch base is available (a non-empty file), so the base-present gate passes.
    peekFileIntentMock.mockResolvedValue({ existingContent: 'Base.' })
    state = createFilePreviewAdapterState()
    nowMs = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function drive(streamEvent: StreamEvent, intent: ActiveFileIntent) {
    const context = createStreamingContext()
    // channelId resolves to '' when the event carries no scope.
    context.activeFileIntents.set('', intent)
    await processFilePreviewStreamEvent({
      streamId: STREAM_ID,
      streamEvent,
      context,
      execContext,
      options: { onEvent: vi.fn() },
      state,
    })
  }

  it('merges the growing full content (no version arg) into the live doc as it streams', async () => {
    const intent = makeIntent({ operation: 'append', fileId: 'file-grow', fileName: 'notes.md' })

    await drive(editContentDelta('{"content":"Hello'), intent)
    await flushMicrotasks()

    // Advance past the throttle window so the next delta is due for another merge.
    nowMs += 300
    await drive(editContentDelta(' world'), intent)
    await flushMicrotasks()

    expect(mergeEditIntoLiveFileDocMock).toHaveBeenCalledTimes(2)
    const [first, second] = mergeEditIntoLiveFileDocMock.mock.calls
    // A full-file snapshot (base + streamed), never a diff; it grows across deltas; no version arg on
    // either streaming merge — the durable version rides the final edit_content write.
    expect(first[0]).toBe('file-grow')
    expect(first).toHaveLength(2)
    expect(first[1]).toContain('Base.')
    expect(first[1]).toContain('Hello')
    expect(second).toHaveLength(2)
    expect(second[1]).toContain('Hello world')
    expect(second[1].length).toBeGreaterThan(first[1].length)
  })

  it('throttles merges: two deltas within LIVE_DOC_MERGE_THROTTLE_MS yield one merge', async () => {
    const intent = makeIntent({
      operation: 'append',
      fileId: 'file-throttle',
      fileName: 'notes.md',
    })

    await drive(editContentDelta('{"content":"Hel'), intent)
    await flushMicrotasks()

    // 100ms < 250ms throttle → the second snapshot is dropped, not merged.
    nowMs += 100
    await drive(editContentDelta('lo world'), intent)
    await flushMicrotasks()

    expect(mergeEditIntoLiveFileDocMock).toHaveBeenCalledTimes(1)
  })

  it('does not merge for a non-markdown file (no collaborative room)', async () => {
    const intent = makeIntent({ operation: 'append', fileId: 'file-txt', fileName: 'notes.txt' })

    await drive(editContentDelta('{"content":"plain text body'), intent)
    await flushMicrotasks()

    expect(mergeEditIntoLiveFileDocMock).not.toHaveBeenCalled()
  })

  it('does not merge an append before base content loads (base-less-wipe guard)', async () => {
    // No pending intent base is available yet → session.baseContent stays undefined.
    peekFileIntentMock.mockResolvedValue(undefined)
    const intent = makeIntent({ operation: 'append', fileId: 'file-append', fileName: 'notes.md' })

    await drive(editContentDelta('{"content":"\\n- appended line'), intent)
    await flushMicrotasks()

    // A base-less snapshot would diff to a delete-everything wipe of the seeded doc, so it must be skipped.
    expect(mergeEditIntoLiveFileDocMock).not.toHaveBeenCalled()
  })

  it('does not stream an update (from-scratch rewrite) — it would blank the doc mid-stream', async () => {
    const intent = makeIntent({ operation: 'update', fileId: 'file-update', fileName: 'notes.md' })

    await drive(editContentDelta('{"content":"Rewritten intro'), intent)
    await flushMicrotasks()

    // Update streams a partial rewrite; diffing the full doc toward it would delete most of the file
    // until it grows back, so update applies atomically at the final durable write instead.
    expect(mergeEditIntoLiveFileDocMock).not.toHaveBeenCalled()
  })

  it('skips the merge while one is already in flight for the file (does not backlog / advance throttle)', async () => {
    isLiveDocMergeInFlightMock.mockReturnValue(true)
    const intent = makeIntent({ operation: 'append', fileId: 'file-busy', fileName: 'notes.md' })

    await drive(editContentDelta('{"content":"Hello'), intent)
    await flushMicrotasks()

    expect(mergeEditIntoLiveFileDocMock).not.toHaveBeenCalled()

    // The dropped in-flight tick must NOT advance the throttle window, so once the in-flight merge
    // clears the very next delta merges immediately — no wait for a fresh throttle interval.
    isLiveDocMergeInFlightMock.mockReturnValue(false)
    await drive(editContentDelta(' world'), intent)
    await flushMicrotasks()

    expect(mergeEditIntoLiveFileDocMock).toHaveBeenCalledTimes(1)
    expect(mergeEditIntoLiveFileDocMock.mock.calls[0][0]).toBe('file-busy')
  })
})
