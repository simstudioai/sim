/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertActiveWorkspaceAccess, mockPublishStatusChanged } = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
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
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'workspace-1' }])
    dbChainMockFns.returning.mockResolvedValue([{ workspaceId: 'workspace-1' }])
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns 401 when unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(401)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns 404 when no soft-deleted chat is owned by the caller', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await POST(makeRequest('chat-missing'), makeContext('chat-missing'))
    expect(response.status).toBe(404)
    expect(mockAssertActiveWorkspaceAccess).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller lost access to the workspace', async () => {
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(new Error('ACCESS_DENIED'))

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(403)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('restores the chat, bumping updatedAt and lastSeenAt, and publishes the event', async () => {
    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockAssertActiveWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
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
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const response = await POST(makeRequest('chat-1'), makeContext('chat-1'))
    expect(response.status).toBe(404)
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })
})
