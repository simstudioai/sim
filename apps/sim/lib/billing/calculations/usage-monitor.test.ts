/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetBillingPeriodUsageCost,
  mockGetOrgMemberUsageForBillingPeriod,
  mockGetOrgMemberUsageLimit,
  mockGetUserUsageLimit,
  mockIsOrganizationBillingBlocked,
  mockComputeBillingPeriodUsageWithWeeklyRefresh,
} = vi.hoisted(() => ({
  mockGetBillingPeriodUsageCost: vi.fn(),
  mockGetOrgMemberUsageForBillingPeriod: vi.fn(),
  mockGetOrgMemberUsageLimit: vi.fn(),
  mockGetUserUsageLimit: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
  mockComputeBillingPeriodUsageWithWeeklyRefresh: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  getOrgMemberUsageForBillingPeriod: mockGetOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageLimit: mockGetOrgMemberUsageLimit,
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

// core/usage pulls in the email-rendering chain at import; stub the symbol
// usage-monitor imports from it so the module loads in a node test env.
vi.mock('@/lib/billing/core/usage', () => ({
  getUserUsageLimit: mockGetUserUsageLimit,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: mockGetBillingPeriodUsageCost,
}))

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeBillingPeriodUsageWithWeeklyRefresh: mockComputeBillingPeriodUsageWithWeeklyRefresh,
}))

import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkOrganizationMemberUsageLimit,
  checkServerSideUsageLimits,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'

afterAll(() => {
  resetDbChainMock()
})

afterAll(resetEnvFlagsMock)

describe('checkUsageStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetUserUsageLimit.mockResolvedValue(500)
    mockGetBillingPeriodUsageCost.mockResolvedValue(125)
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValue({
      ledgerUsage: 125,
      refreshConsumed: 25,
    })
  })

  it('reads reporting-period organization usage without loading the member roster', async () => {
    const billingPeriod = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2027-01-01T00:00:00.000Z'),
      source: 'reporting' as const,
      anchorDate: '2026-01-01',
      interval: 'year' as const,
    }
    const subscription = {
      referenceId: 'org-1',
      plan: 'enterprise',
      status: 'active',
      seats: 1,
      periodStart: billingPeriod.start,
      periodEnd: billingPeriod.end,
    }

    await expect(
      checkUsageStatus('user-1', subscription, {
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod,
      })
    ).resolves.toMatchObject({
      currentUsage: 125,
      limit: 500,
      scope: 'organization',
      organizationId: 'org-1',
    })

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      billingPeriod
    )
  })

  it('reads paid personal ledger usage and refresh from one snapshot', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'pro',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 100,
      scope: 'user',
    })

    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).toHaveBeenCalledWith({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: { start: periodStart, end: periodEnd },
      refreshPeriodStart: periodStart,
      refreshPeriodEnd: periodEnd,
      weeklyRefreshDollars: 10,
    })
    expect(mockGetBillingPeriodUsageCost).not.toHaveBeenCalled()
  })

  it('preserves the paid weekly-refresh clamp for negative effective usage', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'pro',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValueOnce({
      ledgerUsage: -1,
      refreshConsumed: 1,
    })

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 0,
      scope: 'user',
    })
  })

  it('keeps unpaid personal usage on the ledger-only query', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'free',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 125,
      scope: 'user',
    })

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'user', id: 'user-1' },
      { start: periodStart, end: periodEnd }
    )
    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).not.toHaveBeenCalled()
  })

  it('preserves negative ledger-only personal usage', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'free',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    mockGetBillingPeriodUsageCost.mockResolvedValueOnce(-1)

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: -1,
      scope: 'user',
    })

    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).not.toHaveBeenCalled()
  })

  it('combines paid organization ledger usage with entity-scoped refresh — no roster read', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'org-1',
      plan: 'team',
      status: 'active',
      seats: 2,
      periodStart,
      periodEnd,
    }
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValue({
      ledgerUsage: 100,
      refreshConsumed: 10,
    })

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 90,
      scope: 'organization',
      organizationId: 'org-1',
    })

    // Refresh is scoped by the entity stamps alone, so departed members'
    // org-attributed rows participate identically to current members'.
    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).toHaveBeenCalledWith({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: expect.objectContaining({
        start: periodStart,
        end: periodEnd,
        source: 'stripe',
      }),
      refreshPeriodStart: periodStart,
      refreshPeriodEnd: periodEnd,
      weeklyRefreshDollars: expect.any(Number),
      seats: 2,
    })
    expect(mockGetBillingPeriodUsageCost).not.toHaveBeenCalled()
  })
})

