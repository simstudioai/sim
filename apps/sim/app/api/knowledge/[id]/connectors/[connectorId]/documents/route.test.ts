/**
 * @vitest-environment node
 */
import { createMockRequest, mockConsoleLogger, mockDrizzleOrm } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/schema', () => ({
  document: {
    id: 'id',
    connectorId: 'connectorId',
    deletedAt: 'deletedAt',
    filename: 'filename',
    externalId: 'externalId',
    sourceUrl: 'sourceUrl',
    enabled: 'enabled',
    userExcluded: 'userExcluded',
    uploadedAt: 'uploadedAt',
    processingStatus: 'processingStatus',
  },
  knowledgeConnector: {
    id: 'id',
    knowledgeBaseId: 'knowledgeBaseId',
    deletedAt: 'deletedAt',
  },
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: vi.fn(),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-req-id'),
}))

mockDrizzleOrm()
mockConsoleLogger()

describe('Connector Documents API Route', () => {
  /**
   * The route chains db calls in sequence. We track call order
   * to return different values for connector lookup vs document queries.
   */
  let limitCallCount: number
  let orderByCallCount: number

  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(() => {
      orderByCallCount++
      return Promise.resolve([])
    }),
    limit: vi.fn(() => {
      limitCallCount++
      return Promise.resolve([])
    }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }

  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    limitCallCount = 0
    orderByCallCount = 0
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.orderBy.mockImplementation(() => {
      orderByCallCount++
      return Promise.resolve([])
    })
    mockDbChain.limit.mockImplementation(() => {
      limitCallCount++
      return Promise.resolve([])
    })
    mockDbChain.update.mockReturnThis()
    mockDbChain.set.mockReturnThis()
    mockDbChain.returning.mockResolvedValue([])

    vi.doMock('@sim/db', () => ({ db: mockDbChain }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: false,
        userId: null,
      } as never)

      const req = createMockRequest('GET')
      const { GET } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await GET(req as never, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 404 when connector not found', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true } as never)

      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('GET')
      const { GET } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await GET(req as never, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns documents list on success', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true } as never)

      const doc = { id: 'doc-1', filename: 'test.txt', userExcluded: false }
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.orderBy.mockResolvedValueOnce([doc])

      const url = 'http://localhost/api/knowledge/kb-123/connectors/conn-456/documents'
      const req = createMockRequest('GET', undefined, undefined, url)
      Object.assign(req, { nextUrl: new URL(url) })
      const { GET } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await GET(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.documents).toHaveLength(1)
      expect(data.data.counts.active).toBe(1)
      expect(data.data.counts.excluded).toBe(0)
    })

    it('includes excluded documents when includeExcluded=true', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true } as never)

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.orderBy
        .mockResolvedValueOnce([{ id: 'doc-1', userExcluded: false }])
        .mockResolvedValueOnce([{ id: 'doc-2', userExcluded: true }])

      const url =
        'http://localhost/api/knowledge/kb-123/connectors/conn-456/documents?includeExcluded=true'
      const req = createMockRequest('GET', undefined, undefined, url)
      Object.assign(req, { nextUrl: new URL(url) })
      const { GET } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await GET(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.documents).toHaveLength(2)
      expect(data.data.counts.active).toBe(1)
      expect(data.data.counts.excluded).toBe(1)
    })
  })

  describe('PATCH', () => {
    it('returns 401 when unauthenticated', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: false,
        userId: null,
      } as never)

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const { PATCH } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 400 for invalid body', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])

      const req = createMockRequest('PATCH', { documentIds: [] })
      const { PATCH } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(400)
    })

    it('returns 404 when connector not found', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const { PATCH } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns success for restore operation', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const { PATCH } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await PATCH(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.restoredCount).toBe(1)
    })

    it('returns success for exclude operation', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
        success: true,
        userId: 'user-1',
      } as never)
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.returning.mockResolvedValueOnce([{ id: 'doc-2' }, { id: 'doc-3' }])

      const req = createMockRequest('PATCH', {
        operation: 'exclude',
        documentIds: ['doc-2', 'doc-3'],
      })
      const { PATCH } = await import(
        '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
      )
      const response = await PATCH(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.excludedCount).toBe(2)
      expect(data.data.documentIds).toEqual(['doc-2', 'doc-3'])
    })
  })
})
