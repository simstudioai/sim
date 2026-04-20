/**
 * Tests for copilot chat delete API route
 *
 * @vitest-environment node
 */
import { authMockFns, dbChainMock, dbChainMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccessibleCopilotChat } = vi.hoisted(() => ({
  mockGetAccessibleCopilotChat: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

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

    authMockFns.mockGetSession.mockResolvedValue(null)

    dbChainMockFns.returning.mockResolvedValue([{ workspaceId: 'ws-1' }])
    mockGetAccessibleCopilotChat.mockResolvedValue({ id: 'chat-123', userId: 'user-123' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Unauthorized' })
    })

    it('should successfully delete a chat', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })

      expect(dbChainMockFns.delete).toHaveBeenCalled()
      expect(dbChainMockFns.where).toHaveBeenCalled()
    })

    it('should return 500 for invalid request body - missing chatId', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {})

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should return 500 for invalid request body - chatId is not a string', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: 12345,
      })

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should handle database errors gracefully', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      dbChainMockFns.returning.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Failed to delete chat' })
    })

    it('should handle JSON parsing errors in request body', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('DELETE', {
        chatId: '',
      })

      const response = await DELETE(req)

      expect(response.status).toBe(200)
      expect(dbChainMockFns.delete).toHaveBeenCalled()
    })
  })
})
