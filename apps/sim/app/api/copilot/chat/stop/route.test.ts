/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhereSelect,
  mockLimit,
  mockForUpdate,
  mockUpdate,
  mockSet,
  mockWhereUpdate,
  mockReturning,
  mockPublishStatusChanged,
  mockSql,
  mockTransaction,
} = vi.hoisted(() => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhereSelect = vi.fn()
  const mockLimit = vi.fn()
  const mockForUpdate = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()
  const mockWhereUpdate = vi.fn()
  const mockReturning = vi.fn()
  const mockPublishStatusChanged = vi.fn()
  const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }))
  const mockTransaction = vi.fn(
    (callback: (tx: { select: typeof mockSelect; update: typeof mockUpdate }) => unknown) =>
      callback({ select: mockSelect, update: mockUpdate })
  )

  return {
    mockSelect,
    mockFrom,
    mockWhereSelect,
    mockLimit,
    mockForUpdate,
    mockUpdate,
    mockSet,
    mockWhereUpdate,
    mockReturning,
    mockPublishStatusChanged,
    mockSql,
    mockTransaction,
  }
})

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    workspaceId: 'copilotChats.workspaceId',
    messages: 'copilotChats.messages',
    conversationId: 'copilotChats.conversationId',
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockTransaction,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  sql: mockSql,
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

import { POST } from '@/app/api/copilot/chat/stop/route'

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/copilot/chat/stop', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('copilot chat stop route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })

    mockLimit.mockResolvedValue([
      {
        workspaceId: 'ws-1',
        messages: [{ id: 'stream-1', role: 'user', content: 'hello' }],
        conversationId: 'stream-1',
      },
    ])
    mockForUpdate.mockReturnValue({ limit: mockLimit })
    mockWhereSelect.mockReturnValue({ for: mockForUpdate })
    mockFrom.mockReturnValue({ where: mockWhereSelect })
    mockSelect.mockReturnValue({ from: mockFrom })

    mockReturning.mockResolvedValue([{ workspaceId: 'ws-1' }])
    mockWhereUpdate.mockReturnValue({ returning: mockReturning })
    mockSet.mockReturnValue({ where: mockWhereUpdate })
    mockUpdate.mockReturnValue({ set: mockSet })
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        streamId: 'stream-1',
        content: '',
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('is a no-op when the chat is missing', async () => {
    mockLimit.mockResolvedValueOnce([])

    const response = await POST(
      createRequest({
        chatId: 'missing-chat',
        streamId: 'stream-1',
        content: '',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('appends a stopped assistant message even with no content', async () => {
    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        streamId: 'stream-1',
        content: '',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const setArg = mockSet.mock.calls[0]?.[0]
    expect(setArg).toBeTruthy()
    expect(setArg.conversationId).toBeNull()
    expect(setArg.messages).toBeTruthy()

    const appendedPayload = JSON.parse(setArg.messages.values[1] as string)
    expect(appendedPayload).toHaveLength(1)
    expect(appendedPayload[0]).toMatchObject({
      role: 'assistant',
      content: '',
      contentBlocks: [{ type: 'complete', status: 'cancelled' }],
    })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })

  it('appends a stopped assistant message if the stream marker was already cleared', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        workspaceId: 'ws-1',
        messages: [{ id: 'stream-1', role: 'user', content: 'hello' }],
        conversationId: null,
      },
    ])

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        streamId: 'stream-1',
        content: 'partial',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const setArg = mockSet.mock.calls[0]?.[0]
    expect(setArg.messages).toBeTruthy()
    const appendedPayload = JSON.parse(setArg.messages.values[1] as string)
    expect(appendedPayload[0]).toMatchObject({
      role: 'assistant',
      content: 'partial',
    })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })

  it('republishes completed status when the assistant was already persisted', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        workspaceId: 'ws-1',
        messages: [
          { id: 'stream-1', role: 'user', content: 'hello' },
          { id: 'assistant-1', role: 'assistant', content: 'partial' },
        ],
        conversationId: null,
      },
    ])

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        streamId: 'stream-1',
        content: 'partial',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'completed',
      streamId: 'stream-1',
    })
  })
})
