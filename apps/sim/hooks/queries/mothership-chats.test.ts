/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipResource } from '@/lib/copilot/resources/types'

const { queryClient, suspendBrowserScope, suspendTerminalScope } = vi.hoisted(() => ({
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

import {
  fetchMothershipChatHistory,
  fetchMothershipChats,
  useAddChatResource,
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
} from '@/hooks/queries/mothership-chats'

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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses valid task metadata responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: [
          {
            id: 'chat-1',
            title: 'Launch plan',
            updatedAt: '2026-04-11T10:00:00.000Z',
            activeStreamId: 'stream-1',
            lastSeenAt: null,
            pinned: false,
            deletedAt: null,
          },
        ],
      })
    )

    const tasks = await fetchMothershipChats('ws-1')

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'chat-1',
        name: 'Launch plan',
        isActive: true,
        isUnread: false,
        isPinned: false,
      })
    )
    expect(tasks[0]?.updatedAt.toISOString()).toBe('2026-04-11T10:00:00.000Z')
  })

  it('rejects invalid task metadata responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: [
          {
            id: 123,
            title: 'Broken',
            updatedAt: '2026-04-11T10:00:00.000Z',
            activeStreamId: null,
            lastSeenAt: null,
            pinned: false,
            deletedAt: null,
          },
        ],
      })
    )

    await expect(fetchMothershipChats('ws-1')).rejects.toThrow(
      'Response failed contract validation'
    )
  })

  it('parses valid mothership chat history responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        chat: {
          id: 'chat-1',
          title: 'Task history',
          messages: [],
          activeStreamId: 'stream-1',
          resources: [{ type: 'file', id: 'file-1', title: 'Spec.md' }],
          streamSnapshot: {
            events: [],
            previewSessions: [],
            status: 'active',
          },
        },
      })
    )

    const history = await fetchMothershipChatHistory('chat-1')

    expect(history).toEqual({
      id: 'chat-1',
      title: 'Task history',
      messages: [],
      activeStreamId: 'stream-1',
      resources: [{ type: 'file', id: 'file-1', title: 'Spec.md' }],
      streamSnapshot: {
        events: [],
        previewSessions: [],
        status: 'active',
      },
    })
  })

  it('rejects invalid fallback chat history responses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          chat: {
            id: 'chat-1',
            title: null,
            messages: [],
            activeStreamId: null,
            resources: [{ type: 'bogus', id: 'resource-1', title: 'Broken' }],
          },
        })
      )

    await expect(fetchMothershipChatHistory('chat-1')).rejects.toThrow(
      'Invalid chat response: chat.resources[0].type is invalid'
    )
  })

  it('does not call the legacy alias when the primary history request fails outside 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Unavailable' }, { status: 503 })
    )

    await expect(fetchMothershipChatHistory('chat-1')).rejects.toMatchObject({ status: 503 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the conditional read endpoint when marking a chat as seen', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))
    const mutation = useMarkMothershipChatRead('ws-1') as unknown as {
      mutationFn: (chatId: string) => Promise<void>
    }

    await mutation.mutationFn('chat-1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/mothership/chats/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chatId: 'chat-1' }),
      })
    )
  })

  it('rejects invalid chat resource mutation responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
      })
    )

    const mutation = useAddChatResource('chat-1') as unknown as {
      mutationFn: (input: {
        chatId: string
        resource: MothershipResource
      }) => Promise<{ resources: MothershipResource[] }>
    }

    await expect(
      mutation.mutationFn({
        chatId: 'chat-1',
        resource: { type: 'file', id: 'file-1', title: 'Spec.md' },
      })
    ).rejects.toThrow('Response failed contract validation')
  })

  it('suspends native resources only from the successful single-delete callback', async () => {
    const mutation = useDeleteMothershipChat('workspace-1') as unknown as {
      onSuccess: (data: undefined, chatId: string) => Promise<void>
      onSettled: (data: undefined, error: Error | null, chatId: string) => void
    }

    mutation.onSettled(undefined, new Error('delete failed'), 'chat-failed')
    expect(suspendBrowserScope).not.toHaveBeenCalled()
    expect(suspendTerminalScope).not.toHaveBeenCalled()

    await mutation.onSuccess(undefined, 'chat-deleted')
    expect(suspendBrowserScope).toHaveBeenCalledWith('chat-deleted')
    expect(suspendTerminalScope).toHaveBeenCalledWith('chat-deleted')
  })

  it('suspends every native resource group after a successful bulk delete', async () => {
    const mutation = useDeleteMothershipChats('workspace-1') as unknown as {
      mutationFn: (chatIds: string[]) => Promise<void>
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))

    await mutation.mutationFn(['chat-a', 'chat-b'])

    expect(suspendBrowserScope).toHaveBeenCalledWith('chat-a')
    expect(suspendBrowserScope).toHaveBeenCalledWith('chat-b')
    expect(suspendTerminalScope).toHaveBeenCalledWith('chat-a')
    expect(suspendTerminalScope).toHaveBeenCalledWith('chat-b')
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
  })
})
