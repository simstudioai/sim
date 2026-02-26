/**
 * Tests for knowledge base documents API route
 *
 * @vitest-environment node
 */
import { auditMock, createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDbChain } = vi.hoisted(() => {
  const mockGetSession = vi.fn()
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
  return { mockGetSession, mockDbChain }
})

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: mockDbChain,
}))

vi.mock('@sim/db/schema', () => ({
  knowledgeBase: {
    id: 'kb_id',
    userId: 'user_id',
    name: 'kb_name',
    description: 'description',
    tokenCount: 'token_count',
    embeddingModel: 'embedding_model',
    embeddingDimension: 'embedding_dimension',
    chunkingConfig: 'chunking_config',
    workspaceId: 'workspace_id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  },
  document: {
    id: 'doc_id',
    knowledgeBaseId: 'kb_id',
    filename: 'filename',
    fileUrl: 'file_url',
    fileSize: 'file_size',
    mimeType: 'mime_type',
    chunkCount: 'chunk_count',
    tokenCount: 'token_count',
    characterCount: 'character_count',
    processingStatus: 'processing_status',
    processingStartedAt: 'processing_started_at',
    processingCompletedAt: 'processing_completed_at',
    processingError: 'processing_error',
    enabled: 'enabled',
    tag1: 'tag1',
    tag2: 'tag2',
    tag3: 'tag3',
    tag4: 'tag4',
    tag5: 'tag5',
    tag6: 'tag6',
    tag7: 'tag7',
    uploadedAt: 'uploaded_at',
    deletedAt: 'deleted_at',
  },
  embedding: {
    id: 'embedding_id',
    documentId: 'doc_id',
    knowledgeBaseId: 'kb_id',
    chunkIndex: 'chunk_index',
    content: 'content',
    embedding: 'embedding',
    tokenCount: 'token_count',
    characterCount: 'character_count',
    tag1: 'tag1',
    tag2: 'tag2',
    tag3: 'tag3',
    tag4: 'tag4',
    tag5: 'tag5',
    tag6: 'tag6',
    tag7: 'tag7',
    createdAt: 'created_at',
  },
  permissions: {
    id: 'permission_id',
    userId: 'user_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    permissionType: 'permission_type',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}))

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

vi.mock('@/lib/audit/log', () => auditMock)

import {
  createDocumentRecords,
  createSingleDocument,
  getDocuments,
  getProcessingConfig,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import { GET, POST } from '@/app/api/knowledge/[id]/documents/route'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

describe('Knowledge Base Documents API Route', () => {
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
    processingStatus: 'completed' as const,
    processingStartedAt: new Date(),
    processingCompletedAt: new Date(),
    processingError: null,
    enabled: true,
    uploadedAt: new Date(),
    tag1: null,
    tag2: null,
    tag3: null,
    tag4: null,
    tag5: null,
    tag6: null,
    tag7: null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    date1: null,
    date2: null,
    boolean1: null,
    boolean2: null,
    boolean3: null,
    deletedAt: null,
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

  beforeEach(() => {
    resetMocks()

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
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
          enabledFilter: undefined,
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should return documents with default filter', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
      expect(vi.mocked(getDocuments)).toHaveBeenCalledWith(
        'kb-123',
        {
          enabledFilter: undefined,
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should filter documents by enabled status when requested', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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

      const url = 'http://localhost:3000/api/knowledge/kb-123/documents?enabledFilter=disabled'
      const req = new Request(url, { method: 'GET' }) as any

      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(200)
      expect(vi.mocked(getDocuments)).toHaveBeenCalledWith(
        'kb-123',
        {
          enabledFilter: 'disabled',
          search: undefined,
          limit: 50,
          offset: 0,
        },
        expect.any(String)
      )
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(getDocuments).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
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
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should handle processing errors gracefully', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
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
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('POST', validDocumentData)
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('POST', validDocumentData)
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base without access', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: false })

      const req = createMockRequest('POST', validDocumentData)
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during creation', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(createSingleDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('POST', validDocumentData)
      const response = await POST(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Database error')
    })
  })
})
