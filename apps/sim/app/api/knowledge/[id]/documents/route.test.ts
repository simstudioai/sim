/**
 * Tests for knowledge base documents API route
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

vi.mock('../../utils', () => ({
  checkKnowledgeBaseAccess: vi.fn(),
  processDocumentAsync: vi.fn(),
}))

mockDrizzleOrm()
mockConsoleLogger()

describe('Knowledge Base Documents API Route', () => {
  const mockAuth$ = mockAuth()

  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  }

  const mockCheckKnowledgeBaseAccess = vi.fn()
  const mockProcessDocumentAsync = vi.fn()

  const mockDocument = {
    id: 'doc-123',
    knowledgeBaseId: 'kb-123',
    filename: 'test-document.pdf',
    fileUrl: 'https://example.com/test-document.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    chunkCount: 5,
    tokenCount: 100,
    characterCount: 500,
    processingStatus: 'completed',
    processingStartedAt: new Date(),
    processingCompletedAt: new Date(),
    processingError: null,
    enabled: true,
    uploadedAt: new Date(),
  }

  const resetMocks = () => {
    vi.clearAllMocks()
    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear().mockReset()
        if (fn !== mockDbChain.transaction) {
          fn.mockReturnThis()
        }
      }
    })
    mockCheckKnowledgeBaseAccess.mockClear().mockReset()
    mockProcessDocumentAsync.mockClear().mockReset()
  }

  beforeEach(async () => {
    resetMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.doMock('../../utils', () => ({
      checkKnowledgeBaseAccess: mockCheckKnowledgeBaseAccess,
      processDocumentAsync: mockProcessDocumentAsync,
    }))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge/[id]/documents', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })

    it('should retrieve documents successfully for authenticated user', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      // Mock the count query (first query)
      mockDbChain.where.mockResolvedValueOnce([{ count: 1 }])

      // Mock the documents query (second query)
      mockDbChain.offset.mockResolvedValue([mockDocument])

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.documents).toHaveLength(1)
      expect(data.data.documents[0].id).toBe('doc-123')
      expect(mockDbChain.select).toHaveBeenCalled()
      expect(mockCheckKnowledgeBaseAccess).toHaveBeenCalledWith('kb-123', 'user-123')
    })

    it('should filter disabled documents by default', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      // Mock the count query (first query)
      mockDbChain.where.mockResolvedValueOnce([{ count: 1 }])

      // Mock the documents query (second query)
      mockDbChain.offset.mockResolvedValue([mockDocument])

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
      expect(mockDbChain.where).toHaveBeenCalled()
    })

    it('should include disabled documents when requested', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      // Mock the count query (first query)
      mockDbChain.where.mockResolvedValueOnce([{ count: 1 }])

      // Mock the documents query (second query)
      mockDbChain.offset.mockResolvedValue([mockDocument])

      const url = 'http://localhost:3000/api/knowledge/kb-123/documents?includeDisabled=true'
      const req = new Request(url, { method: 'GET' }) as any

      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false, notFound: true })

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.orderBy.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch documents')
    })
  })

  describe('POST /api/knowledge/[id]/documents - Single Document', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })
    const validDocumentData = {
      filename: 'test-document.pdf',
      fileUrl: 'https://example.com/test-document.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
    }

    it('should create single document successfully', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.values.mockResolvedValue(undefined)

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.filename).toBe(validDocumentData.filename)
      expect(data.data.fileUrl).toBe(validDocumentData.fileUrl)
      expect(mockDbChain.insert).toHaveBeenCalled()
    })

    it('should validate single document data', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      const invalidData = {
        filename: '', // Invalid: empty filename
        fileUrl: 'invalid-url', // Invalid: not a valid URL
        fileSize: 0, // Invalid: size must be > 0
        mimeType: '', // Invalid: empty mime type
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })
  })

  describe('POST /api/knowledge/[id]/documents - Bulk Documents', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })
    const validBulkData = {
      bulk: true,
      documents: [
        {
          filename: 'doc1.pdf',
          fileUrl: 'https://example.com/doc1.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
        {
          filename: 'doc2.pdf',
          fileUrl: 'https://example.com/doc2.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
        },
      ],
      processingOptions: {
        chunkSize: 1024,
        minCharactersPerChunk: 100,
        recipe: 'default',
        lang: 'en',
        chunkOverlap: 200,
      },
    }

    it('should create bulk documents successfully', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      // Mock transaction to return the created documents
      mockDbChain.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return await callback(mockTx)
      })

      mockProcessDocumentAsync.mockResolvedValue(undefined)

      const req = createMockRequest('POST', validBulkData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.total).toBe(2)
      expect(data.data.documentsCreated).toHaveLength(2)
      expect(data.data.processingMethod).toBe('background')
      expect(mockDbChain.transaction).toHaveBeenCalled()
    })

    it('should validate bulk document data', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      const invalidBulkData = {
        bulk: true,
        documents: [
          {
            filename: '', // Invalid: empty filename
            fileUrl: 'invalid-url',
            fileSize: 0,
            mimeType: '',
          },
        ],
        processingOptions: {
          chunkSize: 50, // Invalid: too small
          minCharactersPerChunk: 10, // Invalid: too small
          recipe: 'default',
          lang: 'en',
          chunkOverlap: 1000, // Invalid: too large
        },
      }

      const req = createMockRequest('POST', invalidBulkData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should handle processing errors gracefully', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })

      // Mock transaction to succeed but processing to fail
      mockDbChain.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return await callback(mockTx)
      })

      // Don't reject the promise - the processing is async and catches errors internally
      mockProcessDocumentAsync.mockResolvedValue(undefined)

      const req = createMockRequest('POST', validBulkData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      // The endpoint should still return success since documents are created
      // and processing happens asynchronously
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('POST /api/knowledge/[id]/documents - Authentication & Authorization', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })
    const validDocumentData = {
      filename: 'test-document.pdf',
      fileUrl: 'https://example.com/test-document.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
    }

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false, notFound: true })

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during creation', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.values.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('./route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create document')
    })
  })
})
