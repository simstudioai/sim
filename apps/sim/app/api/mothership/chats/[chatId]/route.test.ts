/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAccessibleCopilotChat,
  mockGetActiveChatStreamIds,
  mockReadEvents,
  mockReadFilePreviewSessions,
  mockGetLatestRunForStream,
} = vi.hoisted(() => ({
  mockGetAccessibleCopilotChat: vi.fn(),
  mockGetActiveChatStreamIds: vi.fn(),
  mockReadEvents: vi.fn(),
  mockReadFilePreviewSessions: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    type: 'copilotChats.type',
    updatedAt: 'copilotChats.updatedAt',
    lastSeenAt: 'copilotChats.lastSeenAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      type: 'sql',
      strings,
      values,
    })),
    { raw: vi.fn() }
  ),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChat: mockGetAccessibleCopilotChat,
}))

vi.mock('@/lib/copilot/request/session/abort', () => ({
  getActiveChatStreamIds: mockGetActiveChatStreamIds,
}))

vi.mock('@/lib/copilot/request/session/buffer', () => ({
  readEvents: mockReadEvents,
}))

vi.mock('@/lib/copilot/request/session/file-preview-session', () => ({
  readFilePreviewSessions: mockReadFilePreviewSessions,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))

vi.mock('@/lib/copilot/request/session/types', () => ({
  toStreamBatchEvent: (e: unknown) => e,
}))

vi.mock('@/lib/copilot/chat/effective-transcript', () => ({
  buildEffectiveChatTranscript: ({ messages }: { messages: unknown[] }) => messages,
}))

vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  normalizeMessage: (m: unknown) => m,
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { GET } from '@/app/api/mothership/chats/[chatId]/route'

function makeContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function createRequest(chatId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}`, {
    method: 'GET',
  })
}

describe('GET /api/mothership/chats/[chatId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockGetActiveChatStreamIds.mockResolvedValue(new Set<string>())
    mockReadEvents.mockResolvedValue([])
    mockReadFilePreviewSessions.mockResolvedValue([])
    mockGetLatestRunForStream.mockResolvedValue(null)
  })

  it('clears conversationId when the redis lock has expired (stuck-yellow bug)', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-stuck',
      type: 'mothership',
      title: 'Stuck',
      messages: [],
      resources: [],
      conversationId: 'stream-orphaned',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockGetActiveChatStreamIds.mockResolvedValueOnce(new Set<string>())

    const response = await GET(createRequest('chat-stuck'), makeContext('chat-stuck'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockGetActiveChatStreamIds).toHaveBeenCalledWith(['chat-stuck'])
    expect(body.success).toBe(true)
    expect(body.chat.conversationId).toBeNull()
    expect(body.chat.streamSnapshot).toBeUndefined()
    expect(mockReadEvents).not.toHaveBeenCalled()
  })

  it('returns the live conversationId when redis confirms the lock', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-live',
      type: 'mothership',
      title: 'Live',
      messages: [],
      resources: [],
      conversationId: 'stream-live',
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })
    mockGetActiveChatStreamIds.mockResolvedValueOnce(new Set(['chat-live']))
    mockGetLatestRunForStream.mockResolvedValueOnce({ status: 'active' })

    const response = await GET(createRequest('chat-live'), makeContext('chat-live'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.chat.conversationId).toBe('stream-live')
    expect(mockReadEvents).toHaveBeenCalledWith('stream-live', '0')
    expect(body.chat.streamSnapshot).toBeDefined()
    expect(body.chat.streamSnapshot.status).toBe('active')
  })

  it('skips the reconciliation lookup when conversationId is already null', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-idle',
      type: 'mothership',
      title: 'Idle',
      messages: [],
      resources: [],
      conversationId: null,
      createdAt: new Date('2026-05-11T12:00:00Z'),
      updatedAt: new Date('2026-05-11T12:00:00Z'),
    })

    const response = await GET(createRequest('chat-idle'), makeContext('chat-idle'))
    expect(response.status).toBe(200)

    expect(mockGetActiveChatStreamIds).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.chat.conversationId).toBeNull()
  })

  it('returns 404 when the chat does not exist', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce(null)

    const response = await GET(createRequest('chat-missing'), makeContext('chat-missing'))
    expect(response.status).toBe(404)
    expect(mockGetActiveChatStreamIds).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(createRequest('chat-x'), makeContext('chat-x'))
    expect(response.status).toBe(401)
    expect(mockGetAccessibleCopilotChat).not.toHaveBeenCalled()
    expect(mockGetActiveChatStreamIds).not.toHaveBeenCalled()
  })
})
