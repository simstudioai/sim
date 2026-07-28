/**
 * Tests for copilot checkpoints API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccessibleCopilotChat } = vi.hoisted(() => ({
  mockGetAccessibleCopilotChat: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChat: mockGetAccessibleCopilotChat,
  getAccessibleCopilotChatAuth: mockGetAccessibleCopilotChat,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { GET, POST } from './route'

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
    resetDbChainMock()

    authMockFns.mockGetSession.mockResolvedValue(null)

    mockGetAccessibleCopilotChat.mockResolvedValue({
      id: 'chat-123',
      userId: 'user-123',
      workflowId: 'workflow-123',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
    })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

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

    it('should return 400 for invalid request body', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        workflowId: 'workflow-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(typeof responseData.error).toBe('string')
    })

    it('should return 400 when chat not found or unauthorized', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockGetAccessibleCopilotChat.mockResolvedValueOnce(null)

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const checkpoint = {
        id: 'checkpoint-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }
      dbChainMockFns.returning.mockResolvedValueOnce([checkpoint])

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

      expect(dbChainMockFns.insert).toHaveBeenCalled()
      expect(dbChainMockFns.values).toHaveBeenCalledWith({
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: 'message-123',
        workflowState: workflowState,
      })
    })

    it('should create checkpoint without messageId', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const checkpoint = {
        id: 'checkpoint-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
        messageId: undefined,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }
      dbChainMockFns.returning.mockResolvedValueOnce([checkpoint])

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      dbChainMockFns.returning.mockRejectedValueOnce(new Error('Database insert failed'))

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockGetAccessibleCopilotChat.mockRejectedValueOnce(new Error('Database query failed'))

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
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const response = await GET(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when chatId is missing', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints')

      const response = await GET(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('chatId is required')
    })

    it('should return checkpoints for authenticated user and chat', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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

      queueTableRows(schemaMock.workflowCheckpoints, mockCheckpoints)

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

      expect(dbChainMockFns.select).toHaveBeenCalled()
      expect(dbChainMockFns.where).toHaveBeenCalled()
      expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    })

    it('should handle database errors when fetching checkpoints', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      dbChainMockFns.orderBy.mockRejectedValueOnce(new Error('Database query failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints?chatId=chat-123')

      const response = await GET(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch checkpoints')
    })

    it('should return empty array when no checkpoints found', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      queueTableRows(schemaMock.workflowCheckpoints, [])

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
