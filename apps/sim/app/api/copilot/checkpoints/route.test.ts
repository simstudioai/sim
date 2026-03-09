/**
 * Tests for copilot checkpoints API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockInsert,
  mockValues,
  mockReturning,
  mockGetSession,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockOrderBy: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockReturning: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: { id: 'id', userId: 'userId' },
  workflowCheckpoints: {
    id: 'id',
    userId: 'userId',
    workflowId: 'workflowId',
    chatId: 'chatId',
    messageId: 'messageId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
}))

import { GET, POST } from '@/app/api/copilot/checkpoints/route'

function createMockRequest(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/copilot/checkpoints', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Copilot Checkpoints API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue(null)

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 500 for invalid request body', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })

    it('should return 400 when chat not found or unauthorized', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockLimit.mockResolvedValue([])

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should return 400 for invalid workflow state JSON', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: 'invalid-json',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid workflow state JSON')
    })

    it('should successfully create a checkpoint', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

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

      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith({
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        workflowState: workflowState,
      })
    })

    it('should create checkpoint without messageId', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

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
        workflowState: JSON.stringify(workflowState),
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.checkpoint.messageId).toBeUndefined()
    })

    it('should handle database errors during checkpoint creation', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const chat = {
        id: 'chat-123',
        userId: 'user-123',
      }
      mockLimit.mockResolvedValue([chat])

      mockReturning.mockRejectedValue(new Error('Database insert failed'))

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })

    it('should handle database errors during chat lookup', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockLimit.mockRejectedValue(new Error('Database query failed'))

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        workflowState: '{"blocks": []}',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to create checkpoint')
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const response = await GET(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when chatId is missing', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints')

      const response = await GET(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('chatId is required')
    })

    it('should return checkpoints for authenticated user and chat', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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

      expect(mockSelect).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
      expect(mockOrderBy).toHaveBeenCalled()
    })

    it('should handle database errors when fetching checkpoints', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockOrderBy.mockRejectedValue(new Error('Database query failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const response = await GET(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch checkpoints')
    })

    it('should return empty array when no checkpoints found', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockOrderBy.mockResolvedValue([])

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

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
