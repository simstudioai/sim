/**
 * Tests for knowledge base API route
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

describe('Knowledge Base API Route', () => {
  const mockAuth$ = mockAuth()

  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear()
        if (fn !== mockDbChain.orderBy && fn !== mockDbChain.values) {
          fn.mockReturnThis()
        }
      }
    })

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge', () => {
    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockDbChain.orderBy.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/route')
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
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      },
    }

    it('should create knowledge base successfully', async () => {
      mockAuth$.mockAuthenticatedUser()

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe(validKnowledgeBaseData.name)
      expect(data.data.description).toBe(validKnowledgeBaseData.description)
      expect(mockDbChain.insert).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate required fields', async () => {
      mockAuth$.mockAuthenticatedUser()

      const req = createMockRequest('POST', { description: 'Missing name' })
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should validate chunking config constraints', async () => {
      mockAuth$.mockAuthenticatedUser()

      const invalidData = {
        name: 'Test KB',
        chunkingConfig: {
          maxSize: 100,
          minSize: 200, // Invalid: minSize > maxSize
          overlap: 50,
        },
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })

    it('should use default values for optional fields', async () => {
      mockAuth$.mockAuthenticatedUser()

      const minimalData = { name: 'Test KB' }
      const req = createMockRequest('POST', minimalData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.embeddingModel).toBe('text-embedding-3-small')
      expect(data.data.embeddingDimension).toBe(1536)
      expect(data.data.chunkingConfig).toEqual({
        maxSize: 1024,
        minSize: 1,
        overlap: 200,
      })
    })

    it('should handle database errors during creation', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockDbChain.values.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create knowledge base')
    })
  })
})
