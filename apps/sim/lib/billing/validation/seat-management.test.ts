/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFeatureFlags, mockGetOrganizationSubscription } = vi.hoisted(() => ({
  mockFeatureFlags: { isBillingEnabled: false },
  mockGetOrganizationSubscription: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: vi.fn().mockReturnValue(false),
  isFree: vi.fn().mockReturnValue(false),
  isPro: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  getEffectiveSeats: vi.fn().mockReturnValue(10),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn((email: string) => ({ isValid: email.includes('@') })),
}))

import { getOrganizationSeatInfo } from '@/lib/billing/validation/seat-management'

/**
 * Queues the next N responses for `db.select().from(...).where(...)` calls,
 * supporting both `.limit(1)` and directly-awaited `where` chains.
 */
function queueSelectResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = {
      limit: vi.fn(() => Promise.resolve(result)),
      orderBy: vi.fn(() => Promise.resolve(result)),
      returning: vi.fn(() => Promise.resolve(result)),
      groupBy: vi.fn(() => Promise.resolve(result)),
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    }
    return thenable as unknown as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('getOrganizationSeatInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFeatureFlags.isBillingEnabled = false
    mockGetOrganizationSubscription.mockResolvedValue(null)
  })

  it('returns unlimited seat info when billing is disabled', async () => {
    queueSelectResponses([[{ id: 'org-1', name: 'Acme' }], [{ count: 3 }], [{ count: 2 }]])

    const result = await getOrganizationSeatInfo('org-1')

    expect(result).toEqual({
      organizationId: 'org-1',
      organizationName: 'Acme',
      currentSeats: 5,
      maxSeats: Number.MAX_SAFE_INTEGER,
      availableSeats: Number.MAX_SAFE_INTEGER,
      subscriptionPlan: 'billing_disabled',
      canAddSeats: false,
    })
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })
})
