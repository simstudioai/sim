/**
 * Tests for document by ID API route
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
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
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
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  markDocumentAsFailedTimeout: vi.fn(),
  retryDocumentProcessing: vi.fn(),
  processDocumentAsync: vi.fn(),
}))

vi.mock('@/lib/audit/log', () => auditMock)

import {
  deleteDocument,
  markDocumentAsFailedTimeout,
  retryDocumentProcessing,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import { DELETE, GET, PUT } from '@/app/api/knowledge/[id]/documents/[documentId]/route'
import { checkDocumentAccess, checkDocumentWriteAccess } from '@/app/api/knowledge/utils'

describe('Document By ID API Route', () => {
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
    processingStartedAt: new Date('2023-01-01T10:00:00Z'),
    processingCompletedAt: new Date('2023-01-01T10:05:00Z'),
    processingError: null,
    enabled: true,
    uploadedAt: new Date('2023-01-01T09:00:00Z'),
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

  describe('GET /api/knowledge/[id]/documents/[documentId]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should retrieve document successfully for authenticated user', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('doc-123')
      expect(data.data.filename).toBe('test-document.pdf')
      expect(vi.mocked(checkDocumentAccess)).toHaveBeenCalledWith('kb-123', 'doc-123', 'user-123')
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentAccess).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch document')
    })
  })

  describe('PUT /api/knowledge/[id]/documents/[documentId] - Regular Updates', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })
    const validUpdateData = {
      filename: 'updated-document.pdf',
      enabled: false,
      chunkCount: 10,
      tokenCount: 200,
    }

    it('should update document successfully', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const updatedDocument = {
        ...mockDocument,
        ...validUpdateData,
        deletedAt: null,
      }
      vi.mocked(updateDocument).mockResolvedValue(updatedDocument)

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.filename).toBe('updated-document.pdf')
      expect(data.data.enabled).toBe(false)
      expect(vi.mocked(updateDocument)).toHaveBeenCalledWith(
        'doc-123',
        validUpdateData,
        expect.any(String)
      )
    })

    it('should validate update data', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const invalidData = {
        filename: '', // Invalid: empty filename
        chunkCount: -1, // Invalid: negative count
        processingStatus: 'invalid', // Invalid: not in enum
      }

      const req = createMockRequest('PUT', invalidData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })
  })

  describe('PUT /api/knowledge/[id]/documents/[documentId] - Mark Failed Due to Timeout', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should mark document as failed due to timeout successfully', async () => {
      const processingDocument = {
        ...mockDocument,
        processingStatus: 'processing',
        processingStartedAt: new Date(Date.now() - 200000), // 200 seconds ago
      }

      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: processingDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(markDocumentAsFailedTimeout).mockResolvedValue({
        success: true,
        processingDuration: 200000,
      })

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.documentId).toBe('doc-123')
      expect(data.data.status).toBe('failed')
      expect(data.data.message).toBe('Document marked as failed due to timeout')
      expect(vi.mocked(markDocumentAsFailedTimeout)).toHaveBeenCalledWith(
        'doc-123',
        processingDocument.processingStartedAt,
        expect.any(String)
      )
    })

    it('should reject marking failed for non-processing document', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Document is not in processing state')
    })

    it('should reject marking failed for recently started processing', async () => {
      const recentProcessingDocument = {
        ...mockDocument,
        processingStatus: 'processing',
        processingStartedAt: new Date(Date.now() - 60000), // 60 seconds ago
      }

      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: recentProcessingDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(markDocumentAsFailedTimeout).mockRejectedValue(
        new Error('Document has not been processing long enough to be considered dead')
      )

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Document has not been processing long enough')
    })
  })

  describe('PUT /api/knowledge/[id]/documents/[documentId] - Retry Processing', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should retry processing successfully', async () => {
      const failedDocument = {
        ...mockDocument,
        processingStatus: 'failed',
        processingError: 'Previous processing failed',
      }

      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: failedDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(retryDocumentProcessing).mockResolvedValue({
        success: true,
        status: 'pending',
        message: 'Document retry processing started',
      })

      const req = createMockRequest('PUT', { retryProcessing: true })
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('pending')
      expect(data.data.message).toBe('Document retry processing started')
      expect(vi.mocked(retryDocumentProcessing)).toHaveBeenCalledWith(
        'kb-123',
        'doc-123',
        {
          filename: failedDocument.filename,
          fileUrl: failedDocument.fileUrl,
          fileSize: failedDocument.fileSize,
          mimeType: failedDocument.mimeType,
        },
        expect.any(String)
      )
    })

    it('should reject retry for non-failed document', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('PUT', { retryProcessing: true })
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Document is not in failed state')
    })
  })

  describe('PUT /api/knowledge/[id]/documents/[documentId] - Authentication & Authorization', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })
    const validUpdateData = { filename: 'updated-document.pdf' }

    it('should return unauthorized for unauthenticated user', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should handle database errors during update', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(updateDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update document')
    })
  })

  describe('DELETE /api/knowledge/[id]/documents/[documentId]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should delete document successfully', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(deleteDocument).mockResolvedValue({
        success: true,
        message: 'Document deleted successfully',
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.message).toBe('Document deleted successfully')
      expect(vi.mocked(deleteDocument)).toHaveBeenCalledWith('doc-123', expect.any(String))
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during deletion', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(deleteDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete document')
    })
  })
})
