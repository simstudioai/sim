/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFeatureFlags, mockGetOrganizationSubscription, mockHasInflightOutboxEvent } =
  vi.hoisted(() => ({
    mockFeatureFlags: { isBillingEnabled: false },
    mockGetOrganizationSubscription: vi.fn(),
    mockHasInflightOutboxEvent: vi.fn(),
  }))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/core/outbox/service', () => ({
  hasInflightOutboxEvent: mockHasInflightOutboxEvent,
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  },
}))

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

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn((email: string) => ({ isValid: email.includes('@') })),
}))

import {
  getOrganizationSeatInfo,
  syncSeatsFromStripeQuantity,
  validateSeatAvailability,
} from '@/lib/billing/validation/seat-management'

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

describe('validateSeatAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFeatureFlags.isBillingEnabled = true
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-1',
      plan: 'team',
      status: 'active',
      seats: 10,
    })
  })

  it('uses the internal pending invitation count when checking seats', async () => {
    queueSelectResponses([[{ count: 2 }], [{ count: 1 }]])

    const result = await validateSeatAvailability('org-1', 1)

    expect(result).toMatchObject({
      canInvite: true,
      currentSeats: 3,
      maxSeats: 10,
      availableSeats: 7,
    })
  })
})

describe('syncSeatsFromStripeQuantity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockHasInflightOutboxEvent.mockResolvedValue(false)
  })

  it('does nothing when the Stripe quantity already matches the DB', async () => {
    const result = await syncSeatsFromStripeQuantity('sub-1', 3, 3)

    expect(result).toEqual({ synced: false, previousSeats: 3, newSeats: 3 })
    expect(mockHasInflightOutboxEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('writes the Stripe quantity to the DB when no seat-sync is in flight', async () => {
    mockHasInflightOutboxEvent.mockResolvedValue(false)

    const result = await syncSeatsFromStripeQuantity('sub-1', 2, 3)

    expect(result).toEqual({ synced: true, previousSeats: 2, newSeats: 3 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 3 })
  })

  it('skips the Stripe-to-DB write while a seat-sync to Stripe is in flight', async () => {
    mockHasInflightOutboxEvent.mockResolvedValue(true)

    const result = await syncSeatsFromStripeQuantity('sub-1', 2, 3)

    expect(result).toEqual({ synced: false, previousSeats: 2, newSeats: 2 })
    expect(mockHasInflightOutboxEvent).toHaveBeenCalledWith(
      'stripe.sync-subscription-seats',
      'subscriptionId',
      'sub-1'
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
