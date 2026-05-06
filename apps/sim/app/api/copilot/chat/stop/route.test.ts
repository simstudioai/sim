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
  mockUpdate,
  mockSet,
  mockWhereUpdate,
  mockReturning,
  mockPublishStatusChanged,
  mockSql,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhereSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhereUpdate: vi.fn(),
  mockReturning: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

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
    select: mockSelect,
    update: mockUpdate,
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
      },
    ])
    mockWhereSelect.mockReturnValue({ limit: mockLimit })
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
})
