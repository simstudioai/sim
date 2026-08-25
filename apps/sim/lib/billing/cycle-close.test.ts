/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockComputeOrgOverageAmount,
  mockIsSubscriptionOrgScoped,
  mockGetStampedPeriodRangeUsageCostByUser,
  mockComputeDailyRefreshConsumed,
  mockEnqueueOutboxEvent,
  mockGetPlanPricing,
  mockGetPlanTierDollars,
  mockIsEnterprise,
  mockIsFree,
  mockRecordAudit,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockComputeOrgOverageAmount: vi.fn(),
  mockIsSubscriptionOrgScoped: vi.fn(),
  mockGetStampedPeriodRangeUsageCostByUser: vi.fn(),
  mockComputeDailyRefreshConsumed: vi.fn(),
  mockEnqueueOutboxEvent: vi.fn(),
  mockGetPlanPricing: vi.fn(),
  mockGetPlanTierDollars: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockIsFree: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { OVERAGE_BILLED: 'overage.billed' },
  AuditResourceType: { BILLING: 'billing' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  computeOrgOverageAmount: mockComputeOrgOverageAmount,
  isSubscriptionOrgScoped: mockIsSubscriptionOrgScoped,
}))

vi.mock('@/lib/billing/core/reporting-period', () => ({
  ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY: 'reportingPeriodAnchorDate',
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  COPILOT_USAGE_SOURCES: ['copilot'],
  getStampedPeriodRangeUsageCostByUser: mockGetStampedPeriodRangeUsageCostByUser,
}))

