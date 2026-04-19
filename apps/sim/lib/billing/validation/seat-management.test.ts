/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbResults, mockFeatureFlags, mockGetOrganizationSubscription } = vi.hoisted(() => ({
  mockDbResults: { value: [] as any[] },
  mockFeatureFlags: { isBillingEnabled: false },
  mockGetOrganizationSubscription: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() ?? []))
      chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
        const rows = mockDbResults.value.shift() ?? []
        return Promise.resolve(callback(rows))
      })
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

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

describe('getOrganizationSeatInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    mockFeatureFlags.isBillingEnabled = false
    mockGetOrganizationSubscription.mockResolvedValue(null)
  })

  it('returns unlimited seat info when billing is disabled', async () => {
    mockDbResults.value = [[{ id: 'org-1', name: 'Acme' }], [{ count: 3 }], [{ count: 2 }]]

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
