/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1SessionKind } from '@/lib/mothership/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { handleSessionEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-session-event'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'

function chatSessionEvent(chatId: string): PersistedStreamEventEnvelope {
  return {
    type: 'session',
    v: 1,
    seq: 1,
    ts: '2026-01-01T00:00:00Z',
    stream: { streamId: 'stream-1', chatId },
    payload: { kind: MothershipStreamV1SessionKind.chat, chatId },
  } as PersistedStreamEventEnvelope
}

describe('handleSessionEvent', () => {
  it.each([
    ['assistant', '/o/organization-1/search/chat/chat-new'],
    ['agent', '/o/organization-1/chat/chat-new'],
    ['plan', '/o/organization-1/chat/chat-new'],
  ] as const)(
    'keeps a newly created %s conversation on its owning surface',
    (requestMode, path) => {
      window.history.replaceState(null, '', '/o/organization-1/search?view=assistant')
      const deps = { ...makeStreamLoopDeps(), organizationId: 'organization-1', requestMode }
      handleSessionEvent({ deps } as StreamLoopContext, chatSessionEvent('chat-new') as never)
      expect(window.location.pathname).toBe(path)
    }
  )

  it('adopts a newly assigned chat before chatIdRef is written', () => {
    const deps = makeStreamLoopDeps()
    deps.workflowIdRef.current = 'workflow-1'
    vi.mocked(deps.adoptResolvedChatId).mockImplementation((chatId) => {
      expect(deps.chatIdRef.current).toBeUndefined()
      deps.chatIdRef.current = chatId
    })

    handleSessionEvent({ deps } as StreamLoopContext, chatSessionEvent('chat-new') as never)

    expect(deps.adoptResolvedChatId).toHaveBeenCalledWith('chat-new')
    expect(deps.chatIdRef.current).toBe('chat-new')
  })
})
