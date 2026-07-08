/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpdate, mockSet, mockWhere, mockParseRequest } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockParseRequest: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { update: mockUpdate },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    updatedAt: 'copilotChats.updatedAt',
    lastSeenAt: 'copilotChats.lastSeenAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  lt: vi.fn((field: unknown, value: unknown) => ({ type: 'lt', field, value })),
  sql: vi.fn(() => ({ type: 'sql' })),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/api/contracts/mothership-chats', () => ({ markMothershipChatReadContract: {} }))

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
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValue({ success: true, data: { body: { chatId: 'chat-1' } } })
    mockWhere.mockResolvedValue(undefined)
    mockSet.mockReturnValue({ where: mockWhere })
    mockUpdate.mockReturnValue({ set: mockSet })
  })

  it('guards the lastSeenAt write with the unread predicate (only writes when unread)', async () => {
    const res = await POST(createRequest())
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const whereArg = mockWhere.mock.calls[0][0] as {
      type: string
      conditions: Array<{ type: string; conditions?: unknown[] }>
    }
    expect(whereArg.type).toBe('and')

    const orClause = whereArg.conditions.find((c) => c.type === 'or')
    expect(orClause).toBeDefined()
    expect(orClause?.conditions).toEqual(
      expect.arrayContaining([
        { type: 'isNull', field: 'copilotChats.lastSeenAt' },
        { type: 'lt', field: 'copilotChats.lastSeenAt', value: 'copilotChats.updatedAt' },
      ])
    )
  })

  it('does not touch the database when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: null,
      isAuthenticated: false,
    })
    const res = await POST(createRequest())
    expect(res.status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
