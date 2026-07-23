/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetOrganizationSubscription,
  mockGetHighestPriorityPersonalSubscription,
  mockEnsureOrganizationForTeamSubscriptionTx,
  mockAssertNoUnresolvedEnterpriseIssuance,
  mockAcquireOrganizationMutationLock,
  mockGetPlanByName,
  enqueueMock,
  updateCalls,
} = vi.hoisted(() => ({
  mockGetOrganizationSubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockEnsureOrganizationForTeamSubscriptionTx: vi.fn(),
  mockAssertNoUnresolvedEnterpriseIssuance: vi.fn(),
  mockAcquireOrganizationMutationLock: vi.fn(),
  mockGetPlanByName: vi.fn(),
  enqueueMock: vi.fn(),
  updateCalls: { value: [] as Array<Record<string, unknown>> },
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
}))

vi.mock('@/lib/billing/organization', () => ({
  ensureOrganizationForTeamSubscriptionTx: mockEnsureOrganizationForTeamSubscriptionTx,
}))

vi.mock('@/lib/billing/enterprise-outbox', () => ({
  assertNoUnresolvedEnterpriseIssuance: mockAssertNoUnresolvedEnterpriseIssuance,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mockAcquireOrganizationMutationLock,
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

function testExecutor(onUpdate: () => void = () => {}) {
  return {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        onUpdate()
        updateCalls.value.push(values)
        return { where: () => Promise.resolve([]) }
      },
    }),
  } as never
}

describe('ensureTeamOrganizationForAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    updateCalls.value = []
    mockGetPlanByName.mockReturnValue({
      priceId: 'price_team_month',
      annualDiscountPriceId: 'price_team_year',
    })
    mockAssertNoUnresolvedEnterpriseIssuance.mockResolvedValue(undefined)
  })

  afterAll(() => {
    resetDbChainMock()
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
      executor: testExecutor(),
      workspaceIdsToAttach: [],
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
      executor: testExecutor(),
      workspaceIdsToAttach: [],
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

    const executor = testExecutor()
    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: 'org-1',
      executor,
      workspaceIdsToAttach: [],
    })

    expect(result).toEqual({
      success: true,
      organizationId: 'org-1',
      fixedSeats: false,
      postCommitEffects: {
        planConversions: [
          {
            organizationId: 'org-1',
            actorId: 'owner-1',
            fromPlan: 'pro_6000',
            toPlan: 'team_6000',
          },
        ],
        usageLimitUserIds: [],
      },
    })
    expect(updateCalls.value).toContainEqual(expect.objectContaining({ plan: 'team_6000' }))
    // The Pro→Team price migration is durably enqueued at conversion time.
    expect(enqueueMock).toHaveBeenCalledWith(
      executor,
      'stripe.sync-subscription-seats',
      expect.objectContaining({ subscriptionId: 'sub-pro' })
    )
    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ executor })
    )
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('blocks an org-scoped Pro conversion while Enterprise issuance is unresolved', async () => {
    mockAssertNoUnresolvedEnterpriseIssuance.mockRejectedValueOnce(
      new Error('Enterprise issuance is unfinished')
    )

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: 'org-1',
      executor: testExecutor(),
      workspaceIdsToAttach: [],
    })

    expect(result).toEqual({ success: false, failureCode: 'server-error' })
    expect(mockAcquireOrganizationMutationLock).toHaveBeenCalledWith(expect.anything(), 'org-1')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(updateCalls.value).toHaveLength(0)
  })

  it('returns upgrade-required when the personal owner has no usable subscription', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)

    const executor = testExecutor()
    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
      executor,
      workspaceIdsToAttach: [],
    })

    expect(result).toEqual({ success: false, failureCode: 'upgrade-required' })
    expect(mockEnsureOrganizationForTeamSubscriptionTx).not.toHaveBeenCalled()
  })

  it('converts a personal Pro subscription into a Team organization', async () => {
    const lockOrder: string[] = []
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      cancelAtPeriodEnd: false,
    })
    mockEnsureOrganizationForTeamSubscriptionTx.mockImplementationOnce(async () => {
      lockOrder.push('organization')
      return { referenceId: 'org-new', usageLimitUserIds: [] }
    })

    const executor = testExecutor(() => lockOrder.push('subscription'))
    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
      executor,
      workspaceIdsToAttach: ['workspace-1'],
    })

    expect(result).toMatchObject({
      success: true,
      organizationId: 'org-new',
      fixedSeats: false,
      postCommitEffects: {
        planConversions: [
          {
            organizationId: 'org-new',
            actorId: 'owner-1',
            fromPlan: 'pro_6000',
            toPlan: 'team_6000',
          },
        ],
      },
    })
    expect(updateCalls.value).toContainEqual(
      expect.objectContaining({ plan: 'team_6000', cancelAtPeriodEnd: false })
    )
    expect(mockEnsureOrganizationForTeamSubscriptionTx).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({ plan: 'team_6000', referenceId: 'owner-1' })
    )
    // The plan change enqueues the price seat-sync...
    expect(enqueueMock).toHaveBeenCalledWith(
      executor,
      'stripe.sync-subscription-seats',
      expect.objectContaining({ subscriptionId: 'sub-pro' })
    )
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(lockOrder).toEqual(['organization', 'subscription'])
    // ...but with no scheduled cancellation there is no cancel-sync event.
    expect(enqueueMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-cancel-at-period-end',
      expect.anything()
    )
  })

  it('blocks personal Pro conversion when the reused organization has unresolved Enterprise', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      cancelAtPeriodEnd: false,
    })
    mockEnsureOrganizationForTeamSubscriptionTx.mockResolvedValue({
      referenceId: 'org-reused',
      usageLimitUserIds: [],
    })
    mockAssertNoUnresolvedEnterpriseIssuance.mockRejectedValueOnce(
      new Error('Enterprise issuance is unfinished')
    )

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
      executor: testExecutor(),
      workspaceIdsToAttach: ['workspace-1'],
    })

    expect(result).toEqual({ success: false, failureCode: 'server-error' })
    expect(updateCalls.value).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('clears a scheduled cancellation when converting a Pro subscription', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-pro',
      plan: 'pro_6000',
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
      cancelAtPeriodEnd: true,
    })
    mockEnsureOrganizationForTeamSubscriptionTx.mockResolvedValue({
      referenceId: 'org-new',
      usageLimitUserIds: [],
    })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
      executor: testExecutor(),
      workspaceIdsToAttach: ['workspace-1'],
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
    mockEnsureOrganizationForTeamSubscriptionTx.mockResolvedValue({
      referenceId: 'org-new',
      usageLimitUserIds: [],
    })

    const result = await ensureTeamOrganizationForAcceptance({
      billingOwnerUserId: 'owner-1',
      workspaceOrganizationId: null,
      executor: testExecutor(),
      workspaceIdsToAttach: ['workspace-1'],
    })

    expect(result).toEqual({ success: true, organizationId: 'org-new', fixedSeats: false })
    expect(mockEnsureOrganizationForTeamSubscriptionTx).toHaveBeenCalledWith(
      expect.anything(),
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
      executor: testExecutor(),
      workspaceIdsToAttach: [],
    })

    expect(result).toEqual({ success: false, failureCode: 'upgrade-required' })
    expect(mockEnsureOrganizationForTeamSubscriptionTx).not.toHaveBeenCalled()
  })
})
