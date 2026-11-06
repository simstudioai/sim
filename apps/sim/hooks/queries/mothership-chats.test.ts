import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { sleep } from '@sim/utils/helpers'
import type { MutationObserverOptions } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { suspendBrowserScope, suspendTerminalScope, clearChat } = vi.hoisted(() => ({
  clearChat: vi.fn(),
  suspendBrowserScope: vi.fn(async () => true),
  suspendTerminalScope: vi.fn(async () => true),
}))

vi.mock('@/stores/mothership-queue/store', () => ({
  useMothershipQueueStore: { getState: () => ({ clearChat, cleared: {} }) },
}))

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('@/lib/browser-agent/transport', () => ({
  suspendBrowserScope,
}))

vi.mock('@/lib/terminal/transport', () => ({
  suspendTerminalScope,
}))

import type { MothershipEffort } from '@/lib/mothership/model-options'
import {
  fetchMothershipChatHistory,
  mothershipChatKeys,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useSetMothershipChatEffort,
} from '@/hooks/queries/mothership-chats'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

const queryClient = reactQueryMockFns.mockQueryClient

describe('tasks query boundary parsing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('waits for slower successful deletions before reconciling a failed batch', async () => {
    const pending = Promise.withResolvers<Response>()
    const mutation = useDeleteMothershipChats({ organizationId: 'org-1' }) as unknown as {
      mutationFn: (chatIds: string[]) => Promise<void>
      onSettled: () => void
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }))
      .mockReturnValueOnce(pending.promise)
    const result = mutation.mutationFn(['chat-failed', 'chat-slow'])
    const reconciled = vi.fn()
    const observed = result.then(
      () => {
        mutation.onSettled()
        reconciled()
      },
      () => {
        mutation.onSettled()
        reconciled()
      }
    )
    await sleep(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(reconciled).not.toHaveBeenCalled()
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    expect(clearChat).not.toHaveBeenCalled()
    pending.resolve(jsonResponse({ success: true }))
    await observed
    await expect(result).rejects.toThrow()
    expect(queryClient.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['mothership-chats', 'list', 'organization', 'org-1'],
    })
    expect(clearChat).toHaveBeenCalledExactlyOnceWith('chat-slow')
    expect(queryClient.removeQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['mothership-chats', 'detail', 'chat-slow'],
    })
  })

  it('suspends each successful bulk delete even when a sibling delete fails', async () => {
    const mutation = useDeleteMothershipChats('workspace-1') as unknown as {
      mutationFn: (chatIds: string[]) => Promise<void>
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }))

    await expect(mutation.mutationFn(['chat-a', 'chat-b'])).rejects.toThrow()

    expect(suspendBrowserScope).toHaveBeenCalledWith('chat-a')
    expect(suspendTerminalScope).toHaveBeenCalledWith('chat-a')
    expect(suspendBrowserScope).not.toHaveBeenCalledWith('chat-b')
    expect(suspendTerminalScope).not.toHaveBeenCalledWith('chat-b')
    expect(clearChat).toHaveBeenCalledWith('chat-a')
    expect(clearChat).not.toHaveBeenCalledWith('chat-b')
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['mothership-chats', 'detail', 'chat-a'],
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalledWith({
      queryKey: ['mothership-chats', 'detail', 'chat-b'],
    })
  })

  it.each([
    ['read', useMarkMothershipChatRead],
    ['unread', useMarkMothershipChatUnread],
  ] as const)(
    'marking a chat %s still removes a row an invalidated list read would drop',
    async (_name, useMark) => {
      const tanstack =
        await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
      const client = new tanstack.QueryClient()
      const owner = { organizationId: 'org-1' }
      const queryKey = mothershipChatKeys.ownerList(owner)
      const rows = [{ id: 'chat-gone', name: 'Deleted', isUnread: false }]
      const staleRead = createDeferred<typeof rows>()
      const queryFn = vi
        .fn<() => Promise<typeof rows>>()
        .mockReturnValueOnce(staleRead.promise)
        .mockResolvedValue([])
      client.setQueryData(queryKey, rows)
      const list = new tanstack.QueryObserver(client, { queryKey, queryFn, staleTime: 60_000 })
      const stop = list.subscribe(() => {})
      reactQueryMockFns.mockUseQueryClient.mockReturnValueOnce(
        client as unknown as typeof queryClient
      )
      const mutation = useMark(owner) as unknown as {
        onMutate: (chatId: string) => Promise<unknown>
        onSettled: (data: undefined, error: null, chatId: string, context: unknown) => void
      }

      void client.invalidateQueries({ queryKey })
      const context = await mutation.onMutate('chat-gone')
      mutation.onSettled(undefined, null, 'chat-gone', context)
      await flushMicrotasks(10)

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(list.getCurrentResult().data).toEqual([])
      stop()
      client.clear()
    }
  )

  it('leaves the list alone when marking a chat with no invalidated read to redo', async () => {
    const owner = { organizationId: 'org-1' }
    queryClient.getQueryData.mockReturnValueOnce([])
    queryClient.getQueryState.mockReturnValueOnce({ isInvalidated: false })
    const mutation = useMarkMothershipChatRead(owner) as unknown as {
      onMutate: (chatId: string) => Promise<unknown>
      onSettled: (data: undefined, error: null, chatId: string, context: unknown) => void
    }

    const context = await mutation.onMutate('chat-1')
    mutation.onSettled(undefined, null, 'chat-1', context)

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('loads a chat from a server that predates the effort field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        chat: {
          id: 'chat-1',
          title: null,
          mode: 'agent',
          messages: [],
          activeStreamId: null,
          resources: [],
        },
      })
    )

    const history = await fetchMothershipChatHistory('chat-1')

    expect(history.effort).toBeNull()
  })

  it('keeps the latest effort pick when an earlier queued save of the same value fails', async () => {
    const tanstack =
      await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
    const client = new tanstack.QueryClient()
    const observer = new tanstack.MutationObserver(
      client,
      useSetMothershipChatEffort('chat-1') as unknown as MutationObserverOptions<
        void,
        Error,
        MothershipEffort,
        { pick: number }
      >
    )
    const saves = [
      Promise.withResolvers<Response>(),
      Promise.withResolvers<Response>(),
      Promise.withResolvers<Response>(),
    ]
    for (const save of saves) vi.mocked(fetch).mockReturnValueOnce(save.promise)
    useMothershipEffortStore.getState().reset()
    const outcomes = (['low', 'high', 'low'] as const).map((effort) =>
      observer.mutate(effort).catch(() => undefined)
    )
    await sleep(1)
    expect(fetch).toHaveBeenCalledTimes(1)

    saves[0].resolve(new Response('save failed', { status: 500 }))
    await outcomes[0]
    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('low')

    saves[1].resolve(jsonResponse({ success: true }))
    saves[2].resolve(jsonResponse({ success: true }))
    await Promise.all(outcomes)
    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('low')
  })
})
