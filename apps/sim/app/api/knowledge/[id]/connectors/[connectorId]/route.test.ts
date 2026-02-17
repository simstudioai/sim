/**
 * @vitest-environment node
 */
import { createMockRequest, mockConsoleLogger, mockDrizzleOrm } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshAccessTokenIfNeeded: vi.fn(),
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_REGISTRY: {
    jira: { validateConfig: vi.fn() },
  },
}))
vi.mock('@sim/db/schema', () => ({
  knowledgeBase: { id: 'id', userId: 'userId' },
  knowledgeConnector: {
    id: 'id',
    knowledgeBaseId: 'knowledgeBaseId',
    deletedAt: 'deletedAt',
    connectorType: 'connectorType',
    credentialId: 'credentialId',
  },
  knowledgeConnectorSyncLog: { connectorId: 'connectorId', startedAt: 'startedAt' },
}))

mockDrizzleOrm()
mockConsoleLogger()

describe('Knowledge Connector By ID API Route', () => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }

  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.orderBy.mockReturnThis()
    mockDbChain.limit.mockResolvedValue([])
    mockDbChain.update.mockReturnThis()
    mockDbChain.set.mockReturnThis()

    vi.doMock('@sim/db', () => ({ db: mockDbChain }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: false, userId: null })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 404 when KB not found', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: false, notFound: true })

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns 404 when connector not found', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await GET(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns connector with sync logs on success', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({ hasAccess: true })

      const mockConnector = { id: 'conn-456', connectorType: 'jira', status: 'active' }
      const mockLogs = [{ id: 'log-1', status: 'completed' }]

      mockDbChain.limit.mockResolvedValueOnce([mockConnector]).mockResolvedValueOnce(mockLogs)

      const req = createMockRequest('GET')
      const { GET } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
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
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: false, userId: null })

      const req = createMockRequest('PATCH', { status: 'paused' })
      const { PATCH } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await PATCH(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 400 for invalid body', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true })

      const req = createMockRequest('PATCH', { syncIntervalMinutes: 'not a number' })
      const { PATCH } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await PATCH(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request')
    })

    it('returns 404 when connector not found during sourceConfig validation', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true })
      mockDbChain.limit.mockResolvedValueOnce([])

      const req = createMockRequest('PATCH', { sourceConfig: { project: 'NEW' } })
      const { PATCH } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await PATCH(req, { params: mockParams })

      expect(response.status).toBe(404)
    })

    it('returns 200 and updates status', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true })

      const updatedConnector = { id: 'conn-456', status: 'paused', syncIntervalMinutes: 120 }
      mockDbChain.limit.mockResolvedValueOnce([updatedConnector])

      const req = createMockRequest('PATCH', { status: 'paused', syncIntervalMinutes: 120 })
      const { PATCH } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await PATCH(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('paused')
    })
  })

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: false, userId: null })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await DELETE(req, { params: mockParams })

      expect(response.status).toBe(401)
    })

    it('returns 200 on successful soft-delete', async () => {
      const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: true, userId: 'user-1' })
      vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true })

      const req = createMockRequest('DELETE')
      const { DELETE } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/route')
      const response = await DELETE(req, { params: mockParams })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })
})
