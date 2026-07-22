/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
  requestUtilsMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchSync, mockResolveBillingAttribution } = vi.hoisted(() => ({
  mockDispatchSync: vi.fn().mockResolvedValue(undefined),
  mockResolveBillingAttribution: vi.fn(),
}))

const mockCheckWriteAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireBillingAttributionHeader: vi.fn(),
  resolveBillingAttribution: mockResolveBillingAttribution,
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({
  dispatchSync: mockDispatchSync,
}))
vi.mock('@sim/audit', () => auditMock)

import { POST } from '@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route'

describe('Connector Manual Sync API Route', () => {
  const mockParams = Promise.resolve({ id: 'kb-123', connectorId: 'conn-456' })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('test-req-id')
  })

  afterAll(() => {
    resetDbChainMock()
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
    dbChainMockFns.limit.mockResolvedValueOnce([])

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
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'syncing' }])

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(409)
  })

  it('dispatches sync on valid request', async () => {
    const billingAttribution = {
      actorUserId: 'external-admin',
      workspaceId: 'ws-1',
      organizationId: null,
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'user' as const, id: 'owner-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'external-admin',
      userName: 'Test',
      userEmail: 'test@test.com',
    })
    mockCheckWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: { workspaceId: 'ws-1', name: 'Test KB' },
    })
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'active' }])
    mockResolveBillingAttribution.mockResolvedValue(billingAttribution)

    const req = createMockRequest('POST')
    const response = await POST(req as never, { params: mockParams })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'external-admin',
      workspaceId: 'ws-1',
    })
    expect(mockDispatchSync).toHaveBeenCalledWith('conn-456', {
      billingAttribution,
      requestId: 'test-req-id',
      rehydrate: false,
    })
  })

  it('dispatches a full resync when rehydrate=true is set', async () => {
    const billingAttribution = {
      actorUserId: 'external-admin',
      workspaceId: 'ws-1',
      organizationId: null,
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'user' as const, id: 'owner-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'external-admin',
      userName: 'Test',
      userEmail: 'test@test.com',
    })
    mockCheckWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: { workspaceId: 'ws-1', name: 'Test KB' },
    })
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-456', status: 'active' }])
    mockResolveBillingAttribution.mockResolvedValue(billingAttribution)

    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/knowledge/kb-123/connectors/conn-456/sync?rehydrate=true'
    )
    const response = await POST(req as never, { params: mockParams })

    expect(response.status).toBe(200)
    expect(mockDispatchSync).toHaveBeenCalledWith('conn-456', {
      billingAttribution,
      requestId: 'test-req-id',
      rehydrate: true,
    })
  })
})
