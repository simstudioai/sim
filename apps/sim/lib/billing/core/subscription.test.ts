/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, urlsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: vi.fn(),
  isOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanTierCredits: vi.fn(),
  isPro: vi.fn(),
  isTeam: vi.fn(),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  checkEnterprisePlan: vi.fn(),
  checkProPlan: vi.fn(),
  checkTeamPlan: vi.fn(),
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
  hasUsableSubscriptionAccess: vi.fn(),
  USABLE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isAccessControlEnabled: false,
  isBillingEnabled: true,
  isCredentialSetsEnabled: false,
  isHosted: true,
  isInboxEnabled: false,
  isSsoEnabled: false,
}))

vi.mock('@/lib/core/utils/urls', () => urlsMock)

import {
  getOrganizationIdForSubscriptionReference,
  hasPaidSubscription,
} from '@/lib/billing/core/subscription'

describe('hasPaidSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when an entitled subscription exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'sub-1' }])

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('returns false when no entitled subscription exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(hasPaidSubscription('org-1')).resolves.toBe(false)
  })

  it('fails closed by default when the lookup errors', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('throws when requested so callers can retry instead of skipping cleanup', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1', { onError: 'throw' })).rejects.toThrow(
      'db unavailable'
    )
  })
})

describe('getOrganizationIdForSubscriptionReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an organization id directly when the reference already points to one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    await expect(getOrganizationIdForSubscriptionReference('org-1')).resolves.toBe('org-1')
  })

  it('falls back to the admin-owned organization when the reference is still user-scoped', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organizationId: 'org-1', role: 'owner' }])

    await expect(getOrganizationIdForSubscriptionReference('user-1')).resolves.toBe('org-1')
  })
})
