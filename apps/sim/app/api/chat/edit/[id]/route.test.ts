import { NextRequest } from 'next/server'
/**
 * Tests for chat edit API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Chat Edit API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()
  const mockDelete = vi.fn()

  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()
  const mockEncryptSecret = vi.fn()
  const mockCheckChatAccess = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
    }))

    vi.doMock('@/db/schema', () => ({
      chat: { id: 'id', subdomain: 'subdomain', userId: 'userId' },
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createSuccessResponse: mockCreateSuccessResponse.mockImplementation((data) => {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      createErrorResponse: mockCreateErrorResponse.mockImplementation((message, status = 500) => {
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }))

    vi.doMock('@/lib/utils', () => ({
      encryptSecret: mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-password' }),
    }))

    vi.doMock('@/lib/urls/utils', () => ({
      getEmailDomain: vi.fn().mockReturnValue('localhost:3000'),
    }))

    vi.doMock('@/lib/environment', () => ({
      isDev: true,
    }))

    vi.doMock('@/app/api/chat/utils', () => ({
      checkChatAccess: mockCheckChatAccess,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123')
      const { GET } = await import('./route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123')
      const { GET } = await import('./route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Chat not found or access denied', 404)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should return chat details when user has access', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        description: 'A test chat',
        password: 'encrypted-password',
        customizations: { primaryColor: '#000000' },
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123')
      const { GET } = await import('./route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        description: 'A test chat',
        customizations: { primaryColor: '#000000' },
        chatUrl: 'http://test-chat.localhost:3000',
        hasPassword: true,
      })
    })
  })

  describe('PATCH', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Chat not found or access denied', 404)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should update chat when user has access', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat', description: 'Updated description' }),
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
        id: 'chat-123',
        chatUrl: 'http://test-chat.localhost:3000',
        message: 'Chat deployment updated successfully',
      })
    })

    it('should handle subdomain conflicts', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })
      // Mock subdomain conflict
      mockLimit.mockResolvedValueOnce([{ id: 'other-chat-id', subdomain: 'new-subdomain' }])

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ subdomain: 'new-subdomain' }),
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Subdomain already in use', 400)
    })

    it('should validate password requirement for password auth', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        password: null,
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ authType: 'password' }), // No password provided
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Password is required when using password protection',
        400
      )
    })

    it('should allow access when user has workspace admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'admin-user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
      }

      // User doesn't own chat but has workspace admin access
      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Admin Updated Chat' }),
      })
      const { PATCH } = await import('./route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'admin-user-id')
    })
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Chat not found or access denied', 404)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should delete chat when user has access', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true })
      mockWhere.mockResolvedValue(undefined)

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockDelete).toHaveBeenCalled()
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
        message: 'Chat deployment deleted successfully',
      })
    })

    it('should allow deletion when user has workspace admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'admin-user-id' },
        }),
      }))

      // User doesn't own chat but has workspace admin access
      mockCheckChatAccess.mockResolvedValue({ hasAccess: true })
      mockWhere.mockResolvedValue(undefined)

      const req = new NextRequest('http://localhost:3000/api/chat/edit/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'admin-user-id')
      expect(mockDelete).toHaveBeenCalled()
    })
  })
})
