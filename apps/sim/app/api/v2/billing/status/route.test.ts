/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockCheckBillingBlocked,
  mockCheckUsageStatus,
  mockGetHighestPrioritySubscription,
  mockDeriveBillingContext,
  mockResolveBillingAttribution,
  mockCheckAttributedBillingBlocks,
  mockToUsageLimitSubscription,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckBillingBlocked: vi.fn(),
  mockCheckUsageStatus: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockDeriveBillingContext: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockCheckAttributedBillingBlocks: vi.fn(),
  mockToUsageLimitSubscription: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkBillingBlocked: mockCheckBillingBlocked,
  checkBillingEntityBlocked: vi.fn(),
  checkUsageStatus: mockCheckUsageStatus,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  deriveBillingContext: mockDeriveBillingContext,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
  checkAttributedBillingBlocks: mockCheckAttributedBillingBlocks,
  toUsageLimitSubscription: mockToUsageLimitSubscription,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/billing/status/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callStatus(query = '') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/billing/status${query}`))
}

describe('GET /api/v2/billing/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro' })
    mockDeriveBillingContext.mockReturnValue({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00Z'),
        end: new Date('2026-08-01T00:00:00Z'),
      },
    })
    mockCheckUsageStatus.mockResolvedValue({
      isExceeded: false,
      currentUsage: 2.5,
      limit: 100,
    })
    mockCheckBillingBlocked.mockResolvedValue({ blocked: false })
    mockCheckAttributedBillingBlocks.mockResolvedValue({ blocked: false })
    mockToUsageLimitSubscription.mockReturnValue({
      referenceId: 'org-1',
      plan: 'team',
      status: 'active',
      seats: 5,
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-08-01T00:00:00Z'),
    })
  })

  it('returns status and allowance without ledger rows or source summaries', async () => {
    const response = await callStatus()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      workspaceId: null,
      period: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
      plan: 'pro',
      status: 'active',
      credits: { used: 500, limit: 20000, remaining: 19500 },
    })
    expect(body.data).not.toHaveProperty('bySourceCredits')
  })

  it('reports billing blocks before usage-limit state', async () => {
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, currentUsage: 100, limit: 100 })
    mockCheckBillingBlocked.mockResolvedValue({ blocked: true })

    const body = await (await callStatus()).json()

    expect(body.data.status).toBe('billing_blocked')
  })

  it('resolves a workspace billing status against the workspace payer', async () => {
    mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: {
        id: 'sub-1',
        referenceId: 'org-1',
        plan: 'team',
        status: 'active',
        seats: 5,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
      },
    })

    const body = await (await callStatus('?workspaceId=ws-1')).json()

    expect(body.data.workspaceId).toBe('ws-1')
    expect(body.data.plan).toBe('team')
    expect(mockCheckUsageStatus).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ referenceId: 'org-1', plan: 'team' })
    )
  })

  it('403s a workspace API key asking for a different workspace', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      keyType: 'workspace',
      workspaceId: 'ws-1',
    })

    const response = await callStatus('?workspaceId=ws-2')

    expect(response.status).toBe(403)
    expect(mockCheckUsageStatus).not.toHaveBeenCalled()
  })

  it('reuses the admitted workspace key payer snapshot for billing status', async () => {
    const billingAttribution = {
      actorUserId: 'payer-1',
      workspaceId: 'ws-1',
      organizationId: 'org-1',
      billedAccountUserId: 'payer-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      userId: 'payer-1',
      principalUserId: 'creator-1',
      keyType: 'workspace',
      workspaceId: 'ws-1',
      billingAttribution,
    })

    const response = await callStatus('?workspaceId=ws-1')

    expect(response.status).toBe(200)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockToUsageLimitSubscription).toHaveBeenCalledWith(billingAttribution)
    expect(mockCheckAttributedBillingBlocks).toHaveBeenCalledWith(billingAttribution)
  })
})
