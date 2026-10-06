import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { suspendBrowserScope, suspendTerminalScope } = vi.hoisted(() => ({
  suspendBrowserScope: vi.fn(async () => true),
  suspendTerminalScope: vi.fn(async () => true),
}))

vi.mock('@/lib/browser-agent/transport', () => ({ suspendBrowserScope }))
vi.mock('@/lib/terminal/transport', () => ({ suspendTerminalScope }))

import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { desktopActivityKeys } from '@/hooks/queries/utils/desktop-activity-keys'
import {
  handleMothershipChatStatusEvent,
  reflectBackgroundChatStatus,
  resyncMothershipChatCaches,
} from '@/hooks/use-mothership-chat-events'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

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

  it('drops the queue of a chat deleted elsewhere and takes sends again once it is restored', () => {
    useMothershipQueueStore.getState().reset()
    const queued = { id: 'm1', content: 'follow-up' }
    const publish = (type: 'deleted' | 'created') =>
      handleMothershipChatStatusEvent(
        queryClient,
        'ws-1',
        JSON.stringify({ chatId: 'chat-1', type, timestamp: Date.now() })
      )

    useMothershipQueueStore.getState().enqueue('chat-1', queued)
    publish('deleted')
    expect(useMothershipQueueStore.getState().queues['chat-1']).toBeUndefined()
    useMothershipQueueStore.getState().enqueue('chat-1', queued)
    expect(useMothershipQueueStore.getState().queues['chat-1']).toBeUndefined()

    publish('created')
    useMothershipQueueStore.getState().enqueue('chat-1', queued)
    expect(useMothershipQueueStore.getState().queues['chat-1']?.map((m) => m.id)).toEqual(['m1'])
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

describe('chat detail refetches driven by status events', () => {
  function mountDetail(cached: MothershipChatHistory) {
    const queryClient = new QueryClient()
    const fetchTranscript = vi.fn(async () => cached)
    queryClient.setQueryData(mothershipChatKeys.detail('chat-1'), cached)
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: mothershipChatKeys.detail('chat-1'),
      queryFn: fetchTranscript,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {})
    return { queryClient, fetchTranscript, unsubscribe }
  }

  const liveStream: MothershipChatHistory = {
    id: 'chat-1',
    title: null,
    messages: [
      { id: 'stream-1' },
      { id: 'live-assistant:stream-1' },
    ] as MothershipChatHistory['messages'],
    activeStreamId: 'stream-1',
    resources: [],
  }

  it('does not reload the transcript when the viewer finishes its own live stream', async () => {
    const { queryClient, fetchTranscript, unsubscribe } = mountDetail(liveStream)

    handleMothershipChatStatusEvent(queryClient, 'ws-1', {
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
    await sleep(0)

    expect(fetchTranscript).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reloads the saved transcript when a cached mid-stream detail is opened after completion', async () => {
    const queryClient = new QueryClient()
    const fetchTranscript = vi.fn(async () => ({ ...liveStream, activeStreamId: null }))
    queryClient.setQueryData(mothershipChatKeys.detail('chat-1'), liveStream)

    handleMothershipChatStatusEvent(queryClient, 'ws-1', {
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: mothershipChatKeys.detail('chat-1'),
      queryFn: fetchTranscript,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {})

    await vi.waitFor(() => expect(fetchTranscript).toHaveBeenCalledTimes(1))
    unsubscribe()
  })

  it('marks the detail stale on rename without reloading the transcript', async () => {
    const { queryClient, fetchTranscript, unsubscribe } = mountDetail({
      ...liveStream,
      messages: [],
      activeStreamId: null,
    })

    handleMothershipChatStatusEvent(queryClient, 'ws-1', { chatId: 'chat-1', type: 'renamed' })
    await sleep(0)

    expect(fetchTranscript).not.toHaveBeenCalled()
    expect(queryClient.getQueryState(mothershipChatKeys.detail('chat-1'))?.isInvalidated).toBe(true)
    unsubscribe()
  })
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

describe('reflectBackgroundChatStatus', () => {
  const notify = vi.fn(async () => true)
  const queryClient = {
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } satisfies Pick<QueryClient, 'getQueryData' | 'invalidateQueries'>

  function showing(pathname: string, desktop = true) {
    vi.stubGlobal('window', {
      location: { pathname },
      ...(desktop ? { simDesktop: { settings: { notify } } } : {}),
    })
    queryClient.getQueryData.mockReturnValue([{ id: 'chat-b', name: 'Fix CI' }])
  }

  const completed = JSON.stringify({ chatId: 'chat-b', type: 'completed', streamId: 's-1' })

  it('announces a chat that finished in the background, and opens it from the notification', () => {
    showing('/workspace/ws-1/chat/chat-c')

    reflectBackgroundChatStatus(queryClient, 'ws-1', completed, true)

    expect(notify).toHaveBeenCalledWith({
      title: 'Fix CI',
      body: 'Sim finished responding.',
      route: '/workspace/ws-1/chat/chat-b',
    })
  })

  it('announces nothing while the background executor is off', () => {
    showing('/workspace/ws-1/chat/chat-c')

    reflectBackgroundChatStatus(queryClient, 'ws-1', completed, false)

    expect(notify).not.toHaveBeenCalled()
  })

  it('leaves the chat on screen to announce itself', () => {
    showing('/workspace/ws-1/chat/chat-b')

    reflectBackgroundChatStatus(queryClient, 'ws-1', completed, true)

    expect(notify).not.toHaveBeenCalled()
  })

  it('stays silent outside the desktop app and for a turn that only started', () => {
    showing('/workspace/ws-1/chat/chat-c', false)
    reflectBackgroundChatStatus(queryClient, 'ws-1', completed, true)
    showing('/workspace/ws-1/chat/chat-c')
    reflectBackgroundChatStatus(
      queryClient,
      'ws-1',
      JSON.stringify({ chatId: 'chat-b', type: 'started', streamId: 's-2' }),
      true
    )

    expect(notify).not.toHaveBeenCalled()
  })

  it('refreshes which chats run on a desktop whenever a turn starts or ends', () => {
    showing('/workspace/ws-1/home', false)

    reflectBackgroundChatStatus(
      queryClient,
      'ws-1',
      JSON.stringify({ chatId: 'chat-b', type: 'started', streamId: 's-3' }),
      true
    )
    reflectBackgroundChatStatus(
      queryClient,
      'ws-1',
      JSON.stringify({ chatId: 'chat-b', type: 'renamed' }),
      true
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: desktopActivityKeys.lists(),
    })
  })
})
