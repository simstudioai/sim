/**
 * Tests for copilot chat update-messages API route
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

describe('Copilot Chat Update Messages API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([]) // Default: no chat found
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) // Different where for update

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
        update: mockUpdate,
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
      copilotChats: {
        id: 'id',
        userId: 'userId',
        messages: 'messages',
        updatedAt: 'updatedAt',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 for invalid request body - missing chatId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        // Missing chatId
      })

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid request body - missing messages', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        // Missing messages
      })

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid message structure - missing required fields', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
            // Missing role, content, timestamp
          },
        ],
      })

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 400 for invalid message role', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should return 404 when chat is not found', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat not found
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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should return 404 when chat belongs to different user', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock chat not found (due to user mismatch)
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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Chat not found or unauthorized')
    })

    it('should successfully update chat messages', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
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
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
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
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
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
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle database errors during update operation', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle JSON parsing errors in request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/chat/update-messages', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update chat messages')
    })

    it('should handle large message arrays', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
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
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

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

      const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
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
