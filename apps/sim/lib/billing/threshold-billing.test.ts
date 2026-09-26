import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingOutboxHandlersMock } from '@sim/testing/mocks/billing-outbox-handlers.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingSubscriptionUtilsMock,
  billingSubscriptionUtilsMockFns,
} from '@sim/testing/mocks/billing-subscription-utils.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsSubscriptionCycleCloseCurrent } = vi.hoisted(() => ({
  mockIsSubscriptionCycleCloseCurrent: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/core/access', () => billingAccessMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
const mockGetHighestPrioritySubscription =
  billingSubscriptionMockFns.mockGetHighestPrioritySubscription
const mockGetOrganizationSubscriptionUsable =
  billingSubscriptionMockFns.mockGetOrganizationSubscriptionUsable

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/billing/cycle-close', () => ({
  isSubscriptionCycleCloseCurrent: mockIsSubscriptionCycleCloseCurrent,
}))

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => billingOutboxHandlersMock)

vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
  ThresholdSettlementError,
} from '@/lib/billing/threshold-billing'

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockEnqueueOutboxEvent = outboxServiceMockFns.mockEnqueueOutboxEvent
const mockCalculateSubscriptionOverage = billingCoreMockFns.mockCalculateSubscriptionOverage
const mockComputeOrgOverageAmount = billingCoreMockFns.mockComputeOrgOverageAmount
const mockGetEffectiveBillingStatus = billingAccessMockFns.mockGetEffectiveBillingStatus
const mockIsOrganizationBillingBlocked = billingAccessMockFns.mockIsOrganizationBillingBlocked
const mockGetBillingPeriodUsageCost = billingUsageLogMockFns.mockGetBillingPeriodUsageCost
const mockHasUsableSubscriptionAccess =
  billingSubscriptionUtilsMockFns.mockHasUsableSubscriptionAccess
const mockIsOrgScopedSubscription = billingSubscriptionUtilsMockFns.mockIsOrgScopedSubscription
const mockIsEnterprise = billingPlanHelpersMockFns.mockIsEnterprise
const mockIsFree = billingPlanHelpersMockFns.mockIsFree
const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent

const userSubscription = {
  id: 'sub-db-1',
  plan: 'pro',
  referenceId: 'user-1',
  seats: 1,
  periodStart: new Date('2026-05-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-01T00:00:00.000Z'),
  stripeSubscriptionId: 'sub_stripe_1',
  status: 'active',
}

const expectedBillingPeriod = {
  start: new Date('2026-05-01T00:00:00.000Z'),
  end: new Date('2026-06-01T00:00:00.000Z'),
}

/** Queues the pre-transaction personal read: the subscription's Stripe customer row. */
function queuePersonalReads(customerId = 'cus_1') {
  queueTableRows(schemaMock.subscription, [{ stripeCustomerId: customerId }])
}

/** Builds the locked in-transaction user_stats row. */
function lockedStatsRow(overrides: Record<string, unknown> = {}) {
  return {
    billedOverageThisPeriod: '0',
    creditBalance: '0',
    ...overrides,
  }
}

/** Queues the locked user_stats read taken inside the settlement transaction. */
function queueLockedStats(row: Record<string, unknown>) {
  queueTableRows(schemaMock.userStats, [row])
}

const orgMemberUsageRow = {
  userId: 'owner-1',
  role: 'owner',
}

/**
 * Queues the organization settlement reads in table order: the pre-transaction
 * member join, then the locked owner row, owner stats, organization row, and
 * locked member join inside the transaction.
 */
function queueOrgReads({
  memberUsageRows = [orgMemberUsageRow],
  lockedOwnerRows = [{ userId: 'owner-1' }],
  ownerStatsRows = [{ billedOverageThisPeriod: '0' }],
  organizationRows = [{ creditBalance: '0' }],
  lockedMemberUsageRows = memberUsageRows,
}: {
  memberUsageRows?: unknown[]
  lockedOwnerRows?: unknown[]
  ownerStatsRows?: unknown[]
  organizationRows?: unknown[]
  lockedMemberUsageRows?: unknown[]
} = {}) {
  queueTableRows(schemaMock.member, memberUsageRows)
  queueTableRows(schemaMock.member, lockedOwnerRows)
  queueTableRows(schemaMock.userStats, ownerStatsRows)
  queueTableRows(schemaMock.organization, organizationRows)
  queueTableRows(schemaMock.member, lockedMemberUsageRows)
}

