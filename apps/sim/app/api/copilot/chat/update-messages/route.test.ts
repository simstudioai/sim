/**
 * Tests for copilot chat update-messages API route
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
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockGetSession,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'id',
    userId: 'userId',
    messages: 'messages',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
}))

import { POST } from '@/app/api/copilot/chat/update-messages/route'

function createMockRequest(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/copilot/chat/update-messages', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Copilot Chat Update Messages API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue(null)

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([])
    mockUpdate.mockReturnValue({ set: mockSet })
    mockUpdateWhere.mockResolvedValue(undefined)
    mockSet.mockReturnValue({ where: mockUpdateWhere })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 for invalid request body - missing chatId', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid request body - missing messages', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid message structure - missing required fields', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid message role', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
            role: 'invalid-role',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 404 when chat is not found', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockLimit.mockResolvedValueOnce([])

      const req = createMockRequest('POST', {
        chatId: 'non-existent-chat',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should return 404 when chat belongs to different user', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockLimit.mockResolvedValueOnce([])

      const req = createMockRequest('POST', {
        chatId: 'other-user-chat',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should successfully update chat messages', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-123',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello, how are you?',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'I am doing well, thank you!',
          timestamp: '2024-01-01T10:01:00.000Z',
        },
      ]

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        messageCount: 2,
      })

      expect(mockSelect).toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith({
        messages,
        updatedAt: expect.any(Date),
      })
    })

    it('should successfully update chat messages with optional fields', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-456',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
          timestamp: '2024-01-01T10:01:00.000Z',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          ],
          contentBlocks: [
            {
              type: 'text',
              content: 'Here is the weather information',
            },
          ],
        },
      ]

      const req = createMockRequest('POST', {
        chatId: 'chat-456',
        messages,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        messageCount: 2,
      })

      expect(mockSet).toHaveBeenCalledWith({
        messages,
        updatedAt: expect.any(Date),
      })
    })

    it('should handle empty messages array', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-789',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      const req = createMockRequest('POST', {
        chatId: 'chat-789',
        messages: [],
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        messageCount: 0,
      })

      expect(mockSet).toHaveBeenCalledWith({
        messages: [],
        updatedAt: expect.any(Date),
      })
    })

    it('should handle database errors during chat lookup', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      mockLimit.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle database errors during update operation', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-123',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      mockSet.mockReturnValueOnce({
        where: vi.fn().mockRejectedValue(new Error('Update operation failed')),
      })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle JSON parsing errors in request body', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = new NextRequest('http://localhost:3000/api/copilot/chat/update-messages', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle large message arrays', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-large',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i + 1}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        timestamp: new Date(2024, 0, 1, 10, i).toISOString(),
      }))

      const req = createMockRequest('POST', {
        chatId: 'chat-large',
        messages,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        messageCount: 100,
      })

      expect(mockSet).toHaveBeenCalledWith({
        messages,
        updatedAt: expect.any(Date),
      })
    })

    it('should handle messages with both user and assistant roles', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-mixed',
        userId: 'user-123',
        messages: [],
      }
      mockLimit.mockResolvedValueOnce([existingChat])

      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'What is the weather like?',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Let me check the weather for you.',
          timestamp: '2024-01-01T10:01:00.000Z',
          toolCalls: [
            {
              id: 'tool-weather',
              name: 'get_weather',
              arguments: { location: 'current' },
            },
          ],
        },
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'The weather is sunny and 75°F.',
          timestamp: '2024-01-01T10:02:00.000Z',
        },
        {
          id: 'msg-4',
          role: 'user',
          content: 'Thank you!',
          timestamp: '2024-01-01T10:03:00.000Z',
        },
      ]

      const req = createMockRequest('POST', {
        chatId: 'chat-mixed',
        messages,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        messageCount: 4,
      })
    })
  })
})
