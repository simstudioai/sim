/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSyncSubscriptionUsageLimits, enqueueMock, mockFeatureFlags } = vi.hoisted(() => ({
  mockSyncSubscriptionUsageLimits: vi.fn(),
  enqueueMock: vi.fn(),
  mockFeatureFlags: { isBillingEnabled: true },
}))

vi.mock('@sim/db', () => dbChainMock)

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

vi.mock('@sim/audit', () => auditMock)

import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'

const teamSub = {
  id: 'sub-1',
  plan: 'team_6000',
  status: 'active',
  seats: 1,
  stripeSubscriptionId: 'stripe_sub',
}

/** Queues the two in-transaction reads: locked subscription, then member count. */
function queueReconcileReads(subscriptionRows: unknown[], memberCountRows: unknown[] = []) {
  queueTableRows(schemaMock.subscription, subscriptionRows)
  queueTableRows(schemaMock.member, memberCountRows)
}

describe('reconcileOrganizationSeats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    enqueueMock.mockResolvedValue('evt-1')
    mockFeatureFlags.isBillingEnabled = true
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('grows seats to the member count and enqueues a Stripe sync', async () => {
    queueReconcileReads([teamSub], [{ value: 2 }])

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
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 2 })
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), 'stripe.sync-subscription-seats', {
      subscriptionId: 'sub-1',
      reason: 'member-accepted-invite',
    })
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', referenceId: 'org-1', seats: 2 })
    )
  })

  it('reconciles a past-due Team subscription because it remains entitled', async () => {
    queueReconcileReads([{ ...teamSub, status: 'past_due' }], [{ value: 2 }])

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result.changed).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 2 })
    expect(enqueueMock).toHaveBeenCalledOnce()
  })

  it('still records the seat audit when the post-commit usage-limit sync fails', async () => {
    queueReconcileReads([teamSub], [{ value: 2 }])
    mockSyncSubscriptionUsageLimits.mockRejectedValueOnce(new Error('sync unavailable'))

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
      actorId: 'user-1',
    })

    expect(result.changed).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 2 })
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: auditMock.AuditAction.ORG_SEAT_PROVISIONED,
        resourceId: 'org-1',
      })
    )
  })

  it('reduces seats to the member count on removal', async () => {
    queueReconcileReads([{ ...teamSub, seats: 3 }], [{ value: 2 }])

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-removed',
    })

    expect(result.changed).toBe(true)
    expect(result.seats).toBe(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 2 })
    expect(enqueueMock).toHaveBeenCalled()
  })

  it('is a no-op when seats already match the member count', async () => {
    queueReconcileReads([{ ...teamSub, seats: 2 }], [{ value: 2 }])

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
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('never drops below one seat', async () => {
    queueReconcileReads([{ ...teamSub, seats: 3 }], [{ value: 0 }])

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-removed',
    })

    expect(result.seats).toBe(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ seats: 1 })
  })

  it('skips non-Team subscriptions', async () => {
    queueReconcileReads([{ ...teamSub, plan: 'pro_6000' }])

    const result = await reconcileOrganizationSeats({
      organizationId: 'org-1',
      reason: 'member-accepted-invite',
    })

    expect(result.changed).toBe(false)
    expect(result.reason).toMatch(/Team/)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when the organization has no usable subscription', async () => {
    queueReconcileReads([])

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