const usableOrgSubscription = {
  id: 'sub-db-team-1',
  plan: 'team',
  seats: 2,
  periodStart: new Date('2026-05-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-01T00:00:00.000Z'),
  stripeSubscriptionId: 'sub_team_1',
  stripeCustomerId: 'cus_team_1',
}

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    resetDbChainMock()

    mockGetHighestPrioritySubscription.mockResolvedValue(userSubscription)
    mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: false })
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(null)
    mockHasUsableSubscriptionAccess.mockReturnValue(true)
    mockIsFree.mockReturnValue(false)
    mockIsEnterprise.mockReturnValue(false)
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockGetBillingPeriodUsageCost.mockResolvedValue(0)
    mockIsSubscriptionCycleCloseCurrent.mockResolvedValue(true)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('does not lock user_stats when calculated overage is below threshold', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(99)

    await checkAndBillOverageThreshold('user-1')

    expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith({
      id: userSubscription.id,
      plan: userSubscription.plan,
      referenceId: userSubscription.referenceId,
      seats: userSubscription.seats,
      periodStart: userSubscription.periodStart,
      periodEnd: userSubscription.periodEnd,
    })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('wraps provider failures when strict settlement has no expected billing period', async () => {
    queuePersonalReads()
    mockCalculateSubscriptionOverage.mockRejectedValue(new Error('Overage lookup unavailable'))

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'provider_failure',
      retryable: true,
    })
  })

  it('requires reconciliation before calculating overage for an elapsed frozen period', async () => {
    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-04-01T00:00:00.000Z'),
          end: new Date('2026-05-01T00:00:00.000Z'),
        },
      })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'billing_period_elapsed',
      retryable: false,
    })

    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('enforces the expected billing period independently from strict retry handling', async () => {
    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        expectedBillingPeriod: {
          start: new Date('2026-04-01T00:00:00.000Z'),
          end: new Date('2026-05-01T00:00:00.000Z'),
        },
      })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'billing_period_elapsed',
      retryable: false,
    })
  })

  it('requires reconciliation for an elapsed organization period without charging it again', async () => {
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    await expect(
      checkAndBillPayerOverageThreshold(
        { type: 'organization', id: 'org-1' },
        {
          onError: 'throw',
          expectedBillingPeriod: {
            start: new Date('2026-03-01T00:00:00.000Z'),
            end: new Date('2026-04-01T00:00:00.000Z'),
          },
        }
      )
    ).rejects.toMatchObject({ code: 'billing_period_elapsed', retryable: false })
    expect(mockComputeOrgOverageAmount).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('fails retryably when an above-threshold modern settlement lacks payment state', async () => {
    queuePersonalReads()
    mockGetHighestPrioritySubscription.mockResolvedValue({
      ...userSubscription,
      stripeSubscriptionId: null,
    })
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'required_state_missing',
      retryable: true,
    })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('throws retryably for markerless strict settlement when payment state is missing', async () => {
    queuePersonalReads()
    mockGetHighestPrioritySubscription.mockResolvedValue({
      ...userSubscription,
      stripeSubscriptionId: null,
    })
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'required_state_missing',
      retryable: true,
    })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'no subscription',
      prepare: () => mockGetHighestPrioritySubscription.mockResolvedValue(null),
    },
    {
      name: 'billing ineligible',
      prepare: () => mockHasUsableSubscriptionAccess.mockReturnValue(false),
    },
    {
      name: 'plan ineligible',
      prepare: () => mockIsFree.mockReturnValue(true),
    },
    {
      name: 'below threshold',
      prepare: () => mockCalculateSubscriptionOverage.mockResolvedValue(99),
    },
    {
      name: 'already settled',
      prepare: () => {
        mockCalculateSubscriptionOverage.mockResolvedValue(250)
        queueLockedStats(lockedStatsRow({ billedOverageThisPeriod: '250' }))
      },
    },
  ])('keeps the $name terminal no-op successful in markerless strict mode', async ({ prepare }) => {
    queuePersonalReads()
    prepare()

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).resolves.toBeUndefined()
  })

  it('returns a distinct modern no-op when overage is below threshold', async () => {
    queuePersonalReads()
    mockCalculateSubscriptionOverage.mockResolvedValue(99)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'below-threshold' })
  })

  it('does not compare an Enterprise reporting window to Stripe before the ineligible no-op', async () => {
    mockIsEnterprise.mockReturnValue(true)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2025-08-13T00:00:00.000Z'),
          end: new Date('2026-08-13T00:00:00.000Z'),
        },
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'plan-ineligible' })

    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
  })

  it('requires organization subscription lookup failures to surface for modern settlement', async () => {
    mockGetOrganizationSubscriptionUsable.mockRejectedValue(
      new Error('Organization subscription lookup unavailable')
    )

    await expect(
      checkAndBillPayerOverageThreshold(
        { type: 'organization', id: 'org-1' },
        { onError: 'throw', expectedBillingPeriod }
      )
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'provider_failure',
      retryable: true,
    })
    expect(mockGetOrganizationSubscriptionUsable).toHaveBeenCalledWith('org-1', {
      onError: 'throw',
    })
  })

  it('calculates overage before opening the short user_stats transaction', async () => {
    queuePersonalReads()
    queueLockedStats(lockedStatsRow())
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await checkAndBillOverageThreshold('user-1')

    expect(mockCalculateSubscriptionOverage).toHaveBeenCalled()
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('emits audit and analytics once when a retry finds overage already settled', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    queuePersonalReads()
    queueLockedStats(lockedStatsRow())
    queuePersonalReads()
    queueLockedStats(lockedStatsRow({ billedOverageThisPeriod: '250' }))

    await checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    await checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })

    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('rechecks billed overage while locked before enqueueing an invoice', async () => {
    queuePersonalReads()
    queueLockedStats(lockedStatsRow({ billedOverageThisPeriod: '200' }))
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await checkAndBillOverageThreshold('user-1')

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('aborts settlement when the period advances between preflight and the locked transaction', async () => {
    queuePersonalReads()
    queueLockedStats(lockedStatsRow())
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    // Preflight passes; the under-lock revalidation sees the rollover.
    mockIsSubscriptionCycleCloseCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'concurrent_state_change',
      retryable: true,
    })

    expect(mockIsSubscriptionCycleCloseCurrent).toHaveBeenLastCalledWith(
      userSubscription.id,
      expect.objectContaining({ expectedPeriodStart: userSubscription.periodStart })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('defers personal settlement while the previous period cycle close is pending', async () => {
    mockIsSubscriptionCycleCloseCurrent.mockResolvedValue(false)
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'pending-cycle-close' })

    expect(mockIsSubscriptionCycleCloseCurrent).toHaveBeenCalledWith(userSubscription.id)
    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('defers organization settlement while the previous period cycle close is pending', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    mockIsSubscriptionCycleCloseCurrent.mockResolvedValue(false)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'pending-cycle-close' })

    expect(mockIsSubscriptionCycleCloseCurrent).toHaveBeenCalledWith(usableOrgSubscription.id)
    expect(mockComputeOrgOverageAmount).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('computes organization overage before opening the locked transaction', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    // Pooled entity read — departed members' org-stamped rows are already in.
    mockGetBillingPeriodUsageCost.mockResolvedValue(350)
    queueOrgReads()
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })

    await checkAndBillOverageThreshold('user-1')

    expect(mockComputeOrgOverageAmount).toHaveBeenCalledWith({
      plan: 'team',
      seats: 2,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      organizationId: userSubscription.referenceId,
      pooledLedgerUsage: 350,
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(mockComputeOrgOverageAmount.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('rechecks organization billed overage on the locked owner tracker', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    queueOrgReads({ ownerStatsRows: [{ billedOverageThisPeriod: '200' }] })
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })

    await checkAndBillOverageThreshold('user-1')

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('skips stale organization overage when owner identity changed', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    queueOrgReads({
      memberUsageRows: [orgMemberUsageRow, { userId: 'member-1', role: 'member' }],
      lockedOwnerRows: [{ userId: 'member-1' }],
      lockedMemberUsageRows: [
        { userId: 'owner-1', role: 'member' },
        { userId: 'member-1', role: 'owner' },
      ],
    })
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })

    await checkAndBillOverageThreshold('user-1')

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
