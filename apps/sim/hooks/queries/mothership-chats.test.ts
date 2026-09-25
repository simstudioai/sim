import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipResource } from '@/lib/mothership/resources/types'

const { queryClient, suspendBrowserScope, suspendTerminalScope, clearChat } = vi.hoisted(() => ({
  clearChat: vi.fn(),
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    getQueryData: vi.fn(),
    removeQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
  suspendBrowserScope: vi.fn(async () => true),
  suspendTerminalScope: vi.fn(async () => true),
}))

vi.mock('@/stores/mothership-queue/store', () => ({
  useMothershipQueueStore: { getState: () => ({ clearChat }) },
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  queryOptions: (options: unknown) => options,
  skipToken: Symbol('skipToken'),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  suspendBrowserScope,
}))

vi.mock('@/lib/terminal/transport', () => ({
  suspendTerminalScope,
}))

import { useDeleteMothershipChats, useRemoveChatResource } from '@/hooks/queries/mothership-chats'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })
}

describe('tasks query boundary parsing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
})

it('removes only the requested workspace alias and forwards its owner', async () => {
  const first: MothershipResource = {
    type: 'file',
    id: 'files/report.csv',
    title: 'A',
    workspaceId: 'ws-a',
  }
  const second: MothershipResource = { ...first, title: 'B', workspaceId: 'ws-b' }
  let cached = {
    id: 'chat-1',
    title: null,
    messages: [],
    activeStreamId: null,
    resources: [first, second],
  }
  queryClient.setQueryData.mockImplementation((_key, update) => {
    cached = update(cached)
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ success: true, resources: [first] }))
  )
  const mutation = useRemoveChatResource('chat-1') as unknown as {
    onMutate: (input: {
      chatId: string
      resourceType: 'file'
      resourceId: string
      workspaceId: string
    }) => Promise<unknown>
    mutationFn: (input: {
      chatId: string
      resourceType: 'file'
      resourceId: string
      workspaceId: string
    }) => Promise<unknown>
  }
  const input = {
    chatId: 'chat-1',
    resourceType: 'file' as const,
    resourceId: 'files/report.csv',
    workspaceId: 'ws-b',
  }
  await mutation.onMutate(input)
  expect(cached.resources).toEqual([first])
  await mutation.mutationFn(input)
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual(input)
  vi.unstubAllGlobals()
})
