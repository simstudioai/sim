import { describe, expect, it } from 'vitest'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import {
  INITIAL_FILE_PREVIEW_SESSIONS_STATE,
  pickActiveSessionId,
  reduceFilePreviewSessions,
  shouldReplaceSession,
} from '@/app/workspace/[workspaceId]/home/hooks/preview/use-file-preview-sessions'

function createSession(
  overrides: Partial<FilePreviewSession> & Pick<FilePreviewSession, 'id' | 'toolCallId'>
): FilePreviewSession {
  return {
    schemaVersion: 1,
    id: overrides.id,
    streamId: overrides.streamId ?? 'stream-1',
    toolCallId: overrides.toolCallId,
    status: overrides.status ?? 'streaming',
    fileName: overrides.fileName ?? `${overrides.id}.md`,
    previewText: overrides.previewText ?? '',
    previewVersion: overrides.previewVersion ?? 1,
    updatedAt: overrides.updatedAt ?? '2026-04-10T00:00:00.000Z',
    ...(overrides.fileId ? { fileId: overrides.fileId } : {}),
    ...(overrides.targetKind ? { targetKind: overrides.targetKind } : {}),
    ...(overrides.operation ? { operation: overrides.operation } : {}),
    ...(overrides.edit ? { edit: overrides.edit } : {}),
    ...(overrides.completedAt ? { completedAt: overrides.completedAt } : {}),
  }
}

describe('reduceFilePreviewSessions', () => {
  it('does not replace a completed session with same-version replayed streaming events', () => {
    const completed = createSession({
      id: 'preview-1',
      toolCallId: 'preview-1',
      status: 'complete',
      previewText: 'final',
      previewVersion: 2,
      updatedAt: '2026-04-10T00:00:02.000Z',
      completedAt: '2026-04-10T00:00:02.000Z',
    })
    const replayedStreaming = createSession({
      id: 'preview-1',
      toolCallId: 'preview-1',
      status: 'streaming',
      previewText: 'final',
      previewVersion: 2,
      updatedAt: '2026-04-10T00:00:03.000Z',
    })

    expect(shouldReplaceSession(completed, replayedStreaming)).toBe(false)
  })

  it('releases the linger when a new non-complete session upserts', () => {
    const lingered = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 2,
        previewText: 'section one',
      }),
    })
    const afterComplete = reduceFilePreviewSessions(lingered, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 3,
        completedAt: '2026-04-10T00:00:02.000Z',
        previewText: 'section one',
      }),
    })

    // New tool call arrives with content — should switch active to the new session.
    const afterNew = reduceFilePreviewSessions(afterComplete, {
      type: 'upsert',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        status: 'streaming',
        previewVersion: 1,
        previewText: 'section two',
      }),
    })

    expect(afterNew.activeSessionId).toBe('preview-2')
  })

  it('holds the linger when an empty pending session arrives (no content yet)', () => {
    const lingered = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 2,
        previewText: 'existing content',
      }),
    })
    const afterComplete = reduceFilePreviewSessions(lingered, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 3,
        completedAt: '2026-04-10T00:00:02.000Z',
        previewText: 'existing content',
      }),
    })

    const afterEmptyUpsert = reduceFilePreviewSessions(afterComplete, {
      type: 'upsert',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        status: 'pending',
        previewVersion: 0,
        previewText: '',
      }),
    })

    expect(afterEmptyUpsert.activeSessionId).toBe('preview-1')
    expect(pickActiveSessionId(afterEmptyUpsert.sessions, null)).toBe('preview-2')

    const afterContent = reduceFilePreviewSessions(afterEmptyUpsert, {
      type: 'upsert',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        status: 'streaming',
        previewVersion: 1,
        previewText: 'new content',
      }),
    })

    expect(afterContent.activeSessionId).toBe('preview-2')
  })

  it('ignores stale complete events for a newer active session', () => {
    const activeState = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 3,
        updatedAt: '2026-04-10T00:00:03.000Z',
      }),
    })

    const staleCompleteState = reduceFilePreviewSessions(activeState, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 2,
        updatedAt: '2026-04-10T00:00:02.000Z',
        completedAt: '2026-04-10T00:00:02.000Z',
      }),
    })

    expect(staleCompleteState.activeSessionId).toBe('preview-1')
    expect(staleCompleteState.sessions['preview-1']?.status).toBe('streaming')
    expect(staleCompleteState.sessions['preview-1']?.previewVersion).toBe(3)
  })

  it('hydrate merges incoming sessions into existing state without replacing non-stale sessions', () => {
    const existing = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 3,
        updatedAt: '2026-04-10T00:00:03.000Z',
        previewText: 'current',
      }),
    })

    const hydrated = reduceFilePreviewSessions(existing, {
      type: 'hydrate',
      sessions: [
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          previewVersion: 2,
          updatedAt: '2026-04-10T00:00:02.000Z',
          previewText: 'stale',
        }),
        createSession({
          id: 'preview-2',
          toolCallId: 'preview-2',
          previewVersion: 1,
          updatedAt: '2026-04-10T00:00:04.000Z',
          previewText: 'new',
        }),
      ],
    })

    expect(hydrated.sessions['preview-1']?.previewVersion).toBe(3)
    expect(hydrated.sessions['preview-1']?.previewText).toBe('current')
    expect(hydrated.sessions['preview-2']?.previewText).toBe('new')
  })

  it('hydrate releases linger when a non-complete session is present in the incoming batch', () => {
    const lingered = reduceFilePreviewSessions(
      reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
        type: 'upsert',
        session: createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          previewVersion: 2,
          previewText: 'final',
        }),
      }),
      {
        type: 'complete',
        session: createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          status: 'complete',
          previewVersion: 3,
          completedAt: '2026-04-10T00:00:02.000Z',
          previewText: 'final',
        }),
      }
    )

    const afterHydrate = reduceFilePreviewSessions(lingered, {
      type: 'hydrate',
      sessions: [
        createSession({
          id: 'preview-2',
          toolCallId: 'preview-2',
          status: 'streaming',
          previewVersion: 1,
          previewText: 'new content',
        }),
      ],
    })

    expect(afterHydrate.activeSessionId).toBe('preview-2')
  })
})
