/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateSubscriptionOverage,
  mockComputeOrgOverageAmount,
  mockEnqueueOutboxEvent,
  mockGetEffectiveBillingStatus,
  mockGetHighestPrioritySubscription,
  mockGetBillingPeriodUsageCost,
  mockGetOrganizationSubscriptionUsable,
  mockHasUsableSubscriptionAccess,
  mockIsEnterprise,
  mockIsFree,
  mockIsOrgScopedSubscription,
  mockIsOrganizationBillingBlocked,
  mockRecordAudit,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockCalculateSubscriptionOverage: vi.fn(),
  mockComputeOrgOverageAmount: vi.fn(),
  mockEnqueueOutboxEvent: vi.fn(),
  mockGetEffectiveBillingStatus: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetBillingPeriodUsageCost: vi.fn(),
  mockGetOrganizationSubscriptionUsable: vi.fn(),
  mockHasUsableSubscriptionAccess: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockIsFree: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { OVERAGE_BILLED: 'overage.billed' },
  AuditResourceType: { BILLING: 'billing' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: mockGetEffectiveBillingStatus,
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: mockCalculateSubscriptionOverage,
  computeOrgOverageAmount: mockComputeOrgOverageAmount,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
  getOrganizationSubscriptionUsable: mockGetOrganizationSubscriptionUsable,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: mockGetBillingPeriodUsageCost,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: mockIsEnterprise,
  isFree: mockIsFree,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  hasUsableSubscriptionAccess: mockHasUsableSubscriptionAccess,
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  },
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
  ThresholdSettlementError,
} from '@/lib/billing/threshold-billing'

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

const defaultUsageSnapshotRow = {
  currentPeriodCost: '0',
  proPeriodCostSnapshot: '0',
  proPeriodCostSnapshotAt: null as Date | null,
  lastPeriodCost: '0',
}

/**
 * Queues the two pre-transaction personal reads: the user_stats usage snapshot
 * and the subscription's Stripe customer row.
 */
function queuePersonalReads(
  snapshot: Record<string, unknown> = defaultUsageSnapshotRow,
  customerId = 'cus_1'
) {
  queueTableRows(schemaMock.userStats, [snapshot])
  queueTableRows(schemaMock.subscription, [{ stripeCustomerId: customerId }])
}

/** Builds the locked in-transaction user_stats row. */
function lockedStatsRow(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultUsageSnapshotRow,
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
  currentPeriodCost: '350',
  departedMemberUsage: '25',
}

/**
 * Queues the organization settlement reads in table order: the pre-transaction
 * member usage join, then the locked owner row, owner stats, organization row,
 * and locked member usage join inside the transaction.
 */
