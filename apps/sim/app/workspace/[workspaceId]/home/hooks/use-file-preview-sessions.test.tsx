/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  buildCompletedPreviewSessions,
  INITIAL_FILE_PREVIEW_SESSIONS_STATE,
  reduceFilePreviewSessions,
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

  it('clears active session when the only session completes', () => {
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

    expect(completed.activeSessionId).toBeNull()
    expect(completed.sessions['preview-1']?.status).toBe('complete')
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
})
