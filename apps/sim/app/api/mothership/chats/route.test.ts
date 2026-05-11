/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, permissionsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockFrom, mockWhere, mockOrderBy, mockGetActiveChatStreamIds } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockOrderBy: vi.fn(),
    mockGetActiveChatStreamIds: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    title: 'copilotChats.title',
    userId: 'copilotChats.userId',
    workspaceId: 'copilotChats.workspaceId',
    type: 'copilotChats.type',
    updatedAt: 'copilotChats.updatedAt',
    conversationId: 'copilotChats.conversationId',
    lastSeenAt: 'copilotChats.lastSeenAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  desc: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/copilot/request/session/abort', () => ({
  getActiveChatStreamIds: mockGetActiveChatStreamIds,
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { GET } from '@/app/api/mothership/chats/route'

function createRequest(workspaceId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats?workspaceId=${workspaceId}`, {
    method: 'GET',
  })
}

describe('GET /api/mothership/chats', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })

    mockOrderBy.mockResolvedValue([])
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockSelect.mockReturnValue({ from: mockFrom })

    mockGetActiveChatStreamIds.mockResolvedValue(new Set<string>())
  })

  it('clears activeStreamId on chats whose redis lock has expired (stuck-yellow bug)', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      {
        id: 'chat-stuck',
        title: 'Stuck chat',
        updatedAt: now,
        activeStreamId: 'stream-orphaned',
        lastSeenAt: null,
      },
      {
        id: 'chat-live',
        title: 'Live chat',
        updatedAt: now,
        activeStreamId: 'stream-live',
        lastSeenAt: null,
      },
      {
        id: 'chat-idle',
        title: 'Idle chat',
        updatedAt: now,
        activeStreamId: null,
        lastSeenAt: null,
      },
    ])
    mockGetActiveChatStreamIds.mockResolvedValueOnce(new Set(['chat-live']))

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockGetActiveChatStreamIds).toHaveBeenCalledWith(['chat-stuck', 'chat-live'])
    expect(body.success).toBe(true)
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-stuck', activeStreamId: null }),
      expect.objectContaining({ id: 'chat-live', activeStreamId: 'stream-live' }),
      expect.objectContaining({ id: 'chat-idle', activeStreamId: null }),
    ])
  })

  it('skips the reconciliation lookup when no chat has a stream marker set', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      { id: 'chat-1', title: null, updatedAt: now, activeStreamId: null, lastSeenAt: null },
      { id: 'chat-2', title: null, updatedAt: now, activeStreamId: null, lastSeenAt: null },
    ])

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)

    expect(mockGetActiveChatStreamIds).toHaveBeenCalledWith([])
    const body = await response.json()
    expect(
      body.data.every((c: { activeStreamId: string | null }) => c.activeStreamId === null)
    ).toBe(true)
  })

  it('leaves activeStreamId untouched when redis confirms every lock is live', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      { id: 'chat-a', title: null, updatedAt: now, activeStreamId: 'stream-a', lastSeenAt: null },
      { id: 'chat-b', title: null, updatedAt: now, activeStreamId: 'stream-b', lastSeenAt: null },
    ])
    mockGetActiveChatStreamIds.mockResolvedValueOnce(new Set(['chat-a', 'chat-b']))

    const response = await GET(createRequest('ws-1'))
    const body = await response.json()

    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-a', activeStreamId: 'stream-a' }),
      expect.objectContaining({ id: 'chat-b', activeStreamId: 'stream-b' }),
    ])
  })

  it('returns 401 when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(401)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockGetActiveChatStreamIds).not.toHaveBeenCalled()
  })
})
