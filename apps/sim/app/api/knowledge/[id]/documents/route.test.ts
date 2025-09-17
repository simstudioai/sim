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

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: vi.fn(),
  checkDocumentAccess: vi.fn(),
  checkDocumentWriteAccess: vi.fn(),
  checkChunkAccess: vi.fn(),
  generateEmbeddings: vi.fn(),
  processDocumentAsync: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getDocuments: vi.fn(),
  createSingleDocument: vi.fn(),
  createDocumentRecords: vi.fn(),
  processDocumentsWithQueue: vi.fn(),
  getProcessingConfig: vi.fn(),
  bulkDocumentOperation: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  markDocumentAsFailedTimeout: vi.fn(),
  retryDocumentProcessing: vi.fn(),
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
  }

  beforeEach(async () => {
    resetMocks()

    vi.doMock('@sim/db', () => ({
      db: mockDbChain,
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
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')
      const { getDocuments } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(getDocuments).mockResolvedValue({
        documents: [mockDocument],
        pagination: {
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.documents).toHaveLength(1)
      expect(data.data.documents[0].id).toBe('doc-123')
      expect(vi.mocked(checkKnowledgeBaseAccess)).toHaveBeenCalledWith('kb-123', 'user-123')
      expect(vi.mocked(getDocuments)).toHaveBeenCalledWith(
        'kb-123',
        {
          includeDisabled: false,
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should filter disabled documents by default', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')
      const { getDocuments } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(getDocuments).mockResolvedValue({
        documents: [mockDocument],
        pagination: {
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
      expect(vi.mocked(getDocuments)).toHaveBeenCalledWith(
        'kb-123',
        {
          includeDisabled: false,
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should include disabled documents when requested', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')
      const { getDocuments } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(getDocuments).mockResolvedValue({
        documents: [mockDocument],
        pagination: {
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      })

      const url = 'http://localhost:3000/api/knowledge/kb-123/documents?includeDisabled=true'
      const req = new Request(url, { method: 'GET' }) as any

      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
      expect(vi.mocked(getDocuments)).toHaveBeenCalledWith(
        'kb-123',
        {
          includeDisabled: true,
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')
      const { getDocuments } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(getDocuments).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/route')
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
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
      const { createSingleDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const createdDocument = {
        id: 'doc-123',
        knowledgeBaseId: 'kb-123',
        filename: validDocumentData.filename,
        fileUrl: validDocumentData.fileUrl,
        fileSize: validDocumentData.fileSize,
        mimeType: validDocumentData.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        enabled: true,
        uploadedAt: new Date(),
        tag1: null,
        tag2: null,
        tag3: null,
        tag4: null,
        tag5: null,
        tag6: null,
        tag7: null,
      }
      vi.mocked(createSingleDocument).mockResolvedValue(createdDocument)

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.filename).toBe(validDocumentData.filename)
      expect(data.data.fileUrl).toBe(validDocumentData.fileUrl)
      expect(vi.mocked(createSingleDocument)).toHaveBeenCalledWith(
        validDocumentData,
        'kb-123',
        expect.any(String)
      )
    })

    it('should validate single document data', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const invalidData = {
        filename: '', // Invalid: empty filename
        fileUrl: 'invalid-url', // Invalid: not a valid URL
        fileSize: 0, // Invalid: size must be > 0
        mimeType: '', // Invalid: empty mime type
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
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
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
      const { createDocumentRecords, processDocumentsWithQueue, getProcessingConfig } =
        await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const createdDocuments = [
        {
          documentId: 'doc-1',
          filename: 'doc1.pdf',
          fileUrl: 'https://example.com/doc1.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
        {
          documentId: 'doc-2',
          filename: 'doc2.pdf',
          fileUrl: 'https://example.com/doc2.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
        },
      ]

      vi.mocked(createDocumentRecords).mockResolvedValue(createdDocuments)
      vi.mocked(processDocumentsWithQueue).mockResolvedValue(undefined)
      vi.mocked(getProcessingConfig).mockReturnValue({
        maxConcurrentDocuments: 8,
        batchSize: 20,
        delayBetweenBatches: 100,
        delayBetweenDocuments: 0,
      })

      const req = createMockRequest('POST', validBulkData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.total).toBe(2)
      expect(data.data.documentsCreated).toHaveLength(2)
      expect(data.data.processingMethod).toBe('background')
      expect(vi.mocked(createDocumentRecords)).toHaveBeenCalledWith(
        validBulkData.documents,
        'kb-123',
        expect.any(String)
      )
      expect(vi.mocked(processDocumentsWithQueue)).toHaveBeenCalled()
    })

    it('should validate bulk document data', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

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
          minCharactersPerChunk: 0, // Invalid: too small
          recipe: 'default',
          lang: 'en',
          chunkOverlap: 1000, // Invalid: too large
        },
      }

      const req = createMockRequest('POST', invalidBulkData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should handle processing errors gracefully', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
      const { createDocumentRecords, processDocumentsWithQueue, getProcessingConfig } =
        await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const createdDocuments = [
        {
          documentId: 'doc-1',
          filename: 'doc1.pdf',
          fileUrl: 'https://example.com/doc1.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
      ]

      vi.mocked(createDocumentRecords).mockResolvedValue(createdDocuments)
      vi.mocked(processDocumentsWithQueue).mockResolvedValue(undefined)
      vi.mocked(getProcessingConfig).mockReturnValue({
        maxConcurrentDocuments: 8,
        batchSize: 20,
        delayBetweenBatches: 100,
        delayBetweenDocuments: 0,
      })

      const req = createMockRequest('POST', validBulkData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

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
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during creation', async () => {
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
      const { createSingleDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(createSingleDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('POST', validDocumentData)
      const { POST } = await import('@/app/api/knowledge/[id]/documents/route')
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create document')
    })
  })
})