function queueOrgReads({
  memberUsageRows = [orgMemberUsageRow],
  lockedOwnerRows = [{ userId: 'owner-1' }],
  ownerStatsRows = [{ billedOverageThisPeriod: '0' }],
  organizationRows = [{ creditBalance: '0', departedMemberUsage: '25' }],
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
  plan: 'team',
  seats: 2,
  periodStart: new Date('2026-05-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-01T00:00:00.000Z'),
  stripeSubscriptionId: 'sub_team_1',
  stripeCustomerId: 'cus_team_1',
}

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    mockGetHighestPrioritySubscription.mockResolvedValue(userSubscription)
    mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: false })
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(null)
    mockHasUsableSubscriptionAccess.mockReturnValue(true)
    mockIsFree.mockReturnValue(false)
    mockIsEnterprise.mockReturnValue(false)
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockGetBillingPeriodUsageCost.mockResolvedValue(0)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('does not lock user_stats when calculated overage is below threshold', async () => {
    queuePersonalReads()
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
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('preserves best-effort error handling for existing callers', async () => {
    queuePersonalReads()
    mockCalculateSubscriptionOverage.mockRejectedValue(new Error('Overage lookup unavailable'))

    await expect(checkAndBillOverageThreshold('user-1')).resolves.toBeUndefined()
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

  it('wraps provider failures as retryable errors for a frozen modern period', async () => {
    queuePersonalReads()
    mockCalculateSubscriptionOverage.mockRejectedValue(new Error('Overage lookup unavailable'))

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'provider_failure',
      retryable: true,
    })
  })

  it('fails before calculating overage when the frozen period is no longer current', async () => {
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
      code: 'billing_period_mismatch',
      retryable: true,
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
      code: 'billing_period_mismatch',
      retryable: true,
    })
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

  it('returns a distinct modern no-op when the plan cannot accrue overage', async () => {
    mockIsFree.mockReturnValue(true)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'plan-ineligible' })

    expect(mockCalculateSubscriptionOverage).not.toHaveBeenCalled()
  })

  it('wraps organization provider failures through the strict payer helper', async () => {
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    mockIsOrganizationBillingBlocked.mockRejectedValue(new Error('Organization lookup unavailable'))

    await expect(
      checkAndBillPayerOverageThreshold({ type: 'organization', id: 'org-1' }, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'provider_failure',
      retryable: true,
    })
    expect(mockGetOrganizationSubscriptionUsable).toHaveBeenCalledWith('org-1', {
      onError: 'throw',
    })
  })

  it('keeps billing-blocked organizations as terminal no-ops in markerless strict mode', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).resolves.toBeUndefined()
    expect(mockComputeOrgOverageAmount).not.toHaveBeenCalled()
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

  it('distinguishes an already-settled modern period without duplicating side effects', async () => {
    queuePersonalReads()
    queueLockedStats(lockedStatsRow({ billedOverageThisPeriod: '250' }))
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, {
        onError: 'throw',
        expectedBillingPeriod,
      })
    ).resolves.toEqual({ status: 'no-op', reason: 'already-settled' })

    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
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

  it('skips personal threshold billing when locked usage inputs changed', async () => {
    queuePersonalReads({ ...defaultUsageSnapshotRow, currentPeriodCost: '250' })
    queueLockedStats(lockedStatsRow({ lastPeriodCost: '250' }))
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await checkAndBillOverageThreshold('user-1')

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('throws retryably in markerless strict mode when locked personal usage changes', async () => {
    queuePersonalReads({ ...defaultUsageSnapshotRow, currentPeriodCost: '250' })
    queueLockedStats(lockedStatsRow({ lastPeriodCost: '250' }))
    mockCalculateSubscriptionOverage.mockResolvedValue(250)

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'concurrent_state_change',
      retryable: true,
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('wraps lock timeouts in markerless strict mode', async () => {
    queuePersonalReads()
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    dbChainMockFns.transaction.mockRejectedValueOnce(
      new Error('canceling statement due to lock timeout')
    )

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'provider_failure',
      retryable: true,
    })
  })

  it('computes organization overage before opening the locked transaction', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
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
      pooledCurrentPeriodCost: 350,
      departedMemberUsage: 25,
      memberIds: ['owner-1'],
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(mockComputeOrgOverageAmount.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('skips stale organization overage when locked usage inputs changed', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(usableOrgSubscription)
    queueOrgReads({
      organizationRows: [{ creditBalance: '0', departedMemberUsage: '75' }],
      lockedMemberUsageRows: [{ ...orgMemberUsageRow, departedMemberUsage: '75' }],
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
      memberUsageRows: [
        orgMemberUsageRow,
        {
          userId: 'member-1',
          role: 'member',
          currentPeriodCost: '25',
          departedMemberUsage: '25',
        },
      ],
      lockedOwnerRows: [{ userId: 'member-1' }],
      lockedMemberUsageRows: [
        {
          userId: 'owner-1',
          role: 'member',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
        {
          userId: 'member-1',
          role: 'owner',
          currentPeriodCost: '25',
          departedMemberUsage: '25',
        },
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
