/**
 * @vitest-environment jsdom
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1SessionKind } from '@/lib/copilot/generated/mothership-stream-v1'
import { handleSessionEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-session-event'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'

function createContext(queryClient: QueryClient, chatId?: string): StreamLoopContext {
  return {
    deps: {
      workspaceId: 'workspace-1',
      queryClient,
      chatIdRef: { current: chatId },
      selectedChatIdRef: { current: chatId },
      streamIdRef: { current: 'stream-1' },
      pendingUserMsgRef: {
        current: { id: 'user-1', role: 'user', content: 'Build an app' },
      },
      activeTurnRef: { current: null },
      streamingContentRef: { current: '' },
      streamingBlocksRef: { current: [] },
      resourcesRef: { current: [] },
      workflowIdRef: { current: undefined },
      onTitleUpdateRef: { current: undefined },
      setResolvedChatId: vi.fn(),
      setPendingMessages: vi.fn(),
      buildAssistantSnapshotMessage: () => ({
        id: 'assistant-1',
        role: 'assistant',
        content: '',
      }),
    },
  } as unknown as StreamLoopContext
}

function chatSession(chatId: string) {
  return {
    type: 'session',
    seq: 1,
    payload: {
      kind: MothershipStreamV1SessionKind.chat,
      chatId,
    },
    stream: {
      streamId: 'stream-1',
      chatId,
    },
  } as never
}

describe('handleSessionEvent', () => {
  it('preserves Full-stack type and linked App while seeding first-turn messages', () => {
    const queryClient = new QueryClient()
    const linkedAppProject = {
      id: 'app-1',
      name: 'My App',
      slug: 'my-app',
      publicId: 'public-1',
      publishedReleaseId: null,
    }
    queryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail('chat-1'), {
      id: 'chat-1',
      type: 'fullstack',
      title: 'Full-stack App',
      messages: [],
      activeStreamId: null,
      resources: [],
      linkedAppProject,
    })

    handleSessionEvent(createContext(queryClient), chatSession('chat-1'))

    const seeded = queryClient.getQueryData<MothershipChatHistory>(
      mothershipChatKeys.detail('chat-1')
    )
    expect(seeded).toMatchObject({
      type: 'fullstack',
      linkedAppProject,
      activeStreamId: 'stream-1',
    })
    expect(seeded?.messages).toHaveLength(2)
  })

  it('uses Full-stack list metadata when no detail cache exists yet', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(mothershipChatKeys.list('workspace-1'), [
      {
        id: 'chat-1',
        type: 'fullstack',
        name: 'Full-stack App',
        updatedAt: new Date(),
        isActive: false,
        isUnread: false,
        isPinned: false,
      },
    ])

    handleSessionEvent(createContext(queryClient), chatSession('chat-1'))

    expect(
      queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail('chat-1'))?.type
    ).toBe('fullstack')
  })
})
