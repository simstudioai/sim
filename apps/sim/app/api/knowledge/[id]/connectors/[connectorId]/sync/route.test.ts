/**
 * @vitest-environment node
 */
import { createMockRequest, mockConsoleLogger, mockDrizzleOrm } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/schema', () => ({
  knowledgeConnector: {
    id: 'id',
    knowledgeBaseId: 'knowledgeBaseId',
    deletedAt: 'deletedAt',
    status: 'status',
  },
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseWriteAccess: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: vi.fn(),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-req-id'),
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  dispatchSync: vi.fn().mockResolvedValue(undefined),
}))

mockDrizzleOrm()
mockConsoleLogger()

describe('Connector Manual Sync API Route', () => {
  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }

  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.orderBy.mockResolvedValue([])
    mockDbChain.limit.mockResolvedValue([])
    mockDbChain.update.mockReturnThis()
    mockDbChain.set.mockReturnThis()

    vi.doMock('@sim/db', () => ({ db: mockDbChain }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: false,
      userId: null,
    } as never)

    const req = createMockRequest('POST')
    const { POST } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(401)
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

    const req = createMockRequest('POST')
    const { POST } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(404)
  })

  it('returns 409 when connector is syncing', async () => {
    const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
    const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')

    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'user-1',
    } as never)
    vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
    mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'syncing' }])

    const req = createMockRequest('POST')
    const { POST } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(409)
  })

  it('dispatches sync on valid request', async () => {
    const { checkSessionOrInternalAuth } = await import('@/lib/auth/hybrid')
    const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
    const { dispatchSync } = await import('@/lib/knowledge/connectors/sync-engine')

    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'user-1',
    } as never)
    vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({ hasAccess: true } as never)
    mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'active' }])

    const req = createMockRequest('POST')
    const { POST } = await import('@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route')
    const response = await POST(req as never, { params: mockParams })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(vi.mocked(dispatchSync)).toHaveBeenCalledWith('conn-456', { requestId: 'test-req-id' })
  })
})
