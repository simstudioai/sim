/**
 * Tests for knowledge search API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockConsoleLogger,
  mockKnowledgeSchemas,
} from '@/app/api/__test-utils__/utils'

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockImplementation((...args) => ({ and: args })),
  eq: vi.fn().mockImplementation((a, b) => ({ eq: [a, b] })),
  inArray: vi.fn().mockImplementation((field, values) => ({ inArray: [field, values] })),
  isNull: vi.fn().mockImplementation((arg) => ({ isNull: arg })),
  sql: vi.fn().mockImplementation((strings, ...values) => ({
    sql: strings,
    values,
    as: vi.fn().mockReturnValue({ sql: strings, values, alias: 'mocked_alias' }),
  })),
}))

mockKnowledgeSchemas()

vi.mock('@/lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'test-api-key',
  },
}))

vi.mock('@/lib/documents/utils', () => ({
  retryWithExponentialBackoff: vi.fn().mockImplementation((fn) => fn()),
}))

mockConsoleLogger()

describe('Knowledge Search API Route', () => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  }

  const mockGetUserId = vi.fn()
  const mockFetch = vi.fn()

  const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]
  const mockSearchResults = [
    {
      id: 'chunk-1',
      content: 'This is a test chunk',
      documentId: 'doc-1',
      chunkIndex: 0,
      metadata: { title: 'Test Document' },
      distance: 0.2,
    },
    {
      id: 'chunk-2',
      content: 'Another test chunk',
      documentId: 'doc-2',
      chunkIndex: 1,
      metadata: { title: 'Another Document' },
      distance: 0.3,
    },
  ]

  beforeEach(async () => {
    vi.clearAllMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.doMock('@/app/api/auth/oauth/utils', () => ({
      getUserId: mockGetUserId,
    }))

    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear().mockReturnThis()
      }
    })

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })

    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/knowledge/search', () => {
    const validSearchData = {
      knowledgeBaseIds: 'kb-123',
      query: 'test search query',
      topK: 10,
    }

    const mockKnowledgeBases = [
      {
        id: 'kb-123',
        userId: 'user-123',
        name: 'Test KB',
        deletedAt: null,
      },
    ]

    it('should perform search successfully with single knowledge base', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce(mockKnowledgeBases)

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.results[0].similarity).toBe(0.8) // 1 - 0.2
      expect(data.data.query).toBe(validSearchData.query)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123'])
      expect(mockDbChain.select).toHaveBeenCalled()
    })

    it('should perform search successfully with multiple knowledge bases', async () => {
      const multiKbData = {
        ...validSearchData,
        knowledgeBaseIds: ['kb-123', 'kb-456'],
      }

      const multiKbs = [
        ...mockKnowledgeBases,
        { id: 'kb-456', userId: 'user-123', name: 'Test KB 2', deletedAt: null },
      ]

      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce(multiKbs)

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', multiKbData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123', 'kb-456'])
    })

    it('should handle workflow-based authentication', async () => {
      const workflowData = {
        ...validSearchData,
        workflowId: 'workflow-123',
      }

      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce(mockKnowledgeBases) // First call: get knowledge bases

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults) // Second call: search results

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', workflowData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockGetUserId).toHaveBeenCalledWith(expect.any(String), 'workflow-123')
    })

    it('should return unauthorized for unauthenticated request', async () => {
      mockGetUserId.mockResolvedValue(null)

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for workflow that does not exist', async () => {
      const workflowData = {
        ...validSearchData,
        workflowId: 'nonexistent-workflow',
      }

      mockGetUserId.mockResolvedValue(null)

      const req = createMockRequest('POST', workflowData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Workflow not found')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce([]) // No knowledge bases found

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found or access denied')
    })

    it('should return not found for some missing knowledge bases', async () => {
      const multiKbData = {
        ...validSearchData,
        knowledgeBaseIds: ['kb-123', 'kb-missing'],
      }

      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce(mockKnowledgeBases) // Only kb-123 found

      const req = createMockRequest('POST', multiKbData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge bases not found: kb-missing')
    })

    it('should validate search parameters', async () => {
      const invalidData = {
        knowledgeBaseIds: '', // Empty string
        query: '', // Empty query
        topK: 150, // Too high
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should use default topK value when not provided', async () => {
      const dataWithoutTopK = {
        knowledgeBaseIds: 'kb-123',
        query: 'test search query',
      }

      mockGetUserId.mockResolvedValue('user-123')

      mockDbChain.where.mockResolvedValueOnce(mockKnowledgeBases) // First call: get knowledge bases

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults) // Second call: search results

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', dataWithoutTopK)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.topK).toBe(10) // Default value
    })

    it('should handle OpenAI API errors', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it('should handle missing OpenAI API key', async () => {
      vi.doMock('@/lib/env', () => ({
        env: {
          OPENAI_API_KEY: undefined,
        },
      }))

      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it('should handle database errors during search', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)
      mockDbChain.limit.mockRejectedValueOnce(new Error('Database error'))

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it('should handle invalid OpenAI response format', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [], // Empty data array
          }),
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })
  })
})
