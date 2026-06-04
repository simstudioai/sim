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

const { mockDispatchSync, mockDbChain } = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }
  return {
    mockDispatchSync: vi.fn().mockResolvedValue(undefined),
    mockDbChain: chain,
  }
})

const mockCheckWriteAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  dispatchSync: mockDispatchSync,
}))
vi.mock('@sim/audit', () => auditMock)

import { POST } from '@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route'

describe('Connector Manual Sync API Route', () => {
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
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      userId: null,
    })

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(401)
  })

  it('returns 404 when connector not found', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })
    mockDbChain.limit.mockResolvedValueOnce([])

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(404)
  })

  it('returns 409 when connector is syncing', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockCheckWriteAccess.mockResolvedValue({ hasAccess: true })
    mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'syncing' }])

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(409)
  })

  it('dispatches sync on valid request', async () => {
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
    mockDbChain.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'active' }])

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockDispatchSync).toHaveBeenCalledWith('conn-456', { requestId: 'test-req-id' })
  })
})