describe('checkServerSideUsageLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetBillingPeriodUsageCost.mockResolvedValue(125)
  })

  it('keeps blocked accounts blocked while reporting their real ledger usage', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ blocked: true, blockedReason: 'payment_failed' }])
    const subscription = {
      referenceId: 'user-1',
      plan: 'pro',
      status: 'active',
      seats: 1,
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: new Date('2026-07-01T00:00:00.000Z'),
    }

    const result = await checkServerSideUsageLimits('user-1', subscription)

    expect(result).toMatchObject({ isExceeded: true, currentUsage: 125, limit: 0 })
    expect(result.message).toBeTruthy()
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'user', id: 'user-1' },
      expect.objectContaining({
        start: subscription.periodStart,
        end: subscription.periodEnd,
      })
    )
  })
})

describe('checkBillingBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    dbChainMockFns.limit.mockResolvedValue([{ blocked: false, blockedReason: null }])
  })

  it("checks only the actor's own user account without inspecting organization memberships", async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)

    await expect(checkBillingBlocked('actor-1')).resolves.toEqual({ blocked: false })

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
    expect(mockIsOrganizationBillingBlocked).not.toHaveBeenCalled()
  })
})

describe('checkBillingEntityBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    dbChainMockFns.limit.mockResolvedValue([])
  })

  it('checks only the exact organization payer', async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)

    await expect(
      checkBillingEntityBlocked({ type: 'organization', id: 'workspace-org' })
    ).resolves.toMatchObject({ blocked: true })

    expect(mockIsOrganizationBillingBlocked).toHaveBeenCalledWith('workspace-org')
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('checks the exact personal payer directly', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ blocked: true, blockedReason: 'dispute' }])

    await expect(
      checkBillingEntityBlocked({ type: 'user', id: 'personal-payer' })
    ).resolves.toEqual({
      blocked: true,
      message: 'Account frozen. Please contact support to resolve this issue.',
    })

    expect(mockIsOrganizationBillingBlocked).not.toHaveBeenCalled()
  })
})

describe('checkOrganizationMemberUsageLimit', () => {
  const billingPeriod = {
    start: new Date('2026-06-01T00:00:00.000Z'),
    end: new Date('2026-07-01T00:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(1)
  })

  it('uses the immutable organization and billing period', async () => {
    await expect(
      checkOrganizationMemberUsageLimit('actor-1', 'snapshot-org', billingPeriod)
    ).resolves.toMatchObject({
      currentUsage: 1,
      isExceeded: false,
      limit: 2,
    })

    expect(mockGetOrgMemberUsageForBillingPeriod).toHaveBeenCalledWith(
      'snapshot-org',
      'actor-1',
      billingPeriod
    )
  })

  it('no-ops when not hosted', async () => {
    setEnvFlags({ isHosted: false })
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops without reading usage when the member has no cap set', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(null)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageForBillingPeriod).not.toHaveBeenCalled()
  })

  it('blocks when usage meets the cap (>=)', async () => {
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(2)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(true)
    expect(result.message).toBeTruthy()
  })

  it('blocks all usage when the cap is 0', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(0)
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(0)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(true)
  })

  it('fails open when an unexpected error occurs', async () => {
    mockGetOrgMemberUsageLimit.mockRejectedValue(new Error('db down'))
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
  })
})
