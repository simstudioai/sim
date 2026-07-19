/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateSubscriptionOverage,
  mockComputeOrgOverageAmount,
  mockDbSelect,
  mockDbTransaction,
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
  mockTxExecute,
  mockTxSelect,
  mockTxStatsLimit,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockCalculateSubscriptionOverage: vi.fn(),
  mockComputeOrgOverageAmount: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
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
  mockTxExecute: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTxStatsLimit: vi.fn(),
  mockTxUpdate: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { OVERAGE_BILLED: 'overage.billed' },
  AuditResourceType: { BILLING: 'billing' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    creditBalance: 'organization.creditBalance',
    departedMemberUsage: 'organization.departedMemberUsage',
    id: 'organization.id',
  },
  subscription: {
    id: 'subscription.id',
    stripeCustomerId: 'subscription.stripeCustomerId',
  },
  userStats: {
    billedOverageThisPeriod: 'userStats.billedOverageThisPeriod',
    creditBalance: 'userStats.creditBalance',
    currentPeriodCost: 'userStats.currentPeriodCost',
    lastPeriodCost: 'userStats.lastPeriodCost',
    proPeriodCostSnapshot: 'userStats.proPeriodCostSnapshot',
    proPeriodCostSnapshotAt: 'userStats.proPeriodCostSnapshotAt',
    userId: 'userStats.userId',
  },
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

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  envNumber: vi.fn((_value: string | undefined, fallback: number) => fallback),
  getEnv: vi.fn(() => undefined),
  isTruthy: (val: unknown) => val === true || val === 'true' || val === '1',
  isFalsy: (val: unknown) => val === false || val === 'false' || val === '0',
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

interface MockTx {
  execute: typeof mockTxExecute
  select: typeof mockTxSelect
  update: typeof mockTxUpdate
}

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

function buildSelectChain<T>(rows: T[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => result),
  }
  const result = {
    limit: vi.fn(async () => rows),
    then: (resolve: (value: T[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }

  return {
    from: chain.from,
  }
}

function buildPersonalSelectChain(customerId = 'cus_1') {
  return buildSelectChain([
    {
      currentPeriodCost: '0',
      proPeriodCostSnapshot: '0',
      proPeriodCostSnapshotAt: null,
      lastPeriodCost: '0',
      stripeCustomerId: customerId,
    },
  ])
}

function buildPersonalSnapshotSelectChain({
  currentPeriodCost = '0',
  proPeriodCostSnapshot = '0',
  proPeriodCostSnapshotAt = null,
  lastPeriodCost = '0',
}: {
  currentPeriodCost?: string
  proPeriodCostSnapshot?: string
  proPeriodCostSnapshotAt?: Date | null
  lastPeriodCost?: string
}) {
  return buildSelectChain([
    {
      currentPeriodCost,
      proPeriodCostSnapshot,
      proPeriodCostSnapshotAt,
      lastPeriodCost,
    },
  ])
}

function buildStatsSelectChain() {
  const result = {
    for: vi.fn(() => result),
    limit: mockTxStatsLimit,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(mockTxStatsLimit()).then(resolve, reject),
  }

  return {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => result),
        })),
      })),
      where: vi.fn(() => result),
    })),
  }
}

