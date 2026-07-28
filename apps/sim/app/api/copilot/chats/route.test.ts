/**
 * Tests for copilot chats list API route
 *
 * @vitest-environment node
 */
import {
  copilotHttpMock,
  copilotHttpMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: vi
    .fn()
    .mockResolvedValue([
      { workspace: { id: 'workspace-123', createdAt: new Date() }, permissionType: 'admin' },
    ]),
}))

import { GET } from '@/app/api/copilot/chats/route'

describe('Copilot Chats List API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      queueTableRows(schemaMock.copilotChats, [])

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
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      queueTableRows(schemaMock.copilotChats, mockChats)

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
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      queueTableRows(schemaMock.copilotChats, mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].id).toBe('newest-chat')
      expect(responseData.chats[2].id).toBe('oldest-chat')
    })

    it('should handle chats with null workflowId', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      queueTableRows(schemaMock.copilotChats, mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].workflowId).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      dbChainMockFns.orderBy.mockRejectedValueOnce(new Error('Database connection failed'))

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch user chats')
    })

    it('should only return chats belonging to authenticated user', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      queueTableRows(schemaMock.copilotChats, mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      await GET(request as any)

      expect(dbChainMockFns.selectDistinctOn).toHaveBeenCalled()
      expect(dbChainMockFns.where).toHaveBeenCalled()
    })

    it('should return 401 when userId is null despite isAuthenticated being true', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: true,
      })

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
    })
  })
})
