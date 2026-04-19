/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbResults } = vi.hoisted(() => ({
  mockDbResults: { value: [] as Array<unknown> },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi.fn().mockImplementation(async () => {
        const result = mockDbResults.value.shift()
        if (result instanceof Error) {
          throw result
        }
        return result ?? []
      })
      return chain
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

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

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
}))

import {
  getOrganizationIdForSubscriptionReference,
  hasPaidSubscription,
} from '@/lib/billing/core/subscription'

describe('hasPaidSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
  })

  it('returns true when an entitled subscription exists', async () => {
    mockDbResults.value = [[{ id: 'sub-1' }]]

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('returns false when no entitled subscription exists', async () => {
    mockDbResults.value = [[]]

    await expect(hasPaidSubscription('org-1')).resolves.toBe(false)
  })

  it('fails closed by default when the lookup errors', async () => {
    mockDbResults.value = [new Error('db unavailable')]

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('throws when requested so callers can retry instead of skipping cleanup', async () => {
    mockDbResults.value = [new Error('db unavailable')]

    await expect(hasPaidSubscription('org-1', { onError: 'throw' })).rejects.toThrow(
      'db unavailable'
    )
  })
})

describe('getOrganizationIdForSubscriptionReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
  })

  it('returns an organization id directly when the reference already points to one', async () => {
    mockDbResults.value = [[{ id: 'org-1' }]]

    await expect(getOrganizationIdForSubscriptionReference('org-1')).resolves.toBe('org-1')
  })

  it('falls back to the admin-owned organization when the reference is still user-scoped', async () => {
    mockDbResults.value = [
      [],
      [
        {
          organizationId: 'org-1',
          role: 'owner',
        },
      ],
    ]

    await expect(getOrganizationIdForSubscriptionReference('user-1')).resolves.toBe('org-1')
  })
})
