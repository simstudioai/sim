/**
 * Tests for copilot chat delete API route
 *
 * @vitest-environment node
 */
import { createMockRequest, mockAuth, mockCryptoUuid, setupCommonApiMocks } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Chat Delete API Route', () => {
  const mockDelete = vi.fn()
  const mockWhere = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockDelete.mockReturnValue({ where: mockWhere })
    mockWhere.mockResolvedValue([])

    vi.doMock('@sim/db', () => ({
      db: {
        delete: mockDelete,
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
      copilotChats: {
        id: 'id',
        userId: 'userId',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Unauthorized' })
    })

    it('should successfully delete a chat', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockWhere.mockResolvedValueOnce([{ id: 'chat-123' }])

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })

      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should return 500 for invalid request body - missing chatId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('DELETE', {})

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should return 500 for invalid request body - chatId is not a string', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('DELETE', {
        chatId: 12345,
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should handle database errors gracefully', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockWhere.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('DELETE', {
        chatId: 'chat-123',
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Failed to delete chat' })
    })

    it('should handle JSON parsing errors in request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/chat/delete', {
        method: 'DELETE',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to delete chat')
    })

    it('should delete chat even if it does not exist (idempotent)', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockWhere.mockResolvedValueOnce([])

      const req = createMockRequest('DELETE', {
        chatId: 'non-existent-chat',
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })
    })

    it('should delete chat with empty string chatId (validation should fail)', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('DELETE', {
        chatId: '',
      })

      const { DELETE } = await import('@/app/api/copilot/chat/delete/route')
      const response = await DELETE(req)

      expect(response.status).toBe(200)
      expect(mockDelete).toHaveBeenCalled()
    })
  })
})
