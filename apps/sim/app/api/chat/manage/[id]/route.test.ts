/**
 * Tests for chat edit API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  dbChainMock,
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
  workflowsPersistenceUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckChatAccess, mockValidateChatDeployAuth } = vi.hoisted(() => ({
  mockCheckChatAccess: vi.fn(),
  mockValidateChatDeployAuth: vi.fn(),
}))

const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse
const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse
const mockCheckNeedsRedeployment = workflowsApiUtilsMockFns.mockCheckNeedsRedeployment
const mockEncryptSecret = encryptionMockFns.mockEncryptSecret
const mockPerformFullDeploy = workflowsOrchestrationMockFns.mockPerformFullDeploy
const mockPerformChatUndeploy = workflowsOrchestrationMockFns.mockPerformChatUndeploy
const mockGetWorkflowDeploymentSummary =
  workflowsOrchestrationMockFns.mockGetWorkflowDeploymentSummary
const mockNotifySocketDeploymentChanged =
  workflowsOrchestrationMockFns.mockNotifySocketDeploymentChanged

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn().mockReturnValue('localhost:3000'),
}))
vi.mock('@/app/api/chat/utils', () => ({
  checkChatAccess: mockCheckChatAccess,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ChatDeployAuthNotAllowedError extends Error {
    constructor() {
      super('This chat authentication mode is not allowed based on your permission group settings')
      this.name = 'ChatDeployAuthNotAllowedError'
    }
  }
  return { validateChatDeployAuth: mockValidateChatDeployAuth, ChatDeployAuthNotAllowedError }
})
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

import { DELETE, GET, PATCH } from '@/app/api/chat/manage/[id]/route'
import { ChatDeployAuthNotAllowedError } from '@/ee/access-control/utils/permission-check'

beforeAll(() => {
  setEnvFlags({ isDev: true })
})

afterAll(resetEnvFlagsMock)

describe('Chat Edit API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockPerformChatUndeploy.mockResolvedValue({ success: true })

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
    mockGetWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mockCheckNeedsRedeployment.mockResolvedValue(false)
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      version: 1,
      latestDeploymentAttempt: { status: 'active' },
    })
    mockNotifySocketDeploymentChanged.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue(null)

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
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue({
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
      expect(dbChainMockFns.update).toHaveBeenCalled()
      const data = await response.json()
      expect(data.id).toBe('chat-123')
      expect(data.chatUrl).toBe('http://localhost:3000/chat/test-chat')
      expect(data.message).toBe('Chat deployment updated successfully')
    })

    it('returns 403 when the updated auth type changes to a blocked mode', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: {
          id: 'chat-123',
          identifier: 'test-chat',
          authType: 'password',
          workflowId: 'workflow-123',
        },
        workspaceId: 'workspace-123',
      })
      mockValidateChatDeployAuth.mockRejectedValueOnce(new ChatDeployAuthNotAllowedError())

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ authType: 'public' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(403)
      expect(mockValidateChatDeployAuth).toHaveBeenCalledWith('user-id', 'workspace-123', 'public')
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('does not re-check the auth mode when it is unchanged (grandfathered)', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: {
          id: 'chat-123',
          identifier: 'test-chat',
          authType: 'public',
          workflowId: 'workflow-123',
        },
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ authType: 'public', title: 'Renamed' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockValidateChatDeployAuth).not.toHaveBeenCalled()
    })

    it('rejects the update without admitting a new deploy while an attempt is in flight', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-id' } })
      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: { id: 'chat-123', identifier: 'test-chat', workflowId: 'workflow-123' },
        workspaceId: 'workspace-123',
      })
      mockGetWorkflowDeploymentSummary.mockResolvedValue({
        activeDeployment: null,
        latestDeploymentAttempt: { status: 'preparing' },
        warnings: [],
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(409)
      expect(mockPerformFullDeploy).not.toHaveBeenCalled()
    })

    it('skips redeploying when the active version already matches the draft', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-id' } })
      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: { id: 'chat-123', identifier: 'test-chat', workflowId: 'workflow-123' },
        workspaceId: 'workspace-123',
      })
      mockGetWorkflowDeploymentSummary.mockResolvedValue({
        activeDeployment: {
          deploymentVersionId: 'dv-1',
          version: 3,
          deployedAt: '2026-07-15T00:00:00.000Z',
        },
        latestDeploymentAttempt: { status: 'active' },
        warnings: [],
      })
      mockCheckNeedsRedeployment.mockResolvedValue(false)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockPerformFullDeploy).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).toHaveBeenCalled()
    })

    it('should handle identifier conflicts', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({ hasAccess: true, chat: mockChat })

      dbChainMockFns.limit.mockResolvedValueOnce([
        { id: 'other-chat-id', identifier: 'new-identifier' },
      ])

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
      authMockFns.mockGetSession.mockResolvedValue({
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

    it('should keep the existing password when updating a password-protected chat', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const mockChat = {
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        authType: 'password',
        password: 'encrypted-password',
        workflowId: 'workflow-123',
      }

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: mockChat,
        workspaceId: 'workspace-123',
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({ authType: 'password', title: 'Updated Chat' }),
      })
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockEncryptSecret).not.toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'password',
          allowedEmails: [],
          updatedAt: expect.any(Date),
        })
      )

      const updatePayload = dbChainMockFns.set.mock.calls[0]?.[0]
      expect(updatePayload.password).toBeUndefined()
    })

    it('should allow access when user has workspace admin permission', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when chat not found or access denied', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue({
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
      expect(mockPerformChatUndeploy).toHaveBeenCalledWith({
        chatId: 'chat-123',
        userId: 'user-id',
        workspaceId: 'workspace-123',
      })
      const data = await response.json()
      expect(data.message).toBe('Chat deployment deleted successfully')
    })

    it('should allow deletion when user has workspace admin permission', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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
      expect(mockPerformChatUndeploy).toHaveBeenCalledWith({
        chatId: 'chat-123',
        userId: 'admin-user-id',
        workspaceId: 'workspace-123',
      })
    })
  })
})
