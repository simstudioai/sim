/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
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

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appKeys.all })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appKeys.list('ws-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appKeys.detail('proj-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: mothershipChatKeys.list('ws-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: mothershipChatKeys.detail('chat-1') })
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
})
