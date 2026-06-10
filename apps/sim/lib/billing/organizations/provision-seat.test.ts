/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetOrganizationSubscription,
  mockGetHighestPriorityPersonalSubscription,
  mockEnsureOrganizationForTeamSubscription,
  mockGetPlanByName,
  enqueueMock,
  updateCalls,
} = vi.hoisted(() => ({
  mockGetOrganizationSubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockEnsureOrganizationForTeamSubscription: vi.fn(),
  mockGetPlanByName: vi.fn(),
  enqueueMock: vi.fn(),
  updateCalls: { value: [] as Array<Record<string, unknown>> },
}))

vi.mock('@sim/db', () => {
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      updateCalls.value.push(values)
      return { where: () => Promise.resolve([]) }
    },
  })
  const txMock = { update }
  const dbMock = {
    update,
    transaction: async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
  }
  return { db: dbMock }
})

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
}))

vi.mock('@/lib/billing/organization', () => ({
  ensureOrganizationForTeamSubscription: mockEnsureOrganizationForTeamSubscription,
}))

vi.mock('@/lib/billing/plans', () => ({
  getPlanByName: mockGetPlanByName,
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: enqueueMock,
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
    STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  },
}))

import { ensureTeamOrganizationForAcceptance } from '@/lib/billing/organizations/provision-seat'

describe('ensureTeamOrganizationForAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.value = []
    mockGetPlanByName.mockReturnValue({
      priceId: 'price_team_month',
      annualDiscountPriceId: 'price_team_year',
    })
  })

  it('is a no-op for enterprise organizations (fixed seats)', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-ent',
      plan: 'enterprise',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      seats: 5,
    })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: 'org-1',
    })

    expect(result).toEqual({ success: true, organizationId: 'org-1', fixedSeats: true })
    expect(updateCalls.value).toHaveLength(0)
  })

  it('is a no-op for an existing Team organization (org + plan already correct)', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-team',
      plan: 'team_6000',
      status: 'active',
      seats: 1,
      stripeSubscriptionId: 'stripe_sub',
    })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: 'org-1',
    })

    expect(result).toEqual({ success: true, organizationId: 'org-1', fixedSeats: false })
    expect(updateCalls.value).toHaveLength(0)
  })

  it('moves an org-scoped Pro subscription to the equivalent Team plan', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      seats: 1,
      stripeSubscriptionId: 'stripe_sub',
    })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: 'org-1',
    })

    expect(result).toEqual({ success: true, organizationId: 'org-1', fixedSeats: false })
    expect(updateCalls.value).toContainEqual(expect.objectContaining({ plan: 'team_6000' }))
    // The Pro→Team price migration is durably enqueued at conversion time.
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-subscription-seats',
      expect.objectContaining({ subscriptionId: 'sub-pro' })
    )
  })

  it('returns upgrade-required when the personal owner has no usable subscription', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })

    expect(result).toEqual({ success: false, failureCode: 'upgrade-required' })
    expect(mockEnsureOrganizationForTeamSubscription).not.toHaveBeenCalled()
  })

  it('converts a personal Pro subscription into a Team organization', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      cancelAtPeriodEnd: false,
    })
    mockEnsureOrganizationForTeamSubscription.mockResolvedValue({ referenceId: 'org-new' })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })

    expect(result).toEqual({ success: true, organizationId: 'org-new', fixedSeats: false })
    expect(updateCalls.value).toContainEqual(
      expect.objectContaining({ plan: 'team_6000', cancelAtPeriodEnd: false })
    )
    expect(mockEnsureOrganizationForTeamSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'team_6000', referenceId: 'owner-1' })
    )
    // The plan change enqueues the price seat-sync...
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-subscription-seats',
      expect.objectContaining({ subscriptionId: 'sub-pro' })
    )
    // ...but with no scheduled cancellation there is no cancel-sync event.
    expect(enqueueMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-cancel-at-period-end',
      expect.anything()
    )
  })

  it('clears a scheduled cancellation when converting a Pro subscription', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      cancelAtPeriodEnd: true,
    })
    mockEnsureOrganizationForTeamSubscription.mockResolvedValue({ referenceId: 'org-new' })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })

    expect(result.success).toBe(true)
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-cancel-at-period-end',
      expect.objectContaining({ stripeSubscriptionId: 'stripe_sub', subscriptionId: 'sub-pro' })
    )
  })

  it('provisions an org for a legacy personal-scoped Team subscription without a plan change', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-team',
      plan: 'team',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    })
    mockEnsureOrganizationForTeamSubscription.mockResolvedValue({ referenceId: 'org-new' })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })

    expect(result).toEqual({ success: true, organizationId: 'org-new', fixedSeats: false })
    expect(mockEnsureOrganizationForTeamSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'team', referenceId: 'owner-1' })
    )
    // No plan change and no scheduled cancellation: nothing to push to Stripe.
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns upgrade-required (no downgrade) when no eligible Team tier exists', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-max',
      plan: 'pro_25000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    })
    // Team Max price is unconfigured in this deployment.
    mockGetPlanByName.mockReturnValue(undefined)

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
    })

    expect(result).toEqual({ success: false, failureCode: 'upgrade-required' })
    expect(mockEnsureOrganizationForTeamSubscription).not.toHaveBeenCalled()
  })
})
