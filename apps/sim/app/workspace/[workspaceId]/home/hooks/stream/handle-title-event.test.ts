/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { parsePersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { handleSessionEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-session-event'
import { createStreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

describe('generated chat title sidebar updates', () => {
  it.each([undefined, 'organization'])(
    'refreshes the owning sidebar and title callback for organization %s',
    (organizationId) => {
      const onTitleUpdate = vi.fn()
      const deps = makeStreamLoopDeps({
        organizationId,
        onTitleUpdateRef: { current: onTitleUpdate },
      })
      const parsed = parsePersistedStreamEventEnvelope({
        v: 1,
        type: 'session',
        seq: 1,
        ts: '2026-09-15T00:00:00.000Z',
        stream: { streamId: 'stream', chatId: 'chat' },
        payload: { kind: 'title', title: 'Workflow planning' },
      })
      if (!parsed.ok || parsed.event.type !== 'session')
        throw new Error('Invalid title event fixture')
      handleSessionEvent(createStreamLoopContext(deps), parsed.event)
      expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: organizationId
          ? mothershipChatKeys.organizationList(organizationId)
          : mothershipChatKeys.list(deps.workspaceId),
      })
      expect(onTitleUpdate).toHaveBeenCalledOnce()
    }
  )
})
