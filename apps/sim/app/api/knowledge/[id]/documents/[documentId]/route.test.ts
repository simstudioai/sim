/**
 * Tests for document by ID API route
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
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  markDocumentAsFailedTimeout: vi.fn(),
  retryDocumentProcessing: vi.fn(),
  processDocumentAsync: vi.fn(),
}))

mockDrizzleOrm()
mockConsoleLogger()

describe('Document By ID API Route', () => {
  const mockAuth$ = mockAuth()

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
    processingStartedAt: new Date('2023-01-01T10:00:00Z'),
    processingCompletedAt: new Date('2023-01-01T10:05:00Z'),
    processingError: null,
    enabled: true,
    uploadedAt: new Date('2023-01-01T09:00:00Z'),
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

  beforeEach(async () => {
    resetMocks()

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

  describe('GET /api/knowledge/[id]/documents/[documentId]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should retrieve document successfully for authenticated user', async () => {
      const { checkDocumentAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('doc-123')
      expect(data.data.filename).toBe('test-document.pdf')
      expect(vi.mocked(checkDocumentAccess)).toHaveBeenCalledWith('kb-123', 'doc-123', 'user-123')
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      const { checkDocumentAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      const { checkDocumentAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentAccess).mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      const { checkDocumentAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentAccess).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { updateDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
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
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
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
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { markDocumentAsFailedTimeout } = await import('@/lib/knowledge/documents/service')

      const processingDocument = {
        ...mockDocument,
        processingStatus: 'processing',
        processingStartedAt: new Date(Date.now() - 200000), // 200 seconds ago
      }

      mockAuth$.mockAuthenticatedUser()
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
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Document is not in processing state')
    })

    it('should reject marking failed for recently started processing', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { markDocumentAsFailedTimeout } = await import('@/lib/knowledge/documents/service')

      const recentProcessingDocument = {
        ...mockDocument,
        processingStatus: 'processing',
        processingStartedAt: new Date(Date.now() - 60000), // 60 seconds ago
      }

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: recentProcessingDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(markDocumentAsFailedTimeout).mockRejectedValue(
        new Error('Document has not been processing long enough to be considered dead')
      )

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Document has not been processing long enough')
    })
  })

  describe('PUT /api/knowledge/[id]/documents/[documentId] - Retry Processing', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should retry processing successfully', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { retryDocumentProcessing } = await import('@/lib/knowledge/documents/service')

      const failedDocument = {
        ...mockDocument,
        processingStatus: 'failed',
        processingError: 'Previous processing failed',
      }

      mockAuth$.mockAuthenticatedUser()
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
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const req = createMockRequest('PUT', { retryProcessing: true })
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
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
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should handle database errors during update', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { updateDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(updateDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update document')
    })
  })

  describe('DELETE /api/knowledge/[id]/documents/[documentId]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should delete document successfully', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { deleteDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
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
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.message).toBe('Document deleted successfully')
      expect(vi.mocked(deleteDocument)).toHaveBeenCalledWith('doc-123', expect.any(String))
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during deletion', async () => {
      const { checkDocumentWriteAccess } = await import('@/app/api/knowledge/utils')
      const { deleteDocument } = await import('@/lib/knowledge/documents/service')

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      vi.mocked(deleteDocument).mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete document')
    })
  })
})
