/**
 * Tests for copilot chat update-messages API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReplaceCopilotChatMessages } = vi.hoisted(() => ({
  mockReplaceCopilotChatMessages: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  replaceCopilotChatMessages: mockReplaceCopilotChatMessages,
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
    resetDbChainMock()

    authMockFns.mockGetSession.mockResolvedValue(null)

    dbChainMockFns.returning.mockResolvedValue([{ model: 'gpt-4' }])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Validation error')
    })

    it('should return 400 for invalid request body - missing messages', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Validation error')
    })

    it('should return 400 for invalid message structure - missing required fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', {
        chatId: 'chat-123',
        messages: [
          {
            id: 'msg-1',
          },
        ],
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Validation error')
    })

    it('should return 400 for invalid message role', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Validation error')
    })

    it('should return 404 when chat is not found', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      queueTableRows(schemaMock.copilotChats, [])

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      queueTableRows(schemaMock.copilotChats, [])

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-123',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

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

      expect(dbChainMockFns.select).toHaveBeenCalled()
      expect(dbChainMockFns.update).toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) })
      expect(mockReplaceCopilotChatMessages).toHaveBeenCalledWith(
        'chat-123',
        messages,
        { chatModel: 'gpt-4' },
        expect.anything()
      )
    })

    it('should successfully update chat messages with optional fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-456',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

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

      expect(dbChainMockFns.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) })
      expect(mockReplaceCopilotChatMessages).toHaveBeenCalledWith(
        'chat-456',
        [
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
            contentBlocks: [
              {
                type: 'text',
                content: 'Here is the weather information',
              },
              {
                type: 'tool',
                phase: 'call',
                toolCall: {
                  id: 'tool-1',
                  name: 'get_weather',
                  state: 'pending',
                },
              },
            ],
          },
        ],
        { chatModel: 'gpt-4' },
        expect.anything()
      )
    })

    it('should handle empty messages array', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-789',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

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

      expect(dbChainMockFns.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) })
      expect(mockReplaceCopilotChatMessages).toHaveBeenCalledWith(
        'chat-789',
        [],
        { chatModel: 'gpt-4' },
        expect.anything()
      )
    })

    it('should handle database errors during chat lookup', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      dbChainMockFns.limit.mockRejectedValueOnce(new Error('Database connection failed'))

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-123',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

      dbChainMockFns.returning.mockRejectedValueOnce(new Error('Update operation failed'))

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-large',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

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

      expect(dbChainMockFns.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) })
      expect(mockReplaceCopilotChatMessages).toHaveBeenCalledWith(
        'chat-large',
        messages,
        { chatModel: 'gpt-4' },
        expect.anything()
      )
    })

    it('should handle messages with both user and assistant roles', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const existingChat = {
        id: 'chat-mixed',
        userId: 'user-123',
        messages: [],
      }
      queueTableRows(schemaMock.copilotChats, [existingChat])

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
