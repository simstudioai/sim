/**
 * Tests for knowledge search API route
 * Focuses on route-specific functionality: authentication, validation, API contract, error handling
 * Search logic is tested in utils.test.ts
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
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'test-request-id'),
}))

vi.mock('@/lib/documents/utils', () => ({
  retryWithExponentialBackoff: vi.fn().mockImplementation((fn) => fn()),
}))

vi.mock('@/lib/tokenization/estimators', () => ({
  estimateTokenCount: vi.fn().mockReturnValue({ count: 521 }),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn().mockReturnValue({
    input: 0.00001042,
    output: 0,
    total: 0.00001042,
    pricing: {
      input: 0.02,
      output: 0,
      updatedAt: '2025-07-10',
    },
  }),
}))

const mockCheckKnowledgeBaseAccess = vi.fn()
vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseAccess: mockCheckKnowledgeBaseAccess,
}))

const mockHandleTagOnlySearch = vi.fn()
const mockHandleVectorOnlySearch = vi.fn()
const mockHandleTagAndVectorSearch = vi.fn()
const mockGetQueryStrategy = vi.fn()
const mockGenerateSearchEmbedding = vi.fn()
const mockGetDocumentNamesByIds = vi.fn()
vi.mock('./utils', () => ({
  handleTagOnlySearch: mockHandleTagOnlySearch,
  handleVectorOnlySearch: mockHandleVectorOnlySearch,
  handleTagAndVectorSearch: mockHandleTagAndVectorSearch,
  getQueryStrategy: mockGetQueryStrategy,
  generateSearchEmbedding: mockGenerateSearchEmbedding,
  getDocumentNamesByIds: mockGetDocumentNamesByIds,
  APIError: class APIError extends Error {
    public status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  },
}))

mockConsoleLogger()

describe('Knowledge Search API Route', () => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
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

    mockHandleTagOnlySearch.mockClear()
    mockHandleVectorOnlySearch.mockClear()
    mockHandleTagAndVectorSearch.mockClear()
    mockGetQueryStrategy.mockClear().mockReturnValue({
      useParallel: false,
      distanceThreshold: 1.0,
      parallelLimit: 15,
      singleQueryOptimized: true,
    })
    mockGenerateSearchEmbedding.mockClear().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5])
    mockGetDocumentNamesByIds.mockClear().mockResolvedValue({
      doc1: 'Document 1',
      doc2: 'Document 2',
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

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockDbChain.limit.mockResolvedValue([])

      mockHandleVectorOnlySearch.mockResolvedValue(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      if (response.status !== 200) {
        console.log('Test failed with response:', data)
      }

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.results[0].similarity).toBe(0.8) // 1 - 0.2
      expect(data.data.query).toBe(validSearchData.query)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123'])
      expect(mockHandleVectorOnlySearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        queryVector: JSON.stringify(mockEmbedding),
        distanceThreshold: expect.any(Number),
      })
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

      mockCheckKnowledgeBaseAccess
        .mockResolvedValueOnce({ hasAccess: true, knowledgeBase: multiKbs[0] })
        .mockResolvedValueOnce({ hasAccess: true, knowledgeBase: multiKbs[1] })

      mockDbChain.limit.mockResolvedValue([])

      mockHandleVectorOnlySearch.mockResolvedValue(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', multiKbData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123', 'kb-456'])
      expect(mockHandleVectorOnlySearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123', 'kb-456'],
        topK: 10,
        queryVector: JSON.stringify(mockEmbedding),
        distanceThreshold: expect.any(Number),
      })
    })

    it('should handle workflow-based authentication', async () => {
      const workflowData = {
        ...validSearchData,
        workflowId: 'workflow-123',
      }

      mockGetUserId.mockResolvedValue('user-123')

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockDbChain.limit.mockResolvedValue([])

      mockHandleVectorOnlySearch.mockResolvedValue(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', workflowData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockGetUserId).toHaveBeenCalledWith(expect.any(String), 'workflow-123')
    })

    it.concurrent('should return unauthorized for unauthenticated request', async () => {
      mockGetUserId.mockResolvedValue(null)

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it.concurrent('should return not found for workflow that does not exist', async () => {
      const workflowData = {
        ...validSearchData,
        workflowId: 'nonexistent-workflow',
      }

      mockGetUserId.mockResolvedValue(null)

      const req = createMockRequest('POST', workflowData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Workflow not found')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
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

      // Mock access check: first KB has access, second doesn't
      mockCheckKnowledgeBaseAccess
        .mockResolvedValueOnce({ hasAccess: true, knowledgeBase: mockKnowledgeBases[0] })
        .mockResolvedValueOnce({ hasAccess: false, notFound: true })

      const req = createMockRequest('POST', multiKbData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge bases not found or access denied: kb-missing')
    })

    it.concurrent('should validate search parameters', async () => {
      const invalidData = {
        knowledgeBaseIds: '', // Empty string
        query: '', // Empty query
        topK: 150, // Too high
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('@/app/api/knowledge/search/route')
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

      // Mock knowledge base access check to return success
      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults) // Search results

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', dataWithoutTopK)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.topK).toBe(10) // Default value
    })

    it.concurrent('should handle OpenAI API errors', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      // Mock generateSearchEmbedding to throw an error
      mockGenerateSearchEmbedding.mockRejectedValueOnce(
        new Error('OpenAI API error: 401 Unauthorized - Invalid API key')
      )

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it.concurrent('should handle missing OpenAI API key', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      // Mock generateSearchEmbedding to throw missing API key error
      mockGenerateSearchEmbedding.mockRejectedValueOnce(new Error('OPENAI_API_KEY not configured'))

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it.concurrent('should handle database errors during search', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      // Mock the search handler to throw a database error
      mockHandleVectorOnlySearch.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    it.concurrent('should handle invalid OpenAI response format', async () => {
      mockGetUserId.mockResolvedValue('user-123')
      mockDbChain.limit.mockResolvedValueOnce(mockKnowledgeBases)

      // Mock generateSearchEmbedding to throw invalid response format error
      mockGenerateSearchEmbedding.mockRejectedValueOnce(
        new Error('Invalid response format from OpenAI embeddings API')
      )

      const req = createMockRequest('POST', validSearchData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
    })

    describe('Cost tracking', () => {
      it.concurrent('should include cost information in successful search response', async () => {
        mockGetUserId.mockResolvedValue('user-123')

        // Mock knowledge base access check to return success
        mockCheckKnowledgeBaseAccess.mockResolvedValue({
          hasAccess: true,
          knowledgeBase: {
            id: 'kb-123',
            userId: 'user-123',
            name: 'Test KB',
            deletedAt: null,
          },
        })

        mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ embedding: mockEmbedding }],
            }),
        })

        const req = createMockRequest('POST', validSearchData)
        const { POST } = await import('@/app/api/knowledge/search/route')
        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)

        // Verify cost information is included
        expect(data.data.cost).toBeDefined()
        expect(data.data.cost.input).toBe(0.00001042)
        expect(data.data.cost.output).toBe(0)
        expect(data.data.cost.total).toBe(0.00001042)
        expect(data.data.cost.tokens).toEqual({
          prompt: 521,
          completion: 0,
          total: 521,
        })
        expect(data.data.cost.model).toBe('text-embedding-3-small')
        expect(data.data.cost.pricing).toEqual({
          input: 0.02,
          output: 0,
          updatedAt: '2025-07-10',
        })
      })

      it('should call cost calculation functions with correct parameters', async () => {
        const { estimateTokenCount } = await import('@/lib/tokenization/estimators')
        const { calculateCost } = await import('@/providers/utils')

        mockGetUserId.mockResolvedValue('user-123')

        // Mock knowledge base access check to return success
        mockCheckKnowledgeBaseAccess.mockResolvedValue({
          hasAccess: true,
          knowledgeBase: {
            id: 'kb-123',
            userId: 'user-123',
            name: 'Test KB',
            deletedAt: null,
          },
        })

        mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ embedding: mockEmbedding }],
            }),
        })

        const req = createMockRequest('POST', validSearchData)
        const { POST } = await import('@/app/api/knowledge/search/route')
        await POST(req)

        // Verify token estimation was called with correct parameters
        expect(estimateTokenCount).toHaveBeenCalledWith('test search query', 'openai')

        // Verify cost calculation was called with correct parameters
        expect(calculateCost).toHaveBeenCalledWith('text-embedding-3-small', 521, 0, false)
      })

      it('should handle cost calculation with different query lengths', async () => {
        const { estimateTokenCount } = await import('@/lib/tokenization/estimators')
        const { calculateCost } = await import('@/providers/utils')

        // Mock different token count for longer query
        vi.mocked(estimateTokenCount).mockReturnValue({
          count: 1042,
          confidence: 'high',
          provider: 'openai',
          method: 'precise',
        })
        vi.mocked(calculateCost).mockReturnValue({
          input: 0.00002084,
          output: 0,
          total: 0.00002084,
          pricing: {
            input: 0.02,
            output: 0,
            updatedAt: '2025-07-10',
          },
        })

        const longQueryData = {
          ...validSearchData,
          query:
            'This is a much longer search query with many more tokens to test cost calculation accuracy',
        }

        mockGetUserId.mockResolvedValue('user-123')

        // Mock knowledge base access check to return success
        mockCheckKnowledgeBaseAccess.mockResolvedValue({
          hasAccess: true,
          knowledgeBase: {
            id: 'kb-123',
            userId: 'user-123',
            name: 'Test KB',
            deletedAt: null,
          },
        })

        mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ embedding: mockEmbedding }],
            }),
        })

        const req = createMockRequest('POST', longQueryData)
        const { POST } = await import('@/app/api/knowledge/search/route')
        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.data.cost.input).toBe(0.00002084)
        expect(data.data.cost.tokens.prompt).toBe(1042)
        expect(calculateCost).toHaveBeenCalledWith('text-embedding-3-small', 1042, 0, false)
      })
    })
  })

  describe('Optional Query Search', () => {
    const mockTagDefinitions = [
      { tagSlot: 'tag1', displayName: 'category' },
      { tagSlot: 'tag2', displayName: 'priority' },
    ]

    const mockTaggedResults = [
      {
        id: 'chunk-1',
        content: 'Tagged content 1',
        documentId: 'doc-1',
        chunkIndex: 0,
        tag1: 'api',
        tag2: 'high',
        distance: 0,
        knowledgeBaseId: 'kb-123',
      },
      {
        id: 'chunk-2',
        content: 'Tagged content 2',
        documentId: 'doc-2',
        chunkIndex: 1,
        tag1: 'docs',
        tag2: 'medium',
        distance: 0,
        knowledgeBaseId: 'kb-123',
      },
    ]

    it('should perform tag-only search without query', async () => {
      const tagOnlyData = {
        knowledgeBaseIds: 'kb-123',
        filters: {
          category: 'api',
        },
        topK: 10,
      }

      mockGetUserId.mockResolvedValue('user-123')
      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      // Mock tag definitions queries for filter mapping and display mapping
      mockDbChain.limit
        .mockResolvedValueOnce(mockTagDefinitions) // Tag definitions for filter mapping
        .mockResolvedValueOnce(mockTagDefinitions) // Tag definitions for display mapping

      // Mock the tag-only search handler
      mockHandleTagOnlySearch.mockResolvedValue(mockTaggedResults)

      const req = createMockRequest('POST', tagOnlyData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      if (response.status !== 200) {
        console.log('Tag-only search test error:', data)
      }

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.results[0].similarity).toBe(1) // Perfect similarity for tag-only
      expect(data.data.query).toBe('') // Empty query
      expect(data.data.cost).toBeUndefined() // No cost for tag-only search
      expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled() // No embedding API call
      expect(mockHandleTagOnlySearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: { category: 'api' }, // Note: When no tag definitions are found, it uses the original filter key
      })
    })

    it('should perform query + tag combination search', async () => {
      const combinedData = {
        knowledgeBaseIds: 'kb-123',
        query: 'test search',
        filters: {
          category: 'api',
        },
        topK: 10,
      }

      mockGetUserId.mockResolvedValue('user-123')
      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      // Mock tag definitions queries for filter mapping and display mapping
      mockDbChain.limit
        .mockResolvedValueOnce(mockTagDefinitions) // Tag definitions for filter mapping
        .mockResolvedValueOnce(mockTagDefinitions) // Tag definitions for display mapping

      // Mock the tag + vector search handler
      mockHandleTagAndVectorSearch.mockResolvedValue(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', combinedData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      if (response.status !== 200) {
        console.log('Query+tag combination test error:', data)
      }

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.query).toBe('test search')
      expect(data.data.cost).toBeDefined() // Cost included for vector search
      expect(mockGenerateSearchEmbedding).toHaveBeenCalled() // Embedding API called
      expect(mockHandleTagAndVectorSearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: { category: 'api' }, // Note: When no tag definitions are found, it uses the original filter key
        queryVector: JSON.stringify(mockEmbedding),
        distanceThreshold: 1, // Single KB uses threshold of 1.0
      })
    })

    it('should validate that either query or filters are provided', async () => {
      const emptyData = {
        knowledgeBaseIds: 'kb-123',
        topK: 10,
      }

      const req = createMockRequest('POST', emptyData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Please provide either a search query or tag filters to search your knowledge base',
          }),
        ])
      )
    })

    it('should validate that empty query with empty filters fails', async () => {
      const emptyFiltersData = {
        knowledgeBaseIds: 'kb-123',
        query: '',
        filters: {},
        topK: 10,
      }

      const req = createMockRequest('POST', emptyFiltersData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })

    it('should handle empty tag values gracefully', async () => {
      // This simulates what happens when the frontend sends empty tag values
      // The tool transformation should filter out empty values, resulting in no filters
      const emptyTagValueData = {
        knowledgeBaseIds: 'kb-123',
        query: '',
        topK: 10,
        // This would result in no filters after tool transformation
      }

      const req = createMockRequest('POST', emptyTagValueData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Please provide either a search query or tag filters to search your knowledge base',
          }),
        ])
      )
    })

    it('should handle null values from frontend gracefully', async () => {
      // This simulates the exact scenario the user reported
      // Null values should be transformed to undefined and then trigger validation
      const nullValuesData = {
        knowledgeBaseIds: 'kb-123',
        topK: null,
        query: null,
        filters: null,
      }

      const req = createMockRequest('POST', nullValuesData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Please provide either a search query or tag filters to search your knowledge base',
          }),
        ])
      )
    })

    it('should perform query-only search (existing behavior)', async () => {
      const queryOnlyData = {
        knowledgeBaseIds: 'kb-123',
        query: 'test search query',
        topK: 10,
      }

      mockGetUserId.mockResolvedValue('user-123')
      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockDbChain.limit.mockResolvedValueOnce(mockSearchResults)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: mockEmbedding }],
          }),
      })

      const req = createMockRequest('POST', queryOnlyData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.query).toBe('test search query')
      expect(data.data.cost).toBeDefined() // Cost included for vector search
      expect(mockGenerateSearchEmbedding).toHaveBeenCalled() // Embedding API called
    })

    it('should handle tag-only search with multiple knowledge bases', async () => {
      const multiKbTagData = {
        knowledgeBaseIds: ['kb-123', 'kb-456'],
        filters: {
          category: 'docs',
          priority: 'high',
        },
        topK: 10,
      }

      mockGetUserId.mockResolvedValue('user-123')
      mockCheckKnowledgeBaseAccess
        .mockResolvedValueOnce({
          hasAccess: true,
          knowledgeBase: {
            id: 'kb-123',
            userId: 'user-123',
            name: 'Test KB',
            deletedAt: null,
          },
        })
        .mockResolvedValueOnce({
          hasAccess: true,
          knowledgeBase: { id: 'kb-456', userId: 'user-123', name: 'Test KB 2' },
        })

      // Reset all mocks before setting up specific behavior
      Object.values(mockDbChain).forEach((fn) => {
        if (typeof fn === 'function') {
          fn.mockClear().mockReturnThis()
        }
      })

      // Create fresh mocks for multiple database calls needed for multi-KB tag search
      const mockTagDefsQuery1 = {
        ...mockDbChain,
        limit: vi.fn().mockResolvedValue(mockTagDefinitions),
      }
      const mockTagSearchQuery = {
        ...mockDbChain,
        limit: vi.fn().mockResolvedValue(mockTaggedResults),
      }
      const mockTagDefsQuery2 = {
        ...mockDbChain,
        limit: vi.fn().mockResolvedValue(mockTagDefinitions),
      }
      const mockTagDefsQuery3 = {
        ...mockDbChain,
        limit: vi.fn().mockResolvedValue(mockTagDefinitions),
      }

      // Chain the mocks for: tag defs, search, display mapping KB1, display mapping KB2
      mockDbChain.select
        .mockReturnValueOnce(mockTagDefsQuery1)
        .mockReturnValueOnce(mockTagSearchQuery)
        .mockReturnValueOnce(mockTagDefsQuery2)
        .mockReturnValueOnce(mockTagDefsQuery3)

      const req = createMockRequest('POST', multiKbTagData)
      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123', 'kb-456'])
      expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled() // No embedding for tag-only
    })
  })

  describe('Deleted document filtering', () => {
    it('should exclude results from deleted documents in vector search', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockHandleVectorOnlySearch.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'Content from active document',
          documentId: 'doc-active',
          chunkIndex: 0,
          tag1: null,
          tag2: null,
          tag3: null,
          tag4: null,
          tag5: null,
          tag6: null,
          tag7: null,
          distance: 0.2,
          knowledgeBaseId: 'kb-123',
        },
      ])

      mockGetQueryStrategy.mockReturnValue({
        useParallel: false,
        distanceThreshold: 1.0,
        parallelLimit: 15,
        singleQueryOptimized: true,
      })

      mockGenerateSearchEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
      mockGetDocumentNamesByIds.mockResolvedValue({
        'doc-active': 'Active Document.pdf',
      })

      const mockTagDefs = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }
      mockDbChain.select.mockReturnValueOnce(mockTagDefs)

      const req = createMockRequest('POST', {
        knowledgeBaseIds: ['kb-123'],
        query: 'test query',
        topK: 10,
      })

      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(1)
      expect(data.data.results[0].documentId).toBe('doc-active')
      expect(data.data.results[0].documentName).toBe('Active Document.pdf')
    })

    it('should exclude results from deleted documents in tag search', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockHandleTagOnlySearch.mockResolvedValue([
        {
          id: 'chunk-2',
          content: 'Content from active document with tag',
          documentId: 'doc-active-tagged',
          chunkIndex: 0,
          tag1: 'api',
          tag2: null,
          tag3: null,
          tag4: null,
          tag5: null,
          tag6: null,
          tag7: null,
          distance: 0,
          knowledgeBaseId: 'kb-123',
        },
      ])

      mockGetQueryStrategy.mockReturnValue({
        useParallel: false,
        distanceThreshold: 1.0,
        parallelLimit: 15,
        singleQueryOptimized: true,
      })

      mockGetDocumentNamesByIds.mockResolvedValue({
        'doc-active-tagged': 'Active Tagged Document.pdf',
      })

      const mockTagDefs = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }
      mockDbChain.select.mockReturnValueOnce(mockTagDefs)

      const req = createMockRequest('POST', {
        knowledgeBaseIds: ['kb-123'],
        filters: { tag1: 'api' },
        topK: 10,
      })

      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(1)
      expect(data.data.results[0].documentId).toBe('doc-active-tagged')
      expect(data.data.results[0].documentName).toBe('Active Tagged Document.pdf')
      expect(data.data.results[0].metadata).toEqual({ tag1: 'api' })
    })

    it('should exclude results from deleted documents in combined tag+vector search', async () => {
      mockGetUserId.mockResolvedValue('user-123')

      mockCheckKnowledgeBaseAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: {
          id: 'kb-123',
          userId: 'user-123',
          name: 'Test KB',
          deletedAt: null,
        },
      })

      mockHandleTagAndVectorSearch.mockResolvedValue([
        {
          id: 'chunk-3',
          content: 'Relevant content from active document',
          documentId: 'doc-active-combined',
          chunkIndex: 0,
          tag1: 'guide',
          tag2: null,
          tag3: null,
          tag4: null,
          tag5: null,
          tag6: null,
          tag7: null,
          distance: 0.15,
          knowledgeBaseId: 'kb-123',
        },
      ])

      mockGetQueryStrategy.mockReturnValue({
        useParallel: false,
        distanceThreshold: 1.0,
        parallelLimit: 15,
        singleQueryOptimized: true,
      })

      mockGenerateSearchEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
      mockGetDocumentNamesByIds.mockResolvedValue({
        'doc-active-combined': 'Active Combined Search.pdf',
      })

      const mockTagDefs = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }
      mockDbChain.select.mockReturnValueOnce(mockTagDefs)

      const req = createMockRequest('POST', {
        knowledgeBaseIds: ['kb-123'],
        query: 'relevant content',
        filters: { tag1: 'guide' },
        topK: 10,
      })

      const { POST } = await import('@/app/api/knowledge/search/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(1)
      expect(data.data.results[0].documentId).toBe('doc-active-combined')
      expect(data.data.results[0].documentName).toBe('Active Combined Search.pdf')
      expect(data.data.results[0].metadata).toEqual({ tag1: 'guide' })
      expect(data.data.results[0].similarity).toBe(0.85) // 1 - 0.15 distance
    })
  })
})
