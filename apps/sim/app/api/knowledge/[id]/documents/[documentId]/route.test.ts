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

// Setup common mocks
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

  // Mock functions will be imported dynamically in tests

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
    // Mock functions are cleared automatically by vitest
  }

  beforeEach(async () => {
    resetMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    // Utils are mocked at the top level

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

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      // Create a sequence of mocks for the database operations
      const updateChain = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined), // Update operation completes
        }),
      }

      const selectChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...mockDocument, ...validUpdateData }]),
          }),
        }),
      }

      // Mock transaction
      mockDbChain.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          update: vi.fn().mockReturnValue(updateChain),
        }
        await callback(mockTx)
      })

      // Mock db operations in sequence
      mockDbChain.select.mockReturnValue(selectChain)

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.filename).toBe('updated-document.pdf')
      expect(data.data.enabled).toBe(false)
      expect(mockDbChain.transaction).toHaveBeenCalled()
      expect(mockDbChain.select).toHaveBeenCalled()
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

      // Create a sequence of mocks for the database operations
      const updateChain = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined), // Update operation completes
        }),
      }

      const selectChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([{ ...processingDocument, processingStatus: 'failed' }]),
          }),
        }),
      }

      // Mock transaction
      mockDbChain.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          update: vi.fn().mockReturnValue(updateChain),
        }
        await callback(mockTx)
      })

      // Mock db operations in sequence
      mockDbChain.select.mockReturnValue(selectChain)

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockDbChain.transaction).toHaveBeenCalled()
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: 'failed',
          processingError: 'Processing timed out - background process may have been terminated',
          processingCompletedAt: expect.any(Date),
        })
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
      const { checkDocumentWriteAccess, processDocumentAsync } = await import(
        '@/app/api/knowledge/utils'
      )

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

      // Mock transaction
      mockDbChain.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }
        return await callback(mockTx)
      })

      vi.mocked(processDocumentAsync).mockResolvedValue(undefined)

      const req = createMockRequest('PUT', { retryProcessing: true })
      const { PUT } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('pending')
      expect(data.data.message).toBe('Document retry processing started')
      expect(mockDbChain.transaction).toHaveBeenCalled()
      expect(vi.mocked(processDocumentAsync)).toHaveBeenCalled()
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

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      // Mock transaction to throw an error
      mockDbChain.transaction.mockRejectedValue(new Error('Database error'))

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

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      // Properly chain the mock database operations for soft delete
      mockDbChain.update.mockReturnValue(mockDbChain)
      mockDbChain.set.mockReturnValue(mockDbChain)
      mockDbChain.where.mockResolvedValue(undefined) // Update operation resolves

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.message).toBe('Document deleted successfully')
      expect(mockDbChain.update).toHaveBeenCalled()
      expect(mockDbChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedAt: expect.any(Date),
        })
      )
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

      mockAuth$.mockAuthenticatedUser()
      vi.mocked(checkDocumentWriteAccess).mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })
      mockDbChain.set.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/documents/[documentId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete document')
    })
  })
})
