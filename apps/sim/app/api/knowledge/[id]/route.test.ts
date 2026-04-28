/**
 * Tests for knowledge base by ID API route
 *
 * @vitest-environment node
 */
import { auditMock, authMockFns, createMockRequest, knowledgeApiUtilsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbChain } = vi.hoisted(() => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }
  return { mockDbChain }
})

vi.mock('@sim/db', () => ({
  db: mockDbChain,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/knowledge/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/service')>()
  return {
    ...actual,
    getKnowledgeBaseById: vi.fn(),
    updateKnowledgeBase: vi.fn(),
    deleteKnowledgeBase: vi.fn(),
  }
})

vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)

import {
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import { DELETE, GET, PUT } from '@/app/api/knowledge/[id]/route'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

describe('Knowledge Base By ID API Route', () => {
  const mockKnowledgeBase = {
    id: 'kb-123',
    userId: 'user-123',
    name: 'Test Knowledge Base',
    description: 'Test description',
    tokenCount: 100,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: null,
    deletedAt: null,
  }

  const resetMocks = () => {
    vi.clearAllMocks()
    Object.values(mockDbChain).forEach((fn) => {
      if (typeof fn === 'function') {
        fn.mockClear().mockReset().mockReturnThis()
      }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })

    it('should retrieve knowledge base successfully for authenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(getKnowledgeBaseById).mockResolvedValueOnce(mockKnowledgeBase)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('kb-123')
      expect(data.data.name).toBe('Test Knowledge Base')
      expect(checkKnowledgeBaseAccess).toHaveBeenCalledWith('kb-123', 'user-123')
      expect(getKnowledgeBaseById).toHaveBeenCalledWith('kb-123')
    })

    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValueOnce({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base owned by different user', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValueOnce({
        hasAccess: false,
        notFound: false,
      })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found when service returns null', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(getKnowledgeBaseById).mockResolvedValueOnce(null)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should handle database errors', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseAccess).mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch knowledge base')
    })
  })

  describe('PUT /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })
    const validUpdateData = {
      name: 'Updated Knowledge Base',
      description: 'Updated description',
    }

    it('should update knowledge base successfully', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const updatedKnowledgeBase = { ...mockKnowledgeBase, ...validUpdateData }
      vi.mocked(updateKnowledgeBase).mockResolvedValueOnce(updatedKnowledgeBase)

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe('Updated Knowledge Base')
      expect(checkKnowledgeBaseWriteAccess).toHaveBeenCalledWith('kb-123', 'user-123')
      expect(updateKnowledgeBase).toHaveBeenCalledWith(
        'kb-123',
        {
          name: validUpdateData.name,
          description: validUpdateData.description,
          workspaceId: undefined,
          chunkingConfig: undefined,
        },
        expect.any(String)
      )
    })

    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should validate update data', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      const invalidData = {
        name: '',
      }

      const req = createMockRequest('PUT', invalidData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should handle database errors during update', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(updateKnowledgeBase).mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('PUT', validUpdateData)
      const response = await PUT(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update knowledge base')
    })
  })

  describe('DELETE /api/knowledge/[id]', () => {
    const mockParams = Promise.resolve({ id: 'kb-123' })

    it('should delete knowledge base successfully', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(deleteKnowledgeBase).mockResolvedValueOnce(undefined)

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.message).toBe('Knowledge base deleted successfully')
      expect(checkKnowledgeBaseWriteAccess).toHaveBeenCalledWith('kb-123', 'user-123')
      expect(deleteKnowledgeBase).toHaveBeenCalledWith('kb-123', expect.any(String))
    })

    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return not found for non-existent knowledge base', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: false,
        notFound: true,
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Knowledge base not found')
    })

    it('should return unauthorized for knowledge base owned by different user', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      resetMocks()

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: false,
        notFound: false,
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors during delete', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', userId: 'user-123' },
      })

      vi.mocked(deleteKnowledgeBase).mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to delete knowledge base')
    })
  })
})
