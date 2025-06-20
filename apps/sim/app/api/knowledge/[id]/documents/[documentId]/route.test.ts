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

vi.mock('../../../utils', () => ({
  checkDocumentAccess: vi.fn(),
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

  const mockCheckDocumentAccess = vi.fn()
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
    mockCheckDocumentAccess.mockClear().mockReset()
    mockProcessDocumentAsync.mockClear().mockReset()
  }

  beforeEach(async () => {
    resetMocks()

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.doMock('../../../utils', () => ({
      checkDocumentAccess: mockCheckDocumentAccess,
      processDocumentAsync: mockProcessDocumentAsync,
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
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
      })

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('doc-123')
      expect(data.data.filename).toBe('test-document.pdf')
      expect(mockCheckDocumentAccess).toHaveBeenCalledWith('kb-123', 'doc-123', 'user-123')
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

    it('should return not found for non-existent document', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('GET')
      const { GET } = await import('./route')
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
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
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

      // Mock db operations in sequence
      mockDbChain.update.mockReturnValue(updateChain)
      mockDbChain.select.mockReturnValue(selectChain)

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.filename).toBe('updated-document.pdf')
      expect(data.data.enabled).toBe(false)
      expect(mockDbChain.update).toHaveBeenCalled()
      expect(mockDbChain.select).toHaveBeenCalled()
    })

    it('should validate update data', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
      })

      const invalidData = {
        filename: '', // Invalid: empty filename
        chunkCount: -1, // Invalid: negative count
        processingStatus: 'invalid', // Invalid: not in enum
      }

      const req = createMockRequest('PUT', invalidData)
      const { PUT } = await import('./route')
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

      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: processingDocument,
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

      // Mock db operations in sequence
      mockDbChain.update.mockReturnValue(updateChain)
      mockDbChain.select.mockReturnValue(selectChain)

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockDbChain.update).toHaveBeenCalled()
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: 'failed',
          processingError: 'Processing timed out - background process may have been terminated',
          processingCompletedAt: expect.any(Date),
        })
      )
    })

    it('should reject marking failed for non-processing document', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
      })

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('./route')
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

      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: recentProcessingDocument,
      })

      const req = createMockRequest('PUT', { markFailedDueToTimeout: true })
      const { PUT } = await import('./route')
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

      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: failedDocument,
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

      mockProcessDocumentAsync.mockResolvedValue(undefined)

      const req = createMockRequest('PUT', { retryProcessing: true })
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('pending')
      expect(data.data.message).toBe('Document retry processing started')
      expect(mockDbChain.transaction).toHaveBeenCalled()
      expect(mockProcessDocumentAsync).toHaveBeenCalled()
    })

    it('should reject retry for non-failed document', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: { ...mockDocument, processingStatus: 'completed' },
      })

      const req = createMockRequest('PUT', { retryProcessing: true })
      const { PUT } = await import('./route')
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
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should handle database errors during update', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
      })
      mockDbChain.set.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('PUT', validUpdateData)
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update document')
    })
  })

  describe('DELETE /api/knowledge/[id]/documents/[documentId]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123', documentId: 'doc-123' })

    it('should delete document successfully', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
      })

      // Properly chain the mock database operations for soft delete
      mockDbChain.update.mockReturnValue(mockDbChain)
      mockDbChain.set.mockReturnValue(mockDbChain)
      mockDbChain.where.mockResolvedValue(undefined) // Update operation resolves

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
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
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent document', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: false,
        notFound: true,
        reason: 'Document not found',
      })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Document not found')
    })

    it('should return unauthorized for document without access', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: false,
        reason: 'Access denied',
      })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during deletion', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCheckDocumentAccess.mockResolvedValue({
        hasAccess: true,
        document: mockDocument,
      })
      mockDbChain.set.mockRejectedValue(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete document')
    })
  })
})
