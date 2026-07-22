/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbSelect,
  mockSelectFrom,
  mockSelectWhere,
  mockSelectLimit,
  mockDbUpdate,
  mockDbSet,
  mockUpdateWhere,
  mockDbReturning,
  mockAssertActiveWorkspaceAccess,
  mockPublishStatusChanged,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockSelectFrom: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockDbReturning: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    type: 'copilotChats.type',
    workspaceId: 'copilotChats.workspaceId',
    updatedAt: 'copilotChats.updatedAt',
    lastSeenAt: 'copilotChats.lastSeenAt',
    deletedAt: 'copilotChats.deletedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ type: 'isNotNull', field })),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  ...copilotHttpMock,
  createForbiddenResponse: vi.fn((message: string) => ({
    status: 403,
    ok: false,
    json: async () => ({ error: message }),
  })),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError: (error: unknown) =>
    error instanceof Error && error.message === 'ACCESS_DENIED',
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { POST } from '@/app/api/mothership/chats/[chatId]/restore/route'

function makeRequest(chatId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}/restore`, {
    method: 'POST',
  })
}

function makeContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

describe('POST /api/mothership/chats/[chatId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockSelectLimit.mockResolvedValue([{ workspaceId: 'workspace-1' }])
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit })
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
    mockDbSelect.mockReturnValue({ from: mockSelectFrom })
    mockDbReturning.mockResolvedValue([{ workspaceId: 'workspace-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockDbReturning })
    mockDbSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockDbSet })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
  })

  it('returns 401 when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(401)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when no soft-deleted chat is owned by the caller', async () => {
    mockSelectLimit.mockResolvedValueOnce([])

    const response = await POST(makeRequest('chat-missing'), makeContext('chat-missing'))
    expect(response.status).toBe(404)
    expect(mockAssertActiveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller lost access to the workspace', async () => {
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(new Error('ACCESS_DENIED'))

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(403)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('restores the chat, bumping updatedAt and lastSeenAt, and publishes the event', async () => {
    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockAssertActiveWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockDbSet).toHaveBeenCalledWith({
      deletedAt: null,
      updatedAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    })
    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      type: 'created',
    })
  })

  it('returns 404 when the chat is restored concurrently before the update lands', async () => {
    mockDbReturning.mockResolvedValueOnce([])

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(404)
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })
})
