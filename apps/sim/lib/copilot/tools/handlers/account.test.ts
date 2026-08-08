/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserUsageData, mockGetCreditBalance, mockGetUserUsageLimitInfo } = vi.hoisted(
  () => ({
    mockGetUserUsageData: vi.fn(),
    mockGetCreditBalance: vi.fn(),
    mockGetUserUsageLimitInfo: vi.fn(),
  })
)

vi.mock('@/lib/billing', () => ({
  getUserUsageData: mockGetUserUsageData,
  getCreditBalance: mockGetCreditBalance,
  getUserUsageLimitInfo: mockGetUserUsageLimitInfo,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeGetAccountBilling } from '@/lib/copilot/tools/handlers/account'

const context = { userId: 'user-1' } as ExecutionContext

describe('executeGetAccountBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the org-aware plan, usage, and credit snapshot', async () => {
    const periodEnd = new Date('2026-09-01T00:00:00Z')
    mockGetUserUsageData.mockResolvedValue({
      currentUsage: 18.5,
      limit: 40,
      percentUsed: 46.25,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: new Date('2026-08-01T00:00:00Z'),
      billingPeriodEnd: periodEnd,
      lastPeriodCost: 31,
    })
    mockGetCreditBalance.mockResolvedValue({
      balance: 25,
      entityType: 'organization',
      entityId: 'org-1',
    })
    mockGetUserUsageLimitInfo.mockResolvedValue({
      currentLimit: 40,
      canEdit: false,
      minimumLimit: 0,
      plan: 'team',
      updatedAt: null,
      scope: 'organization',
      organizationId: 'org-1',
    })

    const result = await executeGetAccountBilling(context)

    expect(mockGetUserUsageData).toHaveBeenCalledWith('user-1')
    expect(mockGetCreditBalance).toHaveBeenCalledWith('user-1')
    expect(mockGetUserUsageLimitInfo).toHaveBeenCalledWith('user-1')
    expect(result).toEqual({
      success: true,
      output: {
        plan: 'team',
        billingScope: 'organization',
        organizationId: 'org-1',
        usage: {
          currentPeriodCost: 18.5,
          limit: 40,
          remaining: 21.5,
          percentUsed: 46.25,
          isExceeded: false,
          billingPeriodEnd: periodEnd,
        },
        credits: { balance: 25, scope: 'organization' },
      },
    })
  })

  it('clamps remaining to zero when usage exceeds the limit', async () => {
    mockGetUserUsageData.mockResolvedValue({
      currentUsage: 45,
      limit: 40,
      percentUsed: 112.5,
      isWarning: false,
      isExceeded: true,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
    })
    mockGetCreditBalance.mockResolvedValue({ balance: 0, entityType: 'user', entityId: 'user-1' })
    mockGetUserUsageLimitInfo.mockResolvedValue({
      currentLimit: 40,
      canEdit: true,
      minimumLimit: 0,
      plan: 'pro',
      updatedAt: null,
      scope: 'user',
      organizationId: null,
    })

    const result = await executeGetAccountBilling(context)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      plan: 'pro',
      usage: { remaining: 0, isExceeded: true },
    })
  })

  it('surfaces a billing lookup failure as a tool error', async () => {
    mockGetUserUsageData.mockRejectedValue(new Error('stats row missing'))
    mockGetCreditBalance.mockResolvedValue({ balance: 0, entityType: 'user', entityId: 'user-1' })
    mockGetUserUsageLimitInfo.mockResolvedValue({})

    const result = await executeGetAccountBilling(context)

    expect(result).toEqual({ success: false, error: 'stats row missing' })
  })
})
