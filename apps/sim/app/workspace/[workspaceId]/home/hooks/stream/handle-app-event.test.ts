/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  clearFullstackPreviewSession,
  getFullstackLifecycleState,
  resetFullstackLifecycleForChat,
} from '@/app/workspace/[workspaceId]/home/hooks/fullstack-lifecycle-store'
import { appKeys } from '@/hooks/queries/apps'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { handleAppEvent } from './handle-app-event'
import type { StreamLoopContext } from './stream-context'

describe('handleAppEvent', () => {
  const invalidateQueries = vi.fn()
  const chatIdRef = { current: 'chat-1' as string | undefined }

  function makeCtx(): StreamLoopContext {
    return {
      state: {} as StreamLoopContext['state'],
      deps: {
        workspaceId: 'ws-1',
        queryClient: { invalidateQueries } as unknown as StreamLoopContext['deps']['queryClient'],
        chatIdRef,
      } as StreamLoopContext['deps'],
      ops: {} as StreamLoopContext['ops'],
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    chatIdRef.current = 'chat-1'
    resetFullstackLifecycleForChat('chat-1')
  })

  it('invalidates app and linked-chat caches for known lifecycle events', () => {
    const event = {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.release.published',
        payload: { projectId: 'proj-1', releaseId: 'rel-1' },
      },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>

    handleAppEvent(makeCtx(), event)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appKeys.list('ws-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appKeys.detail('proj-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: mothershipChatKeys.list('ws-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.detail('chat-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(4)
  })

  it('ignores unknown app event names', () => {
    const event = {
      type: MothershipStreamV1EventType.app,
      payload: { event: 'app.unknown', payload: { projectId: 'proj-1' } },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>

    handleAppEvent(makeCtx(), event)
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('updates Full-stack lifecycle state for preview-ready envelopes', () => {
    const event = {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.preview.ready',
        payload: {
          projectId: 'proj-1',
          revisionId: 'rev-1',
          sessionId: 'session-1',
          channelNonce: 'nonce-1',
          buildId: 'build-1',
          appPublicOrigin: 'https://apps.test',
        },
      },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>

    handleAppEvent(makeCtx(), event)

    const lifecycle = getFullstackLifecycleState()
    expect(lifecycle.phase).toBe('preview_ready')
    expect(lifecycle.destination).toBe('preview')
    expect(lifecycle.preview?.sessionId).toBe('session-1')
    expect(lifecycle.preview?.previewSrc).toContain('/__sim/preview/session-1/nonce-1/')
  })

  it('settles on preview_ready when build finishes before preview activation', () => {
    const ctx = makeCtx()
    handleAppEvent(ctx, {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.build.finished',
        payload: { projectId: 'proj-1', revisionId: 'rev-1', buildId: 'build-1' },
      },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>)
    handleAppEvent(ctx, {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.preview.ready',
        payload: {
          projectId: 'proj-1',
          revisionId: 'rev-1',
          sessionId: 'session-1',
          channelNonce: 'nonce-1',
          buildId: 'build-1',
          appPublicOrigin: 'https://apps.test',
        },
      },
      seq: 2,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:01Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>)

    expect(getFullstackLifecycleState().phase).toBe('preview_ready')
  })

  it('clears the updating phase on typed generation failure', () => {
    const event = {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.generation.failed',
        payload: { projectId: 'proj-1', message: 'Build failed' },
      },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>

    handleAppEvent(makeCtx(), event)

    expect(getFullstackLifecycleState()).toEqual(
      expect.objectContaining({
        phase: 'failed',
        statusMessage: 'Build failed',
      })
    )
  })

  it('evicts a stopped preview session so builder hydration can mint a fresh one', () => {
    handleAppEvent(makeCtx(), {
      type: MothershipStreamV1EventType.app,
      payload: {
        event: 'app.preview.ready',
        payload: {
          projectId: 'proj-1',
          revisionId: 'rev-1',
          sessionId: 'session-1',
          channelNonce: 'nonce-1',
          appPublicOrigin: 'https://apps.test',
        },
      },
      seq: 1,
      stream: { streamId: 's' },
      ts: '2026-01-01T00:00:00Z',
      v: 1,
    } as unknown as Extract<PersistedStreamEventEnvelope, { type: 'app' }>)

    clearFullstackPreviewSession('session-1')

    expect(getFullstackLifecycleState()).toEqual(
      expect.objectContaining({
        preview: null,
        phase: 'building_app',
        statusMessage: 'Opening a fresh preview…',
      })
    )
  })
})
