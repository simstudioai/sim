/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipResource } from '@/lib/copilot/resources/types'

const { queryClient } = vi.hoisted(() => ({
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

import { fetchChatHistory, fetchTasks, useAddChatResource } from '@/hooks/queries/tasks'

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
          },
        ],
      })
    )

    const tasks = await fetchTasks('ws-1')

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'chat-1',
        name: 'Launch plan',
        isActive: true,
        isUnread: false,
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
          },
        ],
      })
    )

    await expect(fetchTasks('ws-1')).rejects.toThrow(
      'Invalid tasks response: data[0].id must be a string'
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
          conversationId: 'stream-1',
          resources: [{ type: 'file', id: 'file-1', title: 'Spec.md' }],
          streamSnapshot: {
            events: [],
            previewSessions: [],
            status: 'active',
          },
        },
      })
    )

    const history = await fetchChatHistory('chat-1')

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

    await expect(fetchChatHistory('chat-1')).rejects.toThrow(
      'Invalid copilot chat response: chat.resources[0].type is invalid'
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
    ).rejects.toThrow('Invalid chat resources response: resources must be an array')
  })
})
