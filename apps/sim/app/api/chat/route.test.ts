/**
 * Tests for chat API route
 *
 * @vitest-environment node
 */
import { auditMock, createEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockInsert,
  mockValues,
  mockReturning,
  mockCreateSuccessResponse,
  mockCreateErrorResponse,
  mockEncryptSecret,
  mockCheckWorkflowAccessForChatCreation,
  mockDeployWorkflow,
  mockGetSession,
  mockUuidV4,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockReturning: vi.fn(),
  mockCreateSuccessResponse: vi.fn(),
  mockCreateErrorResponse: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockCheckWorkflowAccessForChatCreation: vi.fn(),
  mockDeployWorkflow: vi.fn(),
  mockGetSession: vi.fn(),
  mockUuidV4: vi.fn(),
}))

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}))

vi.mock('@sim/db/schema', () => ({
  chat: { userId: 'userId', identifier: 'identifier' },
  workflow: { id: 'id', userId: 'userId', isDeployed: 'isDeployed' },
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createSuccessResponse: mockCreateSuccessResponse,
  createErrorResponse: mockCreateErrorResponse,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
}))

vi.mock('uuid', () => ({
  v4: mockUuidV4,
}))

vi.mock('@/app/api/chat/utils', () => ({
  checkWorkflowAccessForChatCreation: mockCheckWorkflowAccessForChatCreation,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  deployWorkflow: mockDeployWorkflow,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    NODE_ENV: 'development',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  })
)

import { GET, POST } from '@/app/api/chat/route'

describe('Chat API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })

    mockUuidV4.mockReturnValue('test-uuid')

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

    mockDeployWorkflow.mockResolvedValue({
      success: true,
      version: 1,
      deployedAt: new Date(),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return chat deployments for authenticated user', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const mockDeployments = [{ id: 'deployment-1' }, { id: 'deployment-2' }]
      mockWhere.mockResolvedValue(mockDeployments)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({ deployments: mockDeployments })
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should handle errors when fetching deployments', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      mockWhere.mockRejectedValue(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(500)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Database error', 500)
    })
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const response = await POST(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should validate request data', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const invalidData = { title: 'Test Chat' } // Missing required fields

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      })
      const response = await POST(req)

      expect(response.status).toBe(400)
    })

    it('should reject if identifier already exists', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([{ id: 'existing-chat' }]) // Identifier exists

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Identifier already in use', 400)
    })

    it('should reject if workflow not found', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Workflow not found or access denied',
        404
      )
    })

    it('should allow chat deployment when user owns workflow directly', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id', email: 'user@example.com' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: true },
      })
      mockReturning.mockResolvedValue([{ id: 'test-uuid' }])

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should allow chat deployment when user has workspace admin permission', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id', email: 'user@example.com' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'other-user-id', workspaceId: 'workspace-123', isDeployed: true },
      })
      mockReturning.mockResolvedValue([{ id: 'test-uuid' }])

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should reject when workflow is in workspace but user lacks admin permission', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: false,
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Workflow not found or access denied',
        404
      )
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should handle workspace permission check errors gracefully', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockRejectedValue(new Error('Permission check failed'))

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(500)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should auto-deploy workflow if not already deployed', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-id', email: 'user@example.com' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: false },
      })
      mockReturning.mockResolvedValue([{ id: 'test-uuid' }])

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockDeployWorkflow).toHaveBeenCalledWith({
        workflowId: 'workflow-123',
        deployedBy: 'user-id',
      })
    })
  })
})
