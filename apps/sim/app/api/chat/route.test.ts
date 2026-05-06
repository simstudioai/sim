/**
 * Tests for chat API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  createEnvMock,
  dbChainMock,
  dbChainMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkflowAccessForChatCreation } = vi.hoisted(() => ({
  mockCheckWorkflowAccessForChatCreation: vi.fn(),
}))

const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse
const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse
const mockPerformChatDeploy = workflowsOrchestrationMockFns.mockPerformChatDeploy

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/app/api/chat/utils', () => ({
  checkWorkflowAccessForChatCreation: mockCheckWorkflowAccessForChatCreation,
}))

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

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

    mockPerformChatDeploy.mockResolvedValue({
      success: true,
      chatId: 'test-uuid',
      chatUrl: 'http://localhost:3000/chat/test-chat',
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return chat deployments for authenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      const mockDeployments = [{ id: 'deployment-1' }, { id: 'deployment-2' }]
      dbChainMockFns.where.mockResolvedValueOnce(mockDeployments)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({ deployments: mockDeployments })
      expect(dbChainMockFns.where).toHaveBeenCalled()
    })

    it('should handle errors when fetching deployments', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id' },
      })

      dbChainMockFns.where.mockRejectedValueOnce(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/chat')
      const response = await GET(req)

      expect(response.status).toBe(500)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Database error', 500)
    })
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const response = await POST(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should validate request data', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'existing-chat' }]) // Identifier exists
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Identifier already in use', 400)
    })

    it('should reject if workflow not found', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
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
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: true },
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
      expect(mockPerformChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-123',
          userId: 'user-id',
          identifier: 'test-chat',
        })
      )
    })

    it('passes chat customizations and outputConfigs through in the API request shape', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-id', email: 'user@example.com' },
      })

      const validData = {
        workflowId: 'workflow-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
          imageUrl: 'https://example.com/icon.png',
        },
        outputConfigs: [{ blockId: 'agent-1', path: 'content' }],
      }

      dbChainMockFns.limit.mockResolvedValueOnce([])
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: true },
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockPerformChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-123',
          identifier: 'test-chat',
          customizations: {
            primaryColor: '#000000',
            welcomeMessage: 'Hello',
            imageUrl: 'https://example.com/icon.png',
          },
          outputConfigs: [{ blockId: 'agent-1', path: 'content' }],
        })
      )
    })

    it('should allow chat deployment when user has workspace admin permission', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'other-user-id', workspaceId: 'workspace-123', isDeployed: true },
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
      expect(mockPerformChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-123',
          workspaceId: 'workspace-123',
        })
      )
    })

    it('should reject when workflow is in workspace but user lacks admin permission', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
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
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockRejectedValue(new Error('Permission check failed'))

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(500)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should call performChatDeploy for undeployed workflow', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
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

      dbChainMockFns.limit.mockResolvedValueOnce([]) // Identifier is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: false },
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockPerformChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-123',
          userId: 'user-id',
        })
      )
    })
  })
})
