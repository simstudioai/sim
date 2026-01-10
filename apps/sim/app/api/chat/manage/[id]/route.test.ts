/**
 * Tests for chat edit API route
 *
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
  isHosted: false,
  isProd: false,
}))

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
  const mockDeployWorkflow = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    mockLimit.mockResolvedValue([])
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
      chat: { id: 'id', identifier: 'identifier', userId: 'userId' },
    }))

    // Mock logger - use loggerMock from @sim/testing
    vi.doMock('@sim/logger', () => loggerMock)

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

    vi.doMock('@/lib/core/security/encryption', () => ({
      encryptSecret: mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-password' }),
    }))

    vi.doMock('@/lib/core/utils/urls', () => ({
      getEmailDomain: vi.fn().mockReturnValue('localhost:3000'),
    }))

    vi.doMock('@/app/api/chat/utils', () => ({
      checkChatAccess: mockCheckChatAccess,
    }))

    mockDeployWorkflow.mockResolvedValue({ success: true, version: 1 })
    vi.doMock('@/lib/workflows/persistence/utils', () => ({
      deployWorkflow: mockDeployWorkflow,
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
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

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
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
        identifier: 'test-chat',
        title: 'Test Chat',
        description: 'A test chat',
        password: 'encrypted-password',
        customizations: { primaryColor: '#000000' },
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.id).toBe('chat-123')
      expect(data.identifier).toBe('test-chat')
      expect(data.title).toBe('Test Chat')
      expect(data.chatUrl).toBe('http://localhost:3000/chat/test-chat')
      expect(data.hasPassword).toBe(true)
    })
  })

  describe('PATCH', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
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
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })
      mockLimit.mockResolvedValueOnce([]) // No identifier conflict

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat', description: 'Updated description' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalled()
      const data = await response.json()
      expect(data.id).toBe('chat-123')
      expect(data.chatUrl).toBe('http://localhost:3000/chat/test-chat')
      expect(data.message).toBe('Chat deployment updated successfully')
    })

    it('should handle identifier conflicts', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      mockLimit.mockReset()
      mockLimit.mockResolvedValue([{ id: 'other-chat-id', identifier: 'new-identifier' }])
      mockWhere.mockReturnValue({ limit: mockLimit })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'new-identifier' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Identifier already in use')
    })

    it('should validate password requirement for password auth', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        password: null,
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ authType: 'password' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Password is required when using password protection')
    })

    it('should allow access when user has workspace admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'admin-user-id' },
        }),
      }))

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })
      mockLimit.mockResolvedValueOnce([])

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Admin Updated Chat' }),
      })
      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
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

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('@/app/api/chat/manage/[id]/route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('@/app/api/chat/manage/[id]/route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
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

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('@/app/api/chat/manage/[id]/route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockDelete).toHaveBeenCalled()
      const data = await response.json()
      expect(data.message).toBe('Chat deployment deleted successfully')
    })

    it('should allow deletion when user has workspace admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'admin-user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true })
      mockWhere.mockResolvedValue(undefined)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const { DELETE } = await import('@/app/api/chat/manage/[id]/route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'admin-user-id')
      expect(mockDelete).toHaveBeenCalled()
    })
  })
})
