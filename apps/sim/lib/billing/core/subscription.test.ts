/**
 * @vitest-environment node
 */
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

vi.mock('@sim/db/schema', () => ({
  member: {
    userId: 'user_id',
    organizationId: 'organization_id',
    role: 'role',
  },
  subscription: {
    id: 'id',
    referenceId: 'reference_id',
    status: 'status',
    metadata: 'metadata',
  },
  user: {
    id: 'id',
    email: 'email',
    name: 'name',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ type: 'inArray', field, values })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

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

import { hasPaidSubscription } from '@/lib/billing/core/subscription'

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
