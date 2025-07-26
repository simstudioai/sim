/**
 * Tests for knowledge base by ID API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockConsoleLogger,
  mockDrizzleOrm,
  mockKnowledgeSchemas,
} from '@/app/api/__test-utils__/utils'

mockKnowledgeSchemas()
mockDrizzleOrm()
mockConsoleLogger()

describe('Knowledge Base By ID API Route', () => {
  const mockAuth$ = mockAuth()

  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }

  const mockKnowledgeBase = {
    id: 'kb-123',
    userId: 'user-123',
    name: 'Test Knowledge Base',
    description: 'Test description',
    tokenCount: 100,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: null,
    deletedAt: null,
  }

  const resetMocks = () => {
    vi.clearAllMocks()
    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear().mockReset().mockReturnThis()
      }
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })

    it('should retrieve knowledge base successfully for authenticated user', async () => {
      mockAuth$.mockAuthenticatedUser()

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      mockDbChain.limit.mockResolvedValueOnce([mockKnowledgeBase])

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('kb-123')
      expect(data.data.name).toBe('Test Knowledge Base')
      expect(mockDbChain.select).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockAuth$.mockAuthenticatedUser()

      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base owned by different user', async () => {
      mockAuth$.mockAuthenticatedUser()

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'different-user' }])

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockDbChain.limit.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch knowledge base')
    })
  })

  describe('PUT /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })
    const validUpdateData = {
      name: 'Updated Knowledge Base',
      description: 'Updated description',
    }

    it('should update knowledge base successfully', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      mockDbChain.where.mockResolvedValueOnce(undefined)

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([{ ...mockKnowledgeBase, ...validUpdateData }])

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe('Updated Knowledge Base')
      expect(mockDbChain.update).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should validate update data', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      const invalidData = {
        name: '',
      }

      const req = createMockRequest('PUT', invalidData)
      const { PUT } = await import('@/app/api/knowledge/[id]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should handle database errors during update', async () => {
      mockAuth$.mockAuthenticatedUser()

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      mockDbChain.where.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update knowledge base')
    })
  })

  describe('DELETE /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })

    it('should delete knowledge base successfully', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      mockDbChain.where.mockResolvedValueOnce(undefined)

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.message).toBe('Knowledge base deleted successfully')
      expect(mockDbChain.update).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base owned by different user', async () => {
      mockAuth$.mockAuthenticatedUser()

      resetMocks()

      mockDbChain.where.mockReturnValueOnce(mockDbChain) // Return this to continue chain
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'different-user' }])

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during delete', async () => {
      mockAuth$.mockAuthenticatedUser()

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'kb-123', userId: 'user-123' }])

      mockDbChain.where.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete knowledge base')
    })
  })
})
