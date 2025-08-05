/**
 * Tests for copilot checkpoints API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockCryptoUuid,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Checkpoints API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockOrderBy = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockReturning = vi.fn()

  const mockCopilotChats = { id: 'id', userId: 'userId' }
  const mockWorkflowCheckpoints = {
    id: 'id',
    userId: 'userId',
    workflowId: 'workflowId',
    chatId: 'chatId',
    messageId: 'messageId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({
      orderBy: mockOrderBy,
      limit: mockLimit,
    })
    mockOrderBy.mockResolvedValue([])
    mockLimit.mockResolvedValue([])
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
      },
    }))

    vi.doMock('@/db/schema', () => ({
      copilotChats: mockCopilotChats,
      workflowCheckpoints: mockWorkflowCheckpoints,
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 500 for invalid request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        // Missing required fields
        workflowId: 'workflow-123',
        // Missing chatId and workflowState
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })

    it('should return 400 when chat not found or unauthorized', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat not found
      mockLimit.mockResolvedValue([])

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should return 400 for invalid workflow state JSON', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat exists
      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: 'invalid-json', // Invalid JSON
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid workflow state JSON')
    })

    it('should successfully create a checkpoint', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat exists
      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      // Mock successful checkpoint creation
      const checkpoint = {
        id: 'checkpoint-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }
      mockReturning.mockResolvedValue([checkpoint])

      const workflowState = { blocks: [], connections: [] }
      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        workflowState: JSON.stringify(workflowState),
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        checkpoint: {
          id: 'checkpoint-123',
          userId: 'user-123',
          workflowId: 'workflow-123',
          chatId: 'chat-123',
          messageId: 'message-123',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      })

      // Verify database operations
      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith({
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        workflowState: workflowState, // Should be parsed JSON object
      })
    })

    it('should create checkpoint without messageId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat exists
      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      // Mock successful checkpoint creation
      const checkpoint = {
        id: 'checkpoint-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: undefined,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }
      mockReturning.mockResolvedValue([checkpoint])

      const workflowState = { blocks: [] }
      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        // No messageId provided
        workflowState: JSON.stringify(workflowState),
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.checkpoint.messageId).toBeUndefined()
    })

    it('should handle database errors during checkpoint creation', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat exists
      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      // Mock database error
      mockReturning.mockRejectedValue(new Error('Database insert failed'))

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })

    it('should handle database errors during chat lookup', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock database error during chat lookup
      mockLimit.mockRejectedValue(new Error('Database query failed'))

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const { GET } = await import('@/app/api/copilot/checkpoints/route')
      const response = await GET(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when chatId is missing', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints')

      const { GET } = await import('@/app/api/copilot/checkpoints/route')
      const response = await GET(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('chatId is required')
    })

    it('should return checkpoints for authenticated user and chat', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoints = [
        {
          id: 'checkpoint-1',
          userId: 'user-123',
          workflowId: 'workflow-123',
          chatId: 'chat-123',
          messageId: 'message-1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'checkpoint-2',
          userId: 'user-123',
          workflowId: 'workflow-123',
          chatId: 'chat-123',
          messageId: 'message-2',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ]

      mockOrderBy.mockResolvedValue(mockCheckpoints)

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const { GET } = await import('@/app/api/copilot/checkpoints/route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        checkpoints: [
          {
            id: 'checkpoint-1',
            userId: 'user-123',
            workflowId: 'workflow-123',
            chatId: 'chat-123',
            messageId: 'message-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'checkpoint-2',
            userId: 'user-123',
            workflowId: 'workflow-123',
            chatId: 'chat-123',
            messageId: 'message-2',
            createdAt: '2024-01-02T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      })

      // Verify database query was made correctly
      expect(mockSelect).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
      expect(mockOrderBy).toHaveBeenCalled()
    })

    it('should handle database errors when fetching checkpoints', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock database error
      mockOrderBy.mockRejectedValue(new Error('Database query failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const { GET } = await import('@/app/api/copilot/checkpoints/route')
      const response = await GET(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch checkpoints')
    })

    it('should return empty array when no checkpoints found', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockOrderBy.mockResolvedValue([])

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const { GET } = await import('@/app/api/copilot/checkpoints/route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        checkpoints: [],
      })
    })
  })
})
