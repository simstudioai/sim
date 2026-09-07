/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest, mockGetAccessibleChat } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
  mockGetAccessibleChat: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/api/contracts/mothership-chats', () => ({ markMothershipChatReadContract: {} }))
vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatAuth: mockGetAccessibleChat,
}))

import { POST } from '@/app/api/mothership/chats/read/route'

function createRequest() {
  return new NextRequest('http://localhost:3000/api/mothership/chats/read', {
    method: 'POST',
    body: JSON.stringify({ chatId: 'chat-1' }),
  })
}

describe('POST /api/mothership/chats/read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    })
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1', userId: 'user-1' })
    mockParseRequest.mockResolvedValue({ success: true, data: { body: { chatId: 'chat-1' } } })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('guards the lastSeenAt write with the unread predicate (only writes when unread)', async () => {
    const res = await POST(createRequest())
    expect(res.status).toBe(200)
    expect(mockGetAccessibleChat).toHaveBeenCalledWith('chat-1', 'user-1', {
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    })

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    const whereArg = dbChainMockFns.where.mock.calls[0][0] as {
      type: string
      conditions: Array<{ type: string; conditions?: unknown[] }>
    }
    expect(whereArg.type).toBe('and')

    const orClause = whereArg.conditions.find((c) => c.type === 'or')
    expect(orClause).toBeDefined()
    expect(orClause?.conditions).toEqual(
      expect.arrayContaining([
        { type: 'isNull', column: 'copilotChats.lastSeenAt' },
        { type: 'lt', left: 'copilotChats.lastSeenAt', right: 'copilotChats.updatedAt' },
      ])
    )
  })

  it('does not update a chat the caller can no longer access', async () => {
    mockGetAccessibleChat.mockResolvedValueOnce(null)
    const res = await POST(createRequest())
    expect(res.status).toBe(200)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not touch the database when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: null,
      isAuthenticated: false,
    })
    const res = await POST(createRequest())
    expect(res.status).toBe(401)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
