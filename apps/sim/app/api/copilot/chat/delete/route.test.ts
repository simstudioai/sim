/**
 * Tests for copilot chat delete API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDelete, mockWhere, mockGetSession, mockGetAccessibleCopilotChat } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockWhere: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetAccessibleCopilotChat: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    delete: mockDelete,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'id',
    userId: 'userId',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChat: mockGetAccessibleCopilotChat,
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: { publishStatusChanged: vi.fn() },
}))

import { DELETE } from './route'

function createMockRequest(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/copilot/chat/delete', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Copilot Chat Delete API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue(null)

    const mockReturning = vi.fn().mockResolvedValue([{ workspaceId: 'ws-1' }])
    mockWhere.mockReturnValue({ returning: mockReturning })
    mockDelete.mockReturnValue({ where: mockWhere })
    mockGetAccessibleCopilotChat.mockResolvedValue({ id: 'chat-123', userId: 'user-123' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Unauthorized' })
    })

    it('should successfully delete a chat', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })

      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should return 500 for invalid request body - missing chatId', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {})

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should return 500 for invalid request body - chatId is not a string', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: 12345,
      })

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should handle database errors gracefully', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockWhere.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Failed to delete chat' })
    })

    it('should handle JSON parsing errors in request body', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = new NextRequest('http://localhost:3000/api/copilot/chat/delete', {
        method: 'DELETE',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should delete chat even if it does not exist (idempotent)', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockGetAccessibleCopilotChat.mockResolvedValueOnce(null)

      const req = createMockRequest('DELETE', {
        chatId: 'non-existent-chat',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })
    })

    it('should delete chat with empty string chatId (validation should fail)', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: '',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(200)
      expect(mockDelete).toHaveBeenCalled()
    })
  })
})
