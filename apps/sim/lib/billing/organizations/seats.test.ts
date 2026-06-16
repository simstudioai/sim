/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSyncSubscriptionUsageLimits, enqueueMock, setMock, queryQueue, mockFeatureFlags } =
  vi.hoisted(() => ({
    mockSyncSubscriptionUsageLimits: vi.fn(),
    enqueueMock: vi.fn(),
    setMock: vi.fn(),
    queryQueue: { value: [] as unknown[][] },
    mockFeatureFlags: { isBillingEnabled: true },
  }))

vi.mock('@sim/db', () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.for = () => chain
    chain.limit = () => Promise.resolve(queryQueue.value.shift() ?? [])
    chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(queryQueue.value.shift() ?? []).then(resolve, reject)
    return chain
  }
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      setMock(values)
      return { where: () => Promise.resolve([]) }
    },
  })
  const txMock = { select: () => makeSelectChain(), update }
  const dbMock = {
    select: () => makeSelectChain(),
    update,
    transaction: async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
  }
  return { db: dbMock }
})

vi.mock('@/lib/billing/organization', () => ({
  syncSubscriptionUsageLimits: mockSyncSubscriptionUsageLimits,
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: enqueueMock,
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'

const teamSub = {
  id: 'sub-1',
  plan: 'team_6000',
  status: 'active',
  seats: 1,
  stripeSubscriptionId: 'stripe_sub',
}

describe('reconcileOrganizationSeats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryQueue.value = []
    enqueueMock.mockResolvedValue('evt-1')
    mockFeatureFlags.isBillingEnabled = true
  })

  it('grows seats to the member count and enqueues a Stripe sync', async () => {
    queryQueue.value = [[teamSub], [{ value: 2 }]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result).toEqual({
      changed: true,
      previousSeats: 1,
      seats: 2,
      reason: undefined,
      outboxEventId: 'evt-1',
    })
    expect(setMock).toHaveBeenCalledWith({ seats: 2 })
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), 'stripe.sync-subscription-seats', {
      subscriptionId: 'sub-1',
      reason: 'member-accepted-invite',
    })
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', referenceId: 'org-1', seats: 2 })
    )
  })

  it('reduces seats to the member count on removal', async () => {
    queryQueue.value = [[{ ...teamSub, seats: 3 }], [{ value: 2 }]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-removed',
    })

    expect(result.changed).toBe(true)
    expect(result.seats).toBe(2)
    expect(setMock).toHaveBeenCalledWith({ seats: 2 })
    expect(enqueueMock).toHaveBeenCalled()
  })

  it('is a no-op when seats already match the member count', async () => {
    queryQueue.value = [[{ ...teamSub, seats: 2 }], [{ value: 2 }]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-removed',
    })

    expect(result).toEqual({
      changed: false,
      previousSeats: 2,
      seats: 2,
      reason: undefined,
      outboxEventId: undefined,
    })
    expect(setMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('never drops below one seat', async () => {
    queryQueue.value = [[{ ...teamSub, seats: 3 }], [{ value: 0 }]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-removed',
    })

    expect(result.seats).toBe(1)
    expect(setMock).toHaveBeenCalledWith({ seats: 1 })
  })

  it('skips non-Team subscriptions', async () => {
    queryQueue.value = [[{ ...teamSub, plan: 'pro_6000' }]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result.changed).toBe(false)
    expect(result.reason).toMatch(/Team/)
    expect(setMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when the organization has no usable subscription', async () => {
    queryQueue.value = [[]]

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result).toEqual({ changed: false, reason: 'No active subscription found' })
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('no-ops when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result).toEqual({ changed: false, reason: 'Billing is not enabled' })
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
