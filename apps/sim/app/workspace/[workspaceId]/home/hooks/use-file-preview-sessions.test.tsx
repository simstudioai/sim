/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  buildCompletedPreviewSessions,
  hasRenderableFilePreviewContent,
  INITIAL_FILE_PREVIEW_SESSIONS_STATE,
  reduceFilePreviewSessions,
  shouldReplaceSession,
} from '@/app/workspace/[workspaceId]/home/hooks/use-file-preview-sessions'

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
  it('does not treat a pending empty preview as renderable content', () => {
    expect(
      hasRenderableFilePreviewContent(
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          status: 'pending',
          previewText: '',
          previewVersion: 0,
        })
      )
    ).toBe(false)
  })

  it('treats emitted preview snapshots as renderable even when empty', () => {
    expect(
      hasRenderableFilePreviewContent(
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          status: 'streaming',
          previewText: '',
          previewVersion: 1,
        })
      )
    ).toBe(true)
  })

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

  it('builds complete sessions for terminal stream reconciliation', () => {
    const completedAt = '2026-04-10T00:00:10.000Z'
    const nextSessions = buildCompletedPreviewSessions(
      {
        'preview-1': createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          status: 'pending',
          previewText: 'draft',
        }),
        'preview-2': createSession({
          id: 'preview-2',
          toolCallId: 'preview-2',
          status: 'streaming',
          previewText: 'partial',
        }),
        'preview-3': createSession({
          id: 'preview-3',
          toolCallId: 'preview-3',
          status: 'complete',
          previewText: 'done',
          completedAt: '2026-04-10T00:00:03.000Z',
        }),
      },
      completedAt
    )

    expect(nextSessions).toHaveLength(2)
    expect(nextSessions.map((session) => session.id)).toEqual(['preview-1', 'preview-2'])
    expect(nextSessions.every((session) => session.status === 'complete')).toBe(true)
    expect(nextSessions.every((session) => session.updatedAt === completedAt)).toBe(true)
    expect(nextSessions.every((session) => session.completedAt === completedAt)).toBe(true)
  })

  it('hydrates the latest active preview session', () => {
    const state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'hydrate',
      sessions: [
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          previewVersion: 1,
          updatedAt: '2026-04-10T00:00:00.000Z',
        }),
        createSession({
          id: 'preview-2',
          toolCallId: 'preview-2',
          previewVersion: 2,
          updatedAt: '2026-04-10T00:00:01.000Z',
          previewText: 'latest',
        }),
      ],
    })

    expect(state.activeSessionId).toBe('preview-2')
    expect(state.sessions['preview-2']?.previewText).toBe('latest')
  })

  it('drops the active session when it completes and promotes the next active session', () => {
    const hydratedState = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'hydrate',
      sessions: [
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          previewVersion: 1,
          updatedAt: '2026-04-10T00:00:00.000Z',
        }),
        createSession({
          id: 'preview-2',
          toolCallId: 'preview-2',
          previewVersion: 2,
          updatedAt: '2026-04-10T00:00:01.000Z',
        }),
      ],
    })
    const completedState = reduceFilePreviewSessions(hydratedState, {
      type: 'complete',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        status: 'complete',
        previewVersion: 3,
        updatedAt: '2026-04-10T00:00:02.000Z',
        completedAt: '2026-04-10T00:00:02.000Z',
      }),
    })

    expect(completedState.activeSessionId).toBe('preview-1')
    expect(completedState.sessions['preview-1']?.id).toBe('preview-1')
  })

  it('lingers on the completed session when it is the only one (no successor)', () => {
    const onlyStreaming = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 2,
        updatedAt: '2026-04-10T00:00:01.000Z',
        previewText: 'final',
      }),
    })

    const completed = reduceFilePreviewSessions(onlyStreaming, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 3,
        updatedAt: '2026-04-10T00:00:02.000Z',
        completedAt: '2026-04-10T00:00:02.000Z',
        previewText: 'final',
      }),
    })

    expect(completed.activeSessionId).toBe('preview-1')
    expect(completed.sessions['preview-1']?.status).toBe('complete')
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

  it('removes a session and clears activeSessionId when the active session is removed', () => {
    const withSession = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 1,
        previewText: 'content',
      }),
    })

    const removed = reduceFilePreviewSessions(withSession, {
      type: 'remove',
      sessionId: 'preview-1',
    })

    expect(removed.activeSessionId).toBeNull()
    expect(removed.sessions['preview-1']).toBeUndefined()
  })

  it('removes a non-active session without changing activeSessionId', () => {
    let state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        previewVersion: 1,
        previewText: 'active',
      }),
    })
    state = reduceFilePreviewSessions(state, {
      type: 'upsert',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        previewVersion: 1,
        previewText: 'inactive',
        status: 'complete',
        completedAt: '2026-04-10T00:00:01.000Z',
      }),
    })

    const removed = reduceFilePreviewSessions(state, {
      type: 'remove',
      sessionId: 'preview-2',
    })

    expect(removed.activeSessionId).toBe('preview-1')
    expect(removed.sessions['preview-2']).toBeUndefined()
    expect(removed.sessions['preview-1']).toBeDefined()
  })

  it('removing a non-existent session is a no-op', () => {
    const state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({ id: 'preview-1', toolCallId: 'preview-1', previewVersion: 1 }),
    })

    const next = reduceFilePreviewSessions(state, { type: 'remove', sessionId: 'does-not-exist' })

    expect(next).toBe(state)
  })

  it('reset clears all sessions and activeSessionId', () => {
    let state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({ id: 'preview-1', toolCallId: 'preview-1', previewVersion: 1 }),
    })
    state = reduceFilePreviewSessions(state, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 2,
        completedAt: '2026-04-10T00:00:02.000Z',
        previewText: 'final',
      }),
    })

    const reset = reduceFilePreviewSessions(state, { type: 'reset' })

    expect(reset.activeSessionId).toBeNull()
    expect(Object.keys(reset.sessions)).toHaveLength(0)
  })

  it('hydrate with an empty sessions array is a no-op', () => {
    const state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({ id: 'preview-1', toolCallId: 'preview-1', previewVersion: 1 }),
    })

    const next = reduceFilePreviewSessions(state, { type: 'hydrate', sessions: [] })

    expect(next).toBe(state)
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

  it('hydrate preserves linger when no non-complete session exists in incoming batch', () => {
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

    // Hydrate with the same completed session — no non-complete successor.
    const afterHydrate = reduceFilePreviewSessions(lingered, {
      type: 'hydrate',
      sessions: [
        createSession({
          id: 'preview-1',
          toolCallId: 'preview-1',
          status: 'complete',
          previewVersion: 3,
          previewText: 'final',
          completedAt: '2026-04-10T00:00:02.000Z',
        }),
      ],
    })

    expect(afterHydrate.activeSessionId).toBe('preview-1')
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

  it('complete for a non-active session updates the session but keeps activeSessionId', () => {
    let state = reduceFilePreviewSessions(INITIAL_FILE_PREVIEW_SESSIONS_STATE, {
      type: 'upsert',
      session: createSession({ id: 'preview-1', toolCallId: 'preview-1', previewVersion: 1 }),
    })
    state = reduceFilePreviewSessions(state, {
      type: 'upsert',
      session: createSession({
        id: 'preview-2',
        toolCallId: 'preview-2',
        previewVersion: 1,
        previewText: 'background',
      }),
    })
    const completed = reduceFilePreviewSessions(state, {
      type: 'complete',
      session: createSession({
        id: 'preview-1',
        toolCallId: 'preview-1',
        status: 'complete',
        previewVersion: 2,
        completedAt: '2026-04-10T00:00:02.000Z',
      }),
    })

    expect(completed.activeSessionId).toBe('preview-2')
    expect(completed.sessions['preview-1']?.status).toBe('complete')
  })
})
