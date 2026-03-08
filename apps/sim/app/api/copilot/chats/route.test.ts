/**
 * Tests for copilot chats list API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockAuthenticate,
  mockCreateUnauthorizedResponse,
  mockCreateInternalServerErrorResponse,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockAuthenticate: vi.fn(),
  mockCreateUnauthorizedResponse: vi.fn(),
  mockCreateInternalServerErrorResponse: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'id',
    title: 'title',
    workflowId: 'workflowId',
    userId: 'userId',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
}))

vi.mock('@/lib/copilot/request-helpers', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticate,
  createUnauthorizedResponse: mockCreateUnauthorizedResponse,
  createInternalServerErrorResponse: mockCreateInternalServerErrorResponse,
}))

import { GET } from '@/app/api/copilot/chats/route'

describe('Copilot Chats List API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockResolvedValue([])

    mockCreateUnauthorizedResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    )
    mockCreateInternalServerErrorResponse.mockImplementation(
      (message: string) => new Response(JSON.stringify({ error: message }), { status: 500 })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty chats array when user has no chats', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockResolvedValueOnce([])

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        chats: [],
      })
    })

    it('should return list of chats for authenticated user', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'chat-1',
          title: 'First Chat',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'chat-2',
          title: 'Second Chat',
          workflowId: 'workflow-2',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.chats).toHaveLength(2)
      expect(responseData.chats[0].id).toBe('chat-1')
      expect(responseData.chats[0].title).toBe('First Chat')
      expect(responseData.chats[1].id).toBe('chat-2')
    })

    it('should return chats ordered by updatedAt descending', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'newest-chat',
          title: 'Newest',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-10'),
        },
        {
          id: 'older-chat',
          title: 'Older',
          workflowId: 'workflow-2',
          updatedAt: new Date('2024-01-05'),
        },
        {
          id: 'oldest-chat',
          title: 'Oldest',
          workflowId: 'workflow-3',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].id).toBe('newest-chat')
      expect(responseData.chats[2].id).toBe('oldest-chat')
    })

    it('should handle chats with null workflowId', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'chat-no-workflow',
          title: 'Chat without workflow',
          workflowId: null,
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].workflowId).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockRejectedValueOnce(new Error('Database connection failed'))

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch user chats')
    })

    it('should only return chats belonging to authenticated user', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'my-chat',
          title: 'My Chat',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      await GET(request as any)

      expect(mockSelect).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should return 401 when userId is null despite isAuthenticated being true', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: true,
      })

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
    })
  })
})
