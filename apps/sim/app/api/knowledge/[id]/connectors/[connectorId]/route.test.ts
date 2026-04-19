/**
 * @vitest-environment node
 */
import {
  auditMock,
  authOAuthUtilsMock,
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
  requestUtilsMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbChain, mockValidateConfig } = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }
  return {
    mockDbChain: chain,
    mockValidateConfig: vi.fn(),
  }
})

const mockCheckAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess
const mockCheckWriteAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/core/utils/request', () => requestUtilsMock)
vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_REGISTRY: {
    jira: { validateConfig: mockValidateConfig },
  },
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  cleanupUnusedTagDefinitions: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  deleteDocumentStorageFiles: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/audit/log', () => auditMock)

import { DELETE, GET, PATCH } from '@/app/api/knowledge/[id]/connectors/[connectorId]/route'

describe('Knowledge Connector By ID API Route', () => {
  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.orderBy.mockReturnThis()
    mockDbChain.limit.mockResolvedValue([])
    mockDbChain.execute.mockResolvedValue(undefined)
    mockDbChain.transaction.mockImplementation(
      async (callback: (tx: typeof mockDbChain) => unknown) => callback(mockDbChain)
    )
    mockDbChain.update.mockReturnThis()
    mockDbChain.delete.mockReturnThis()
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
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 404 when KB not found', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: false, notFound: true })

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns 404 when connector not found', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns connector with sync logs on success', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckAccess.mockResolvedValue({ hasAccess: true })

      const mockConnector = { id: 'conn-456', connectorType: 'jira', status: 'active' }
      const mockLogs = [{ id: 'log-1', status: 'completed' }]

      mockDbChain.limit.mockResolvedValueOnce([mockConnector]).mockResolvedValueOnce(mockLogs)

      const req = createMockRequest('GET')
      const response = await GET(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe('conn-456')
      expect(data.data.syncLogs).toHaveLength(1)
    })
  })

  describe('PATCH', () => {
    it('returns 401 when unauthenticated', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: false,
        userId: null,
      })

      const req = createMockRequest('PATCH', { status: 'paused' })
      const response = await PATCH(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 400 for invalid body', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })

      const req = createMockRequest('PATCH', { syncIntervalMinutes: 'not a number' })
      const response = await PATCH(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request')
    })

    it('returns 404 when connector not found during sourceConfig validation', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: true,
        userId: 'user-1',
      })
      mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('PATCH', { sourceConfig: { project: 'NEW' } })
      const response = await PATCH(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns 200 and updates status', async () => {
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

      const updatedConnector = { id: 'conn-456', status: 'paused', syncIntervalMinutes: 120 }
      mockDbChain.limit.mockResolvedValueOnce([updatedConnector])

      const req = createMockRequest('PATCH', { status: 'paused', syncIntervalMinutes: 120 })
      const response = await PATCH(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('paused')
    })
  })

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
        success: false,
        userId: null,
      })

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 200 on successful hard-delete', async () => {
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
      mockDbChain.where
        .mockReturnValueOnce(mockDbChain)
        .mockResolvedValueOnce([{ id: 'doc-1', fileUrl: '/api/uploads/test.txt' }])
        .mockReturnValueOnce(mockDbChain)
      mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456', connectorType: 'jira' }])
      mockDbChain.returning.mockResolvedValueOnce([{ id: 'conn-456' }])

      const req = createMockRequest('DELETE')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })
})
