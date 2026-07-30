/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockGetUserUsageLogs,
  mockCheckServerSideUsageLimits,
  mockGetHighestPrioritySubscription,
  mockDeriveBillingContext,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockGetUserUsageLogs: vi.fn(),
  mockCheckServerSideUsageLimits: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockDeriveBillingContext: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: mockCheckServerSideUsageLimits,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  deriveBillingContext: mockDeriveBillingContext,
  getUserUsageLogs: mockGetUserUsageLogs,
}))

import { GET } from '@/app/api/v2/billing/usage/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callSummary(query = '') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/billing/usage${query}`))
}

describe('GET /api/v2/billing/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro' })
    mockDeriveBillingContext.mockReturnValue({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00Z'),
        end: new Date('2026-08-01T00:00:00Z'),
      },
    })
    mockCheckServerSideUsageLimits.mockResolvedValue({
      isExceeded: false,
      currentUsage: 2.5,
      limit: 100,
    })
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [],
      summary: { totalCost: 2.5, bySource: { workflow: 1.9, copilot: 0.6 } },
      pagination: { hasMore: false },
    })
  })

  it('returns the billing-period summary with per-source credits, no dollars', async () => {
    const res = await callSummary()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({
      period: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
      totalCredits: 500,
      bySourceCredits: { workflow: 380, copilot: 120 },
      limitCredits: 20000,
      plan: 'pro',
    })
    expect(JSON.stringify(body)).not.toContain('dollar')
  })

  it('queries the ledger summary over the derived billing period', async () => {
    await callSummary()
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-08-01T00:00:00Z'),
        includeSummary: true,
      })
    )
  })

  it('pins a workspace API key to its own workspace', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      keyType: 'workspace',
      workspaceId: 'ws-1',
    })
    const res = await callSummary()
    expect(res.status).toBe(200)
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ workspaceId: 'ws-1' })
    )
  })

  it('403s a workspace API key asking for a different workspace', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      keyType: 'workspace',
      workspaceId: 'ws-1',
    })
    const res = await callSummary('?workspaceId=ws-2')
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2026-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callSummary()
    expect(res.status).toBe(429)
  })
})
