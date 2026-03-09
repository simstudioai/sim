/**
 * Tests for chat edit API route
 *
 * @vitest-environment node
 */
import { auditMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockUpdate,
  mockSet,
  mockDelete,
  mockCreateSuccessResponse,
  mockCreateErrorResponse,
  mockEncryptSecret,
  mockCheckChatAccess,
  mockDeployWorkflow,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockGetSession: vi.fn(),
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockUpdate: vi.fn(),
    mockSet: vi.fn(),
    mockDelete: vi.fn(),
    mockCreateSuccessResponse: vi.fn(),
    mockCreateErrorResponse: vi.fn(),
    mockEncryptSecret: vi.fn(),
    mockCheckChatAccess: vi.fn(),
    mockDeployWorkflow: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/lib/audit/log', () => auditMock)
vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
  isHosted: false,
  isProd: false,
}))
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))
vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  },
}))
vi.mock('@sim/db/schema', () => ({
  chat: { id: 'id', identifier: 'identifier', userId: 'userId' },
}))
vi.mock('@/app/api/workflows/utils', () => ({
  createSuccessResponse: mockCreateSuccessResponse,
  createErrorResponse: mockCreateErrorResponse,
}))
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn().mockReturnValue('localhost:3000'),
}))
vi.mock('@/app/api/chat/utils', () => ({
  checkChatAccess: mockCheckChatAccess,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  deployWorkflow: mockDeployWorkflow,
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
}))

import { DELETE, GET, PATCH } from '@/app/api/chat/manage/[id]/route'

describe('Chat Edit API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockLimit.mockResolvedValue([])
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    mockCreateSuccessResponse.mockImplementation((data) => {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    mockCreateErrorResponse.mockImplementation((message, status = 500) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-password' })
    mockDeployWorkflow.mockResolvedValue({ success: true, version: 1 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should return chat details when user has access', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

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
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should update chat when user has access', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: mockChat,
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat', description: 'Updated description' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalled()
      const data = await response.json()
      expect(data.id).toBe('chat-123')
      expect(data.chatUrl).toBe('http://localhost:3000/chat/test-chat')
      expect(data.message).toBe('Chat deployment updated successfully')
    })

    it('should handle identifier conflicts', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

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
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Identifier already in use')
    })

    it('should validate password requirement for password auth', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

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
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Password is required when using password protection')
    })

    it('should allow access when user has workspace admin permission', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'admin-user-id' },
      })

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'public',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: mockChat,
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Admin Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'admin-user-id')
    })
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Chat not found or access denied')
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'user-id')
    })

    it('should delete chat when user has access', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: { title: 'Test Chat', workflowId: 'workflow-123' },
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockDelete).toHaveBeenCalled()
      const data = await response.json()
      expect(data.message).toBe('Chat deployment deleted successfully')
    })

    it('should allow deletion when user has workspace admin permission', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'admin-user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: { title: 'Test Chat', workflowId: 'workflow-123' },
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCheckChatAccess).toHaveBeenCalledWith('chat-123', 'admin-user-id')
      expect(mockDelete).toHaveBeenCalled()
    })
  })
})
