/**
 * Tests for copilot chats list API route
 *
 * @vitest-environment node
 */
import { mockCryptoUuid, setupCommonApiMocks } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Chats List API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockOrderBy = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockResolvedValue([])

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
      copilotChats: {
        id: 'id',
        title: 'title',
        workflowId: 'workflowId',
        userId: 'userId',
        updatedAt: 'updatedAt',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
    }))

    vi.doMock('@/lib/copilot/request-helpers', () => ({
      authenticateCopilotRequestSessionOnly: vi.fn(),
      createUnauthorizedResponse: vi
        .fn()
        .mockReturnValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
      createInternalServerErrorResponse: vi
        .fn()
        .mockImplementation(
          (message) => new Response(JSON.stringify({ error: message }), { status: 500 })
        ),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty chats array when user has no chats', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockResolvedValueOnce([])

      const { GET } = await import('@/app/api/copilot/chats/route')
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
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
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

      const { GET } = await import('@/app/api/copilot/chats/route')
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
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
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

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].id).toBe('newest-chat')
      expect(responseData.chats[2].id).toBe('oldest-chat')
    })

    it('should handle chats with null workflowId', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
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

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].workflowId).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockRejectedValueOnce(new Error('Database connection failed'))

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch user chats')
    })

    it('should only return chats belonging to authenticated user', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
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

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      await GET(request as any)

      expect(mockSelect).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should return 401 when userId is null despite isAuthenticated being true', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: null,
        isAuthenticated: true,
      })

      const { GET } = await import('@/app/api/copilot/chats/route')
      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
    })
  })
})
