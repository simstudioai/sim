/**
 * Tests for knowledge base API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbChain } = vi.hoisted(() => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  }
  return { mockDbChain }
})

vi.mock('@sim/db', () => ({
  db: mockDbChain,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET, POST } from '@/app/api/knowledge/route'

describe('Knowledge Base API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear()
        if (fn !== mockDbChain.orderBy && fn !== mockDbChain.values && fn !== mockDbChain.limit) {
          fn.mockReturnThis()
        }
      }
    })

    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge', () => {
    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })
      mockDbChain.orderBy.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch knowledge bases')
    })
  })

  describe('POST /api/knowledge', () => {
    const validKnowledgeBaseData = {
      name: 'Test Knowledge Base',
      description: 'Test description',
      workspaceId: 'test-workspace-id',
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      },
    }

    it('should create knowledge base successfully', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe(validKnowledgeBaseData.name)
      expect(data.data.description).toBe(validKnowledgeBaseData.description)
      expect(mockDbChain.insert).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate required fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', { description: 'Missing name' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should require workspaceId', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', { name: 'Test KB' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should validate chunking config constraints', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const invalidData = {
        name: 'Test KB',
        workspaceId: 'test-workspace-id',
        chunkingConfig: {
          maxSize: 100, // 100 tokens = 400 characters
          minSize: 500, // Invalid: minSize (500 chars) > maxSize (400 chars)
          overlap: 50,
        },
      }

      const req = createMockRequest('POST', invalidData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })

    it('should use default values for optional fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const minimalData = { name: 'Test KB', workspaceId: 'test-workspace-id' }
      const req = createMockRequest('POST', minimalData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.embeddingModel).toBe('text-embedding-3-small')
      expect(data.data.embeddingDimension).toBe(1536)
      expect(data.data.chunkingConfig).toEqual({
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      })
    })

    it('should handle database errors during creation', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })
      mockDbChain.values.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create knowledge base')
    })
  })
})
