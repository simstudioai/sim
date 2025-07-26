import { NextRequest } from 'next/server'
/**
 * Tests for chat API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Chat API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockReturning = vi.fn()

  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()
  const mockEncryptSecret = vi.fn()
  const mockCheckWorkflowAccessForChatCreation = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
      },
    }))

    vi.doMock('@/db/schema', () => ({
      chat: { userId: 'userId', subdomain: 'subdomain' },
      workflow: { id: 'id', userId: 'userId', isDeployed: 'isDeployed' },
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
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

    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('test-uuid'),
    }))

    vi.doMock('@/app/api/chat/utils', () => ({
      checkWorkflowAccessForChatCreation: mockCheckWorkflowAccessForChatCreation,
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

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('./route')
      const response = await GET(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return chat deployments for authenticated user', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockDeployments = [{ id: 'deployment-1' }, { id: 'deployment-2' }]
      mockWhere.mockResolvedValue(mockDeployments)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('./route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({ deployments: mockDeployments })
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should handle errors when fetching deployments', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockWhere.mockRejectedValue(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('./route')
      const response = await GET(req)

      expect(response.status).toBe(500)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Database error', 500)
    })
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should validate request data', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const invalidData = { title: 'Test Chat' } // Missing required fields

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(400)
    })

    it('should reject if subdomain already exists', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([{ id: 'existing-chat' }]) // Subdomain exists

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Subdomain already in use', 400)
    })

    it('should reject if workflow not found', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({ hasAccess: false })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Workflow not found or access denied',
        404
      )
    })

    it('should allow chat deployment when user owns workflow directly', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      vi.doMock('@/lib/env', () => ({
        env: {
          NODE_ENV: 'development',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        },
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: true },
      })
      mockReturning.mockResolvedValue([{ id: 'test-uuid' }])

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should allow chat deployment when user has workspace admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      vi.doMock('@/lib/env', () => ({
        env: {
          NODE_ENV: 'development',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        },
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'other-user-id', workspaceId: 'workspace-123', isDeployed: true },
      })
      mockReturning.mockResolvedValue([{ id: 'test-uuid' }])

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should reject when workflow is in workspace but user lacks admin permission', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: false,
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Workflow not found or access denied',
        404
      )
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should handle workspace permission check errors gracefully', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockRejectedValue(new Error('Permission check failed'))

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      expect(mockCheckWorkflowAccessForChatCreation).toHaveBeenCalledWith('workflow-123', 'user-id')
    })

    it('should reject if workflow is not deployed', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const validData = {
        workflowId: 'workflow-123',
        subdomain: 'test-chat',
        title: 'Test Chat',
        customizations: {
          primaryColor: '#000000',
          welcomeMessage: 'Hello',
        },
      }

      mockLimit.mockResolvedValueOnce([]) // Subdomain is available
      mockCheckWorkflowAccessForChatCreation.mockResolvedValue({
        hasAccess: true,
        workflow: { userId: 'user-id', workspaceId: null, isDeployed: false },
      })

      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify(validData),
      })
      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Workflow must be deployed before creating a chat',
        400
      )
    })
  })
})