vi.mock('@/lib/billing/credits/daily-refresh', () => ({
  computeDailyRefreshConsumed: mockComputeDailyRefreshConsumed,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanTierDollars: mockGetPlanTierDollars,
  isEnterprise: mockIsEnterprise,
  isFree: mockIsFree,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'past_due'],
  getPlanPricing: mockGetPlanPricing,
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
  closeElapsedBillingPeriod,
  isSubscriptionCycleCloseCurrent,
  sweepBillingCycleCloses,
  writeFinalPeriodBookkeeping,
} from '@/lib/billing/cycle-close'

type SubInput = Parameters<typeof closeElapsedBillingPeriod>[0]

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z')
const PREV_PERIOD_START = new Date('2026-07-01T00:00:00.000Z')

function subRow(overrides: Partial<Record<string, unknown>> = {}): SubInput {
  return {
    id: 'sub-1',
    plan: 'team',
    referenceId: 'org-1',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_stripe_1',
    status: 'active',
    periodStart: PERIOD_START,
    periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    billingInterval: 'month',
    metadata: null,
    lastClosedPeriodStart: PREV_PERIOD_START,
    ...overrides,
  } as SubInput
}

/**
 * Queues the org close's reads in table order: member roster, in-tx member
 * userStats lock, organization credit row, subscription marker re-read, the
 * under-lock roster revalidation, and the tracker userStats row.
 */
function queueOrgCloseReads({
  members = [{ userId: 'owner-1', role: 'owner' }],
  orgRow = { creditBalance: '0' },
  markerRow = { lastClosedPeriodStart: PREV_PERIOD_START },
  lockedRoster = members,
  trackerRow = { billedOverageThisPeriod: '0', creditBalance: '0' },
}: {
  members?: { userId: string; role: string }[]
  orgRow?: Record<string, unknown>
  markerRow?: Record<string, unknown>
  lockedRoster?: { userId: string; role: string }[]
  trackerRow?: Record<string, unknown>
} = {}) {
  queueTableRows(schemaMock.member, members)
  queueTableRows(schemaMock.userStats, [])
  queueTableRows(schemaMock.organization, [orgRow])
  queueTableRows(schemaMock.subscription, [markerRow])
  queueTableRows(schemaMock.member, lockedRoster)
  queueTableRows(schemaMock.userStats, [trackerRow])
}

describe('closeElapsedBillingPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsSubscriptionOrgScoped.mockResolvedValue(true)
    mockIsEnterprise.mockReturnValue(false)
    mockIsFree.mockReturnValue(false)
    mockGetPlanTierDollars.mockReturnValue(40)
    mockGetPlanPricing.mockReturnValue({ basePrice: 40 })
    mockComputeDailyRefreshConsumed.mockResolvedValue(0)
    mockGetStampedPeriodRangeUsageCostByUser.mockResolvedValue(new Map([['owner-1', 150]]))
    mockComputeOrgOverageAmount.mockResolvedValue({
      effectiveUsage: 150,
      baseSubscriptionAmount: 80,
      dailyRefreshDeduction: 0,
      totalOverage: 70,
    })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'sub-1' }])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('initializes a null marker without billing', async () => {
    const result = await closeElapsedBillingPeriod(subRow({ lastClosedPeriodStart: null }))

    expect(result.status).toBe('initialized')
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockGetStampedPeriodRangeUsageCostByUser).not.toHaveBeenCalled()
  })

  it('returns current when the marker already matches the period start', async () => {
    const result = await closeElapsedBillingPeriod(subRow({ lastClosedPeriodStart: PERIOD_START }))

    expect(result.status).toBe('current')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('closes a team period: bills the remainder, resets trackers, and claims the marker', async () => {
    queueOrgCloseReads()

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('closed')
    expect(result.overageBilled).toBe(70)

    expect(mockComputeOrgOverageAmount).toHaveBeenCalledWith({
      plan: 'team',
      seats: null,
      periodStart: PREV_PERIOD_START,
      periodEnd: PERIOD_START,
      organizationId: 'org-1',
      pooledLedgerUsage: 150,
      memberIds: ['owner-1'],
    })

    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
    const [, eventType, payload] = mockEnqueueOutboxEvent.mock.calls[0]
    expect(eventType).toBe('stripe.threshold-overage-invoice')
    expect(payload).toMatchObject({
      customerId: 'cus_1',
      stripeSubscriptionId: 'sub_stripe_1',
      amountCents: 7000,
      invoiceIdemKeyStem: `cycle-close-overage:sub-1:${PERIOD_START.toISOString()}:invoice`,
      metadata: expect.objectContaining({ type: 'overage_billing', organizationId: 'org-1' }),
    })

    // Bookkeeping: last-period CASE write + billedOverage reset on member rows.
    const bookkeepingSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).billedOverageThisPeriod === '0'
    )?.[0] as Record<string, unknown>
    expect(bookkeepingSet).toBeDefined()
    expect(
      (bookkeepingSet.lastPeriodCost as { toSQL?: () => { sql: string } })?.toSQL?.().sql
    ).toContain('CASE')

    // Marker claim committed in the same transaction.
    const markerSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).lastClosedPeriodStart instanceof Date
    )
    expect(markerSet).toBeDefined()
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('defers the close inside the settlement grace after a rollover', async () => {
    // A run whose frozen attribution predates the rollover could still insert
    // elapsed-period rows; the close waits until sums are final.
    const result = await closeElapsedBillingPeriod(
      subRow({
        periodStart: new Date(Date.now() - 60_000),
        lastClosedPeriodStart: new Date(Date.now() - 60_000 - 31 * 24 * 60 * 60 * 1000),
      })
    )

    expect(result.status).toBe('skipped')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockGetStampedPeriodRangeUsageCostByUser).not.toHaveBeenCalled()
  })

  it('defers the close when overage is due but Stripe identifiers are missing', async () => {
    const result = await closeElapsedBillingPeriod(subRow({ stripeCustomerId: null }))

    expect(result.status).toBe('skipped')
    // No marker claim, no money, no bookkeeping — the sweep retries next run.
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('derives the closed window from the ledger period stamps when they drift from calendar math', async () => {
    // Rows for the elapsed period are stamped starting Jul 3 (anchor drift)
    // while the marker sits at Jul 1: only the stamp lookup can produce the
    // Jul 3 bound — calendar math (periodStart minus one interval) would keep
    // the window at Jul 1.
    const stampedPrevStart = new Date('2026-07-03T00:00:00.000Z')
    queueTableRows(schemaMock.usageLog, [{ start: stampedPrevStart }])
    queueOrgCloseReads()

    await closeElapsedBillingPeriod(subRow({ lastClosedPeriodStart: PREV_PERIOD_START }))

    expect(mockComputeOrgOverageAmount).toHaveBeenCalledWith(
      expect.objectContaining({ periodStart: stampedPrevStart, periodEnd: PERIOD_START })
    )
  })

  it('defers the close when overage is due but the organization has no owner', async () => {
    mockGetStampedPeriodRangeUsageCostByUser.mockResolvedValue(new Map([['departed-1', 150]]))
    // Member roster has no owner-role row.
    queueTableRows(schemaMock.member, [{ userId: 'member-1', role: 'member' }])

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('skipped')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('includes departed members with billed ledger usage in the refresh actor set', async () => {
    // 'departed-1' has org-attributed rows in the closed period but no member
    // row anymore; their refresh consumption must still offset the overage.
    mockGetStampedPeriodRangeUsageCostByUser.mockResolvedValue(
      new Map([
        ['owner-1', 100],
        ['departed-1', 50],
      ])
    )
    queueOrgCloseReads()

    await closeElapsedBillingPeriod(subRow())

    expect(mockComputeOrgOverageAmount).toHaveBeenCalledWith(
      expect.objectContaining({
        pooledLedgerUsage: 150,
        memberIds: ['owner-1', 'departed-1'],
      })
    )
  })

  it('applies organization credits before invoicing and skips Stripe when covered', async () => {
    queueOrgCloseReads({ orgRow: { creditBalance: '100' } })

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('closed')
    expect(result.creditsApplied).toBe(70)
    expect(result.overageBilled).toBe(0)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
  })

  it('subtracts overage already collected by threshold billing', async () => {
    queueOrgCloseReads({ trackerRow: { billedOverageThisPeriod: '70', creditBalance: '0' } })

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('closed')
    expect(result.overageBilled).toBe(0)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('defers when the organization roster changed between preflight and the locked transaction', async () => {
    queueOrgCloseReads({
      lockedRoster: [
        { userId: 'owner-1', role: 'member' },
        { userId: 'member-2', role: 'owner' },
      ],
    })

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('skipped')
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('no-ops when a concurrent closer already advanced the marker', async () => {
    queueOrgCloseReads({ markerRow: { lastClosedPeriodStart: PERIOD_START } })

    const result = await closeElapsedBillingPeriod(subRow())

    expect(result.status).toBe('already-closed')
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('books enterprise periods without collecting money', async () => {
    mockIsEnterprise.mockReturnValue(true)
    queueOrgCloseReads()

    const result = await closeElapsedBillingPeriod(subRow({ plan: 'enterprise' }))

    expect(result.status).toBe('closed')
    expect(result.overageBilled).toBe(0)
    expect(mockComputeOrgOverageAmount).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    // Bookkeeping still writes last-period sums.
    const bookkeepingSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).billedOverageThisPeriod === '0'
    )
    expect(bookkeepingSet).toBeDefined()
  })

  it('only advances the marker for enterprise orgs on reporting anchors', async () => {
    mockIsEnterprise.mockReturnValue(true)

    const result = await closeElapsedBillingPeriod(
      subRow({ plan: 'enterprise', metadata: { reportingPeriodAnchorDate: '2026-05-01' } })
    )

    expect(result.status).toBe('closed')
    expect(mockGetStampedPeriodRangeUsageCostByUser).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('closes a personal subscription against the user ledger', async () => {
    mockIsSubscriptionOrgScoped.mockResolvedValue(false)
    mockGetStampedPeriodRangeUsageCostByUser.mockResolvedValue(new Map([['user-1', 90]]))
    // Personal reads: in-tx userStats lock, marker re-read, tracker row.
    queueTableRows(schemaMock.userStats, [])
    queueTableRows(schemaMock.subscription, [{ lastClosedPeriodStart: PREV_PERIOD_START }])
    queueTableRows(schemaMock.userStats, [{ billedOverageThisPeriod: '0', creditBalance: '0' }])

    const result = await closeElapsedBillingPeriod(
      subRow({ plan: 'pro', referenceId: 'user-1', stripeCustomerId: 'cus_user' })
    )

    expect(result.status).toBe('closed')
    // 90 ledger - 0 refresh - 40 base = 50 overage
    expect(result.overageBilled).toBe(50)
    expect(mockComputeOrgOverageAmount).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })
})

describe('writeFinalPeriodBookkeeping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsSubscriptionOrgScoped.mockResolvedValue(true)
    mockIsEnterprise.mockReturnValue(false)
    mockGetStampedPeriodRangeUsageCostByUser.mockResolvedValue(new Map([['owner-1', 25]]))
    dbChainMockFns.returning.mockResolvedValue([{ id: 'sub-1' }])
  })

  it('resets trackers, writes last-period sums, and claims the terminal marker in one transaction', async () => {
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])

    await writeFinalPeriodBookkeeping({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'org-1',
      periodStart: PERIOD_START,
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    const bookkeepingSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).billedOverageThisPeriod === '0'
    )
    expect(bookkeepingSet).toBeDefined()
    const markerSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).lastClosedPeriodStart instanceof Date
    )
    expect(markerSet).toBeDefined()
  })

  it('only claims the marker for reporting-anchor enterprise subscriptions', async () => {
    mockIsEnterprise.mockReturnValue(true)

    await writeFinalPeriodBookkeeping({
      id: 'sub-1',
      plan: 'enterprise',
      referenceId: 'org-1',
      periodStart: PERIOD_START,
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      metadata: { reportingPeriodAnchorDate: '2026-05-01' },
    })

    expect(mockGetStampedPeriodRangeUsageCostByUser).not.toHaveBeenCalled()
    const markerSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).lastClosedPeriodStart instanceof Date
    )
    expect(markerSet).toBeDefined()
    const bookkeepingSet = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).billedOverageThisPeriod === '0'
    )
    expect(bookkeepingSet).toBeUndefined()
  })
})

describe('isSubscriptionCycleCloseCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('is current when the marker has caught up to the period start', async () => {
    queueTableRows(schemaMock.subscription, [
      { periodStart: PERIOD_START, lastClosedPeriodStart: PERIOD_START },
    ])
    await expect(isSubscriptionCycleCloseCurrent('sub-1')).resolves.toBe(true)
  })

  it('is pending when the marker lags the period start or was never initialized', async () => {
    queueTableRows(schemaMock.subscription, [
      { periodStart: PERIOD_START, lastClosedPeriodStart: PREV_PERIOD_START },
    ])
    await expect(isSubscriptionCycleCloseCurrent('sub-1')).resolves.toBe(false)

    queueTableRows(schemaMock.subscription, [
      { periodStart: PERIOD_START, lastClosedPeriodStart: null },
    ])
    await expect(isSubscriptionCycleCloseCurrent('sub-1')).resolves.toBe(false)
  })

  it('is current when the subscription has no period to close', async () => {
    queueTableRows(schemaMock.subscription, [{ periodStart: null, lastClosedPeriodStart: null }])
    await expect(isSubscriptionCycleCloseCurrent('sub-1')).resolves.toBe(true)
  })
})

describe('sweepBillingCycleCloses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFree.mockReturnValue(false)
    mockIsEnterprise.mockReturnValue(false)
  })

  it('initializes every candidate with a lagging marker', async () => {
    // Both rows are shaped like rows the sweep's candidate query can actually
    // return: entitled, non-null periodStart, marker lagging (null).
    queueTableRows(schemaMock.subscription, [
      subRow({ id: 'sub-a', lastClosedPeriodStart: null }),
      subRow({ id: 'sub-b', lastClosedPeriodStart: null }),
    ])

    const summary = await sweepBillingCycleCloses()

    expect(summary.candidates).toBe(2)
    expect(summary.initialized).toBe(2)
    expect(summary.failed).toBe(0)
  })
})
