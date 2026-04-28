/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
  requestUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbChain } = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }
  return { mockDbChain: chain }
})

const mockCheckAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess
const mockCheckWriteAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@sim/audit', () => auditMock)

import { GET, PATCH } from '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'

describe('Connector Documents API Route', () => {
  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('test-req-id')
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.orderBy.mockResolvedValue([])
    mockDbChain.limit.mockResolvedValue([])
    mockDbChain.update.mockReturnThis()
    mockDbChain.set.mockReturnThis()
    mockDbChain.returning.mockResolvedValue([])
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: false,
        userId: null,
      })

      const req = createMockRequest('GET')
      const response = await GET(req as never, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 404 when connector not found', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('GET')
      const response = await GET(req as never, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns documents list on success', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: true })

      const doc = { id: 'doc-1', filename: 'test.txt', userExcluded: false }
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.orderBy.mockResolvedValueOnce([doc])

      const url = 'http://localhost/api/knowledge/kb-123/connectors/conn-456/documents'
      const req = createMockRequest('GET', undefined, undefined, url)
      Object.assign(req, { nextUrl: new URL(url) })
      const response = await GET(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.documents).toHaveLength(1)
      expect(data.data.counts.active).toBe(1)
      expect(data.data.counts.excluded).toBe(0)
    })

    it('includes excluded documents when includeExcluded=true', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: true })

      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.orderBy
        .mockResolvedValueOnce([{ id: 'doc-1', userExcluded: false }])
        .mockResolvedValueOnce([{ id: 'doc-2', userExcluded: true }])

      const url =
        'http://localhost/api/knowledge/kb-123/connectors/conn-456/documents?includeExcluded=true'
      const req = createMockRequest('GET', undefined, undefined, url)
      Object.assign(req, { nextUrl: new URL(url) })
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
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: false,
        userId: null,
      })

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 400 for invalid body', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])

      const req = createMockRequest('PATCH', { documentIds: [] })
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(400)
    })

    it('returns 404 when connector not found', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const response = await PATCH(req as never, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns success for restore operation', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
        userName: 'Test',
        userEmail: 'test@test.com',
      })
      mockCheckWriteAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { workspaceId: 'ws-1', name: 'Test KB' },
      })
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

      const req = createMockRequest('PATCH', { operation: 'restore', documentIds: ['doc-1'] })
      const response = await PATCH(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.restoredCount).toBe(1)
    })

    it('returns success for exclude operation', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
        userName: 'Test',
        userEmail: 'test@test.com',
      })
      mockCheckWriteAccess.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { workspaceId: 'ws-1', name: 'Test KB' },
      })
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456' }])
      mockDbChain.returning.mockResolvedValueOnce([{ id: 'doc-2' }, { id: 'doc-3' }])

      const req = createMockRequest('PATCH', {
        operation: 'exclude',
        documentIds: ['doc-2', 'doc-3'],
      })
      const response = await PATCH(req as never, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.excludedCount).toBe(2)
      expect(data.data.documentIds).toEqual(['doc-2', 'doc-3'])
    })
  })
})