function buildUpdateChain() {
  return {
    set: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  }
}

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetHighestPrioritySubscription.mockResolvedValue(userSubscription)
    mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: false })
    mockGetOrganizationSubscriptionUsable.mockResolvedValue(null)
    mockHasUsableSubscriptionAccess.mockReturnValue(true)
    mockIsFree.mockReturnValue(false)
    mockIsEnterprise.mockReturnValue(false)
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockGetBillingPeriodUsageCost.mockResolvedValue(0)
    mockDbSelect.mockImplementation(() => buildPersonalSelectChain())
    mockTxSelect.mockImplementation(() => buildStatsSelectChain())
    mockTxUpdate.mockImplementation(() => buildUpdateChain())
    mockTxExecute.mockResolvedValue(undefined)
    mockDbTransaction.mockImplementation(async (callback: (tx: MockTx) => Promise<void>) =>
      callback({ execute: mockTxExecute, select: mockTxSelect, update: mockTxUpdate })
    )
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
    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('preserves best-effort error handling for existing callers', async () => {
    mockCalculateSubscriptionOverage.mockRejectedValue(new Error('Overage lookup unavailable'))

    await expect(checkAndBillOverageThreshold('user-1')).resolves.toBeUndefined()
  })

  it('wraps provider failures when strict settlement has no expected billing period', async () => {
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
    expect(mockDbTransaction).not.toHaveBeenCalled()
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

    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('throws retryably for markerless strict settlement when payment state is missing', async () => {
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

    expect(mockDbTransaction).not.toHaveBeenCalled()
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
        mockTxStatsLimit.mockResolvedValue([
          {
            currentPeriodCost: '0',
            proPeriodCostSnapshot: '0',
            proPeriodCostSnapshotAt: null,
            lastPeriodCost: '0',
            billedOverageThisPeriod: '250',
            creditBalance: '0',
          },
        ])
      },
    },
  ])('keeps the $name terminal no-op successful in markerless strict mode', async ({ prepare }) => {
    prepare()

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).resolves.toBeUndefined()
  })

  it('returns a distinct modern no-op when overage is below threshold', async () => {
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
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: expectedBillingPeriod.start,
      periodEnd: expectedBillingPeriod.end,
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
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
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: expectedBillingPeriod.start,
      periodEnd: expectedBillingPeriod.end,
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
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
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit.mockResolvedValue([
      {
        currentPeriodCost: '0',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
        lastPeriodCost: '0',
        billedOverageThisPeriod: '0',
        creditBalance: '0',
      },
    ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockCalculateSubscriptionOverage).toHaveBeenCalled()
    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbTransaction.mock.invocationCallOrder[0]
    )
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('emits audit and analytics once when a retry finds overage already settled', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit
      .mockResolvedValueOnce([
        {
          currentPeriodCost: '0',
          proPeriodCostSnapshot: '0',
          proPeriodCostSnapshotAt: null,
          lastPeriodCost: '0',
          billedOverageThisPeriod: '0',
          creditBalance: '0',
        },
      ])
      .mockResolvedValueOnce([
        {
          currentPeriodCost: '0',
          proPeriodCostSnapshot: '0',
          proPeriodCostSnapshotAt: null,
          lastPeriodCost: '0',
          billedOverageThisPeriod: '250',
          creditBalance: '0',
        },
      ])

    await checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    await checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })

    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('distinguishes an already-settled modern period without duplicating side effects', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit.mockResolvedValue([
      {
        currentPeriodCost: '0',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
        lastPeriodCost: '0',
        billedOverageThisPeriod: '250',
        creditBalance: '0',
      },
    ])

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
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit.mockResolvedValue([
      {
        currentPeriodCost: '0',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
        lastPeriodCost: '0',
        billedOverageThisPeriod: '200',
        creditBalance: '0',
      },
    ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('skips personal threshold billing when locked usage inputs changed', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockDbSelect
      .mockImplementationOnce(() => buildPersonalSnapshotSelectChain({ currentPeriodCost: '250' }))
      .mockImplementationOnce(() => buildPersonalSelectChain())
    mockTxStatsLimit.mockResolvedValue([
      {
        currentPeriodCost: '0',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
        lastPeriodCost: '250',
        billedOverageThisPeriod: '0',
        creditBalance: '0',
      },
    ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('throws retryably in markerless strict mode when locked personal usage changes', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockDbSelect
      .mockImplementationOnce(() => buildPersonalSnapshotSelectChain({ currentPeriodCost: '250' }))
      .mockImplementationOnce(() => buildPersonalSelectChain())
    mockTxStatsLimit.mockResolvedValue([
      {
        currentPeriodCost: '0',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
        lastPeriodCost: '250',
        billedOverageThisPeriod: '0',
        creditBalance: '0',
      },
    ])

    await expect(
      checkAndBillOverageThreshold('user-1', undefined, { onError: 'throw' })
    ).rejects.toMatchObject({
      name: ThresholdSettlementError.name,
      code: 'concurrent_state_change',
      retryable: true,
    })
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('wraps lock timeouts in markerless strict mode', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockDbTransaction.mockRejectedValueOnce(new Error('canceling statement due to lock timeout'))

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
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
    mockDbSelect.mockImplementationOnce(() =>
      buildSelectChain([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
      ])
    )
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })
    mockTxStatsLimit
      .mockResolvedValueOnce([{ userId: 'owner-1' }])
      .mockResolvedValueOnce([{ billedOverageThisPeriod: '0' }])
      .mockResolvedValueOnce([{ creditBalance: '0', departedMemberUsage: '25' }])
      .mockResolvedValueOnce([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
      ])

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
    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockComputeOrgOverageAmount.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbTransaction.mock.invocationCallOrder[0]
    )
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('skips stale organization overage when locked usage inputs changed', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
    mockDbSelect.mockImplementationOnce(() =>
      buildSelectChain([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
      ])
    )
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })
    mockTxStatsLimit
      .mockResolvedValueOnce([{ userId: 'owner-1' }])
      .mockResolvedValueOnce([{ billedOverageThisPeriod: '0' }])
      .mockResolvedValueOnce([{ creditBalance: '0', departedMemberUsage: '75' }])
      .mockResolvedValueOnce([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '75',
        },
      ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rechecks organization billed overage on the locked owner tracker', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
    mockDbSelect.mockImplementationOnce(() =>
      buildSelectChain([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
      ])
    )
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })
    mockTxStatsLimit
      .mockResolvedValueOnce([{ userId: 'owner-1' }])
      .mockResolvedValueOnce([{ billedOverageThisPeriod: '200' }])
      .mockResolvedValueOnce([{ creditBalance: '0', departedMemberUsage: '25' }])
      .mockResolvedValueOnce([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
      ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('skips stale organization overage when owner identity changed', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockGetOrganizationSubscriptionUsable.mockResolvedValue({
      plan: 'team',
      seats: 2,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      stripeSubscriptionId: 'sub_team_1',
      stripeCustomerId: 'cus_team_1',
    })
    mockDbSelect.mockImplementationOnce(() =>
      buildSelectChain([
        {
          userId: 'owner-1',
          role: 'owner',
          currentPeriodCost: '350',
          departedMemberUsage: '25',
        },
        {
          userId: 'member-1',
          role: 'member',
          currentPeriodCost: '25',
          departedMemberUsage: '25',
        },
      ])
    )
    mockComputeOrgOverageAmount.mockResolvedValue({
      totalOverage: 250,
      baseSubscriptionAmount: 100,
      effectiveUsage: 350,
    })
    mockTxStatsLimit
      .mockResolvedValueOnce([{ userId: 'member-1' }])
      .mockResolvedValueOnce([{ billedOverageThisPeriod: '0' }])
      .mockResolvedValueOnce([{ creditBalance: '0', departedMemberUsage: '25' }])
      .mockResolvedValueOnce([
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
      ])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })
})
