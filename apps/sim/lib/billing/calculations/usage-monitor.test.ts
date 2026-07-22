/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFlags,
  mockGetOrgMemberUsageForBillingPeriod,
  mockGetOrgMemberUsageLimit,
  mockIsOrganizationBillingBlocked,
} = vi.hoisted(() => ({
  mockFlags: { isHosted: true, isBillingEnabled: true },
  mockGetOrgMemberUsageForBillingPeriod: vi.fn(),
  mockGetOrgMemberUsageLimit: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockFlags.isHosted
  },
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  getOrgMemberUsageForBillingPeriod: mockGetOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageLimit: mockGetOrgMemberUsageLimit,
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

// core/usage pulls in the email-rendering chain at import; stub the two symbols
// usage-monitor imports from it so the module loads in a node test env.
vi.mock('@/lib/billing/core/usage', () => ({
  getPooledOrgCurrentPeriodCost: vi.fn(),
  getUserUsageLimit: vi.fn(),
}))

import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkOrganizationMemberUsageLimit,
} from '@/lib/billing/calculations/usage-monitor'

afterAll(() => {
  resetDbChainMock()
})

describe('checkBillingBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
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
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
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
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
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
    mockFlags.isHosted = false
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops when billing is disabled', async () => {
    mockFlags.isBillingEnabled = false
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
