import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { suspendBrowserScope, suspendTerminalScope } = vi.hoisted(() => ({
  suspendBrowserScope: vi.fn(async () => true),
  suspendTerminalScope: vi.fn(async () => true),
}))

vi.mock('@/lib/browser-agent/transport', () => ({ suspendBrowserScope }))
vi.mock('@/lib/terminal/transport', () => ({ suspendTerminalScope }))

import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import {
  handleMothershipChatStatusEvent,
  resyncMothershipChatCaches,
} from '@/hooks/use-mothership-chat-events'

describe('handleMothershipChatStatusEvent', () => {
  const queryClient = {
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    removeQueries: vi.fn(),
  } satisfies Pick<QueryClient, 'getQueryData' | 'invalidateQueries' | 'removeQueries'>

  beforeEach(() => {
    queryClient.getQueryData.mockReturnValue(undefined)
  })

  it('keeps completed task detail when an unkeyed completion races an active stream', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'live-assistant:new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleMothershipChatStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates completed task detail when the active stream disagreement is only stale cache', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'old-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleMothershipChatStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates completed task detail when a missing stream may be newer server state', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }],
      activeStreamId: 'old-stream',
      resources: [],
    })

    handleMothershipChatStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'new-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates the task list and removes detail cache for deleted task events', () => {
    handleMothershipChatStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'deleted',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-1'),
    })
    expect(queryClient.removeQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.detail('chat-1'),
    })
    expect(suspendBrowserScope).toHaveBeenCalledWith('chat-1')
    expect(suspendTerminalScope).toHaveBeenCalledWith('chat-1')
  })

  it('keeps started task detail when a stale started stream is older than the active stream', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }, { id: 'new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleMothershipChatStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it.each(['created', 'updated', 'renamed', 'started', 'completed', 'deleted'])(
    'invalidates only organization lists for organization %s events',
    (type) => {
      handleMothershipChatStatusEvent(
        queryClient,
        { organizationId: 'org-1' },
        { chatId: 'chat-1', type }
      )
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: mothershipChatKeys.organizationLists('org-1'),
      })
      expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: mothershipChatKeys.workspaceLists('org-1'),
      })
      if (type === 'deleted')
        expect(queryClient.removeQueries).toHaveBeenCalledWith({
          queryKey: mothershipChatKeys.detail('chat-1'),
        })
    }
  )
})

describe('resyncMothershipChatCaches', () => {
  const queryClient = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } satisfies Pick<QueryClient, 'invalidateQueries'>

  it('leaves chat details untouched so a mounted stream cannot be refetched mid-turn', () => {
    resyncMothershipChatCaches(queryClient, 'ws-1')

    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: mothershipChatKeys.details() })
    )
  })
})
