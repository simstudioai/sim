/**
 * @vitest-environment node
 */
import {
  auditMock,
  authOAuthUtilsMock,
  createMockRequest,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockDbChain,
  mockDispatchSync,
  mockEncryptApiKey,
  mockHasWorkspaceLiveSyncAccess,
  mockResolveBillingAttribution,
  mockValidateConfig,
} = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn(),
  }
  return {
    mockCaptureServerEvent: vi.fn(),
    mockDbChain: chain,
    mockDispatchSync: vi.fn(),
    mockEncryptApiKey: vi.fn(),
    mockHasWorkspaceLiveSyncAccess: vi.fn(),
    mockResolveBillingAttribution: vi.fn(),
    mockValidateConfig: vi.fn(),
  }
})

const mockCheckWriteAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    test: {
      auth: { mode: 'apiKey' },
      validateConfig: mockValidateConfig,
    },
  },
}))
vi.mock('@/lib/api-key/crypto', () => ({
  encryptApiKey: mockEncryptApiKey,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireBillingAttributionHeader: vi.fn(),
  resolveBillingAttribution: mockResolveBillingAttribution,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceLiveSyncAccess: mockHasWorkspaceLiveSyncAccess,
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({
  dispatchSync: mockDispatchSync,
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  createTagDefinition: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { POST } from '@/app/api/knowledge/[id]/connectors/route'

const BILLING_ATTRIBUTION = {
  actorUserId: 'free-external-admin',
  workspaceId: 'workspace-paid',
  organizationId: 'organization-paid',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'organization-paid' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-paid',
    referenceId: 'organization-paid',
    plan: 'team_25000',
    status: 'active',
    seats: 5,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}

describe('Knowledge Connectors API Route', () => {
  const context = { params: Promise.resolve({ id: 'knowledge-base-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.insert.mockReturnThis()
    mockDbChain.execute.mockResolvedValue(undefined)
    mockDbChain.values.mockResolvedValue(undefined)
    mockDbChain.transaction.mockImplementation(
      async (callback: (tx: typeof mockDbChain) => unknown) => callback(mockDbChain)
    )
    mockDispatchSync.mockResolvedValue(undefined)
    mockEncryptApiKey.mockResolvedValue({ encrypted: 'encrypted-api-key' })
    mockValidateConfig.mockResolvedValue({ valid: true })
  })

  it('queues the authenticated actor with the paid workspace payer', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'free-external-admin',
      userName: 'External Admin',
      userEmail: 'external@example.com',
    })
    mockCheckWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: {
        id: 'knowledge-base-1',
        name: 'Paid KB',
        workspaceId: 'workspace-paid',
      },
    })
    mockHasWorkspaceLiveSyncAccess.mockResolvedValue(true)
    mockResolveBillingAttribution.mockResolvedValue(BILLING_ATTRIBUTION)
    mockDbChain.limit.mockResolvedValueOnce([{ id: 'knowledge-base-1' }]).mockResolvedValueOnce([
      {
        id: 'connector-1',
        knowledgeBaseId: 'knowledge-base-1',
        connectorType: 'test',
        status: 'active',
      },
    ])

    const request = createMockRequest('POST', {
      connectorType: 'test',
      apiKey: 'api-key',
      sourceConfig: {},
      syncIntervalMinutes: 5,
    })
    const response = await POST(request, context)

    expect(response.status).toBe(201)
    expect(mockHasWorkspaceLiveSyncAccess).toHaveBeenCalledWith('workspace-paid')
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'free-external-admin',
      workspaceId: 'workspace-paid',
    })
    expect(mockDispatchSync).toHaveBeenCalledWith(expect.any(String), {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: expect.any(String),
    })
  })

  it('denies a paid actor when the workspace payer lacks Max access', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'paid-external-admin',
    })
    mockCheckWriteAccess.mockResolvedValue({
      hasAccess: true,
      knowledgeBase: {
        id: 'knowledge-base-1',
        name: 'Free KB',
        workspaceId: 'workspace-free',
      },
    })
    mockHasWorkspaceLiveSyncAccess.mockResolvedValue(false)

    const request = createMockRequest('POST', {
      connectorType: 'test',
      apiKey: 'api-key',
      sourceConfig: {},
      syncIntervalMinutes: 5,
    })
    const response = await POST(request, context)

    expect(response.status).toBe(403)
    expect(mockHasWorkspaceLiveSyncAccess).toHaveBeenCalledWith('workspace-free')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })
})
