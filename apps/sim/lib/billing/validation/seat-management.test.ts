import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingOutboxHandlersMock } from '@sim/testing/mocks/billing-outbox-handlers.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import {
  billingSubscriptionUtilsMock,
  billingSubscriptionUtilsMockFns,
} from '@sim/testing/mocks/billing-subscription-utils.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => billingOutboxHandlersMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn((email: string) => ({ isValid: email.includes('@') })),
}))

import {
  countPendingSeatInvitations,
  syncSeatsFromStripeQuantity,
  validateSeatAvailability,
} from '@/lib/billing/validation/seat-management'

const mockGetOrganizationSubscription = billingCoreMockFns.mockGetOrganizationSubscription
const mockHasInflightOutboxEvent = outboxServiceMockFns.mockHasInflightOutboxEvent
billingPlanHelpersMockFns.mockIsEnterprise.mockReturnValue(false)
billingPlanHelpersMockFns.mockIsFree.mockReturnValue(false)
billingPlanHelpersMockFns.mockIsPro.mockReturnValue(false)
billingSubscriptionUtilsMockFns.mockGetEffectiveSeats.mockReturnValue(10)

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

afterAll(resetEnvFlagsMock)

describe('validateSeatAvailability', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
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

describe('countPendingSeatInvitations', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('excludes invitees who already belong to any organization by normalized email', async () => {
    queueSelectResponses([[{ count: 1 }]])

    await expect(countPendingSeatInvitations('org-1')).resolves.toBe(1)

    const predicate = dbChainMockFns.where.mock.calls[0]?.[0] as {
      conditions?: Array<{ toSQL?: () => { sql: string; params: unknown[] } }>
    }
    const existingMemberGuard = predicate.conditions?.find(
      (condition) => typeof condition?.toSQL === 'function'
    )
    const rendered = existingMemberGuard?.toSQL?.()
    expect(rendered?.sql.toLowerCase()).toContain('not exists')
    expect(rendered?.sql.toLowerCase()).toContain('btrim')
    // The member exclusion is deliberately cross-org, so its own SQL fragment
    // must not carry the destination organization as a parameter.
    expect(rendered?.params?.filter((param) => param === 'org-1')).toHaveLength(0)
  })
})

describe('syncSeatsFromStripeQuantity', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockHasInflightOutboxEvent.mockResolvedValue(false)
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
