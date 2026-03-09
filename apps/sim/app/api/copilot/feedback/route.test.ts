/**
 * Tests for copilot feedback API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInsert,
  mockValues,
  mockReturning,
  mockSelect,
  mockFrom,
  mockAuthenticate,
  mockCreateUnauthorizedResponse,
  mockCreateBadRequestResponse,
  mockCreateInternalServerErrorResponse,
  mockCreateRequestTracker,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockReturning: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockAuthenticate: vi.fn(),
  mockCreateUnauthorizedResponse: vi.fn(),
  mockCreateBadRequestResponse: vi.fn(),
  mockCreateInternalServerErrorResponse: vi.fn(),
  mockCreateRequestTracker: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotFeedback: {
    feedbackId: 'feedbackId',
    userId: 'userId',
    chatId: 'chatId',
    userQuery: 'userQuery',
    agentResponse: 'agentResponse',
    isPositive: 'isPositive',
    feedback: 'feedback',
    workflowYaml: 'workflowYaml',
    createdAt: 'createdAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
}))

vi.mock('@/lib/copilot/request-helpers', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticate,
  createUnauthorizedResponse: mockCreateUnauthorizedResponse,
  createBadRequestResponse: mockCreateBadRequestResponse,
  createInternalServerErrorResponse: mockCreateInternalServerErrorResponse,
  createRequestTracker: mockCreateRequestTracker,
}))

import { GET, POST } from '@/app/api/copilot/feedback/route'

function createMockRequest(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/copilot/feedback', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Copilot Feedback API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockResolvedValue([])
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockResolvedValue([])

    mockCreateRequestTracker.mockReturnValue({
      requestId: 'test-request-id',
      getDuration: vi.fn().mockReturnValue(100),
    })
    mockCreateUnauthorizedResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    )
    mockCreateBadRequestResponse.mockImplementation(
      (message: string) => new Response(JSON.stringify({ error: message }), { status: 400 })
    )
    mockCreateInternalServerErrorResponse.mockImplementation(
      (message: string) => new Response(JSON.stringify({ error: message }), { status: 500 })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should successfully submit positive feedback', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const feedbackRecord = {
        feedbackId: 'feedback-123',
        userId: 'user-123',
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
        isPositive: true,
        feedback: null,
        workflowYaml: null,
        createdAt: new Date('2024-01-01'),
      }
      mockReturning.mockResolvedValueOnce([feedbackRecord])

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.feedbackId).toBe('feedback-123')
      expect(responseData.message).toBe('Feedback submitted successfully')
    })

    it('should successfully submit negative feedback with text', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const feedbackRecord = {
        feedbackId: 'feedback-456',
        userId: 'user-123',
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I deploy?',
        agentResponse: 'Here is how to deploy...',
        isPositive: false,
        feedback: 'The response was not helpful',
        workflowYaml: null,
        createdAt: new Date('2024-01-01'),
      }
      mockReturning.mockResolvedValueOnce([feedbackRecord])

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I deploy?',
        agentResponse: 'Here is how to deploy...',
        isPositiveFeedback: false,
        feedback: 'The response was not helpful',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.feedbackId).toBe('feedback-456')
    })

    it('should successfully submit feedback with workflow YAML', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const workflowYaml = `
blocks:
  - id: starter
    type: starter
  - id: agent
    type: agent
edges:
  - source: starter
    target: agent
`

      const feedbackRecord = {
        feedbackId: 'feedback-789',
        userId: 'user-123',
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'Build a simple agent workflow',
        agentResponse: 'I created a workflow for you.',
        isPositive: true,
        feedback: null,
        workflowYaml: workflowYaml,
        createdAt: new Date('2024-01-01'),
      }
      mockReturning.mockResolvedValueOnce([feedbackRecord])

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'Build a simple agent workflow',
        agentResponse: 'I created a workflow for you.',
        isPositiveFeedback: true,
        workflowYaml: workflowYaml,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowYaml: workflowYaml,
        })
      )
    })

    it('should return 400 for invalid chatId format', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        chatId: 'not-a-uuid',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should return 400 for empty userQuery', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: '',
        agentResponse: 'You can create a workflow by...',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should return 400 for empty agentResponse', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: '',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should return 400 for missing isPositiveFeedback', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockReturning.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('POST', {
        chatId: '550e8400-e29b-41d4-a716-446655440000',
        userQuery: 'How do I create a workflow?',
        agentResponse: 'You can create a workflow by...',
        isPositiveFeedback: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to submit feedback')
    })

    it('should handle JSON parsing errors in request body', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/feedback', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty feedback array when no feedback exists', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFrom.mockResolvedValueOnce([])

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.feedback).toEqual([])
    })

    it('should return all feedback records', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockFeedback = [
        {
          feedbackId: 'feedback-1',
          userId: 'user-123',
          chatId: 'chat-1',
          userQuery: 'Query 1',
          agentResponse: 'Response 1',
          isPositive: true,
          feedback: null,
          workflowYaml: null,
          createdAt: new Date('2024-01-01'),
        },
        {
          feedbackId: 'feedback-2',
          userId: 'user-456',
          chatId: 'chat-2',
          userQuery: 'Query 2',
          agentResponse: 'Response 2',
          isPositive: false,
          feedback: 'Not helpful',
          workflowYaml: 'yaml: content',
          createdAt: new Date('2024-01-02'),
        },
      ]
      mockFrom.mockResolvedValueOnce(mockFeedback)

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.feedback).toHaveLength(2)
      expect(responseData.feedback[0].feedbackId).toBe('feedback-1')
      expect(responseData.feedback[1].feedbackId).toBe('feedback-2')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFrom.mockRejectedValueOnce(new Error('Database connection failed'))

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to retrieve feedback')
    })

    it('should return metadata with response', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFrom.mockResolvedValueOnce([])

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.metadata).toBeDefined()
      expect(responseData.metadata.requestId).toBeDefined()
      expect(responseData.metadata.duration).toBeDefined()
    })
  })
})
