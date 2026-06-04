/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, permissionsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockFrom, mockWhere, mockOrderBy, mockReconcileChatStreamMarkers } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockOrderBy: vi.fn(),
    mockReconcileChatStreamMarkers: vi.fn(),
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

vi.mock('@/lib/copilot/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mockReconcileChatStreamMarkers,
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

    mockReconcileChatStreamMarkers.mockImplementation(
      async (candidates: Array<{ chatId: string; streamId: string | null }>) =>
        new Map(
          candidates.map((candidate) => [
            candidate.chatId,
            {
              chatId: candidate.chatId,
              streamId: candidate.streamId,
              status: candidate.streamId ? 'active' : 'inactive',
            },
          ])
        )
    )
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
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([
        ['chat-stuck', { chatId: 'chat-stuck', streamId: null, status: 'inactive' }],
        ['chat-live', { chatId: 'chat-live', streamId: 'stream-live', status: 'active' }],
        ['chat-idle', { chatId: 'chat-idle', streamId: null, status: 'inactive' }],
      ])
    )

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [
        { chatId: 'chat-stuck', streamId: 'stream-orphaned' },
        { chatId: 'chat-live', streamId: 'stream-live' },
        { chatId: 'chat-idle', streamId: null },
      ],
      { repairVerifiedStaleMarkers: true }
    )
    expect(body.success).toBe(true)
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-stuck', activeStreamId: null }),
      expect.objectContaining({ id: 'chat-live', activeStreamId: 'stream-live' }),
      expect.objectContaining({ id: 'chat-idle', activeStreamId: null }),
    ])
  })

  it('preserves chats when no chat has a stream marker set', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      { id: 'chat-1', title: null, updatedAt: now, activeStreamId: null, lastSeenAt: null },
      { id: 'chat-2', title: null, updatedAt: now, activeStreamId: null, lastSeenAt: null },
    ])

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)

    expect(mockReconcileChatStreamMarkers).toHaveBeenCalledWith(
      [
        { chatId: 'chat-1', streamId: null },
        { chatId: 'chat-2', streamId: null },
      ],
      { repairVerifiedStaleMarkers: true }
    )
    const body = await response.json()
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-1', activeStreamId: null }),
      expect.objectContaining({ id: 'chat-2', activeStreamId: null }),
    ])
  })

  it('leaves activeStreamId untouched when redis confirms every lock is live', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      { id: 'chat-a', title: null, updatedAt: now, activeStreamId: 'stream-a', lastSeenAt: null },
      { id: 'chat-b', title: null, updatedAt: now, activeStreamId: 'stream-b', lastSeenAt: null },
    ])

    const response = await GET(createRequest('ws-1'))
    const body = await response.json()

    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-a', activeStreamId: 'stream-a' }),
      expect.objectContaining({ id: 'chat-b', activeStreamId: 'stream-b' }),
    ])
  })

  it('uses Redis lock owner when it differs from a stale activeStreamId', async () => {
    const now = new Date('2026-05-11T12:00:00Z')
    mockOrderBy.mockResolvedValueOnce([
      {
        id: 'chat-mismatch',
        title: null,
        updatedAt: now,
        activeStreamId: 'stream-stale',
        lastSeenAt: null,
      },
    ])
    mockReconcileChatStreamMarkers.mockResolvedValueOnce(
      new Map([
        ['chat-mismatch', { chatId: 'chat-mismatch', streamId: 'stream-live', status: 'active' }],
      ])
    )

    const response = await GET(createRequest('ws-1'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.data).toEqual([
      expect.objectContaining({ id: 'chat-mismatch', activeStreamId: 'stream-live' }),
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
    expect(mockReconcileChatStreamMarkers).not.toHaveBeenCalled()
  })
})
