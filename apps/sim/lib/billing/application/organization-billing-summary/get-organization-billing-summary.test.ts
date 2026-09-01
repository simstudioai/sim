/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tables = {
    member: { name: 'member' },
    organization: { name: 'organization' },
    subscription: { name: 'subscription' },
  }
  const primaryRows = new Map<object, unknown[]>()
  const selectedPrimaryTables: object[] = []

  const primaryDb = {
    select: vi.fn(() => {
      let selectedTable: object
      const query = {
        from: vi.fn((table: object) => {
          selectedTable = table
          selectedPrimaryTables.push(table)
          return query
        }),
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(async () => primaryRows.get(selectedTable) ?? []),
      }
      return query
    }),
  }
  const replicaDb = {
    select: vi.fn(() => {
      throw new Error('Canonical billing state must not be read from the replica')
    }),
  }

  return {
    tables,
    primaryRows,
    selectedPrimaryTables,
    primaryDb,
    replicaDb,
    getOrganizationSubscription: vi.fn(),
    getOrganizationBillingBlockState: vi.fn(),
    getUpgradeWorkspaceId: vi.fn(),
    resolveSubscriptionUsagePeriodOrDefault: vi.fn(),
    getBillingPeriodUsageCost: vi.fn(),
    computeWeeklyRefreshConsumed: vi.fn(),
  }
})

vi.mock('@sim/db', () => ({
  db: mocks.primaryDb,
  dbReplica: mocks.replicaDb,
}))

vi.mock('@sim/db/schema', () => ({
  member: mocks.tables.member,
  organization: mocks.tables.organization,
  subscription: mocks.tables.subscription,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mocks.getOrganizationSubscription,
  getPlanPricing: vi.fn(() => ({ basePrice: 20 })),
}))

vi.mock('@/lib/billing/core/payer-context', () => ({
  getOrganizationBillingBlockState: mocks.getOrganizationBillingBlockState,
  getUpgradeWorkspaceId: mocks.getUpgradeWorkspaceId,
}))

vi.mock('@/lib/billing/core/reporting-period', () => ({
  resolveSubscriptionUsagePeriodOrDefault: mocks.resolveSubscriptionUsagePeriodOrDefault,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  resolveBillingInterval: vi.fn(() => 'month'),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: mocks.getBillingPeriodUsageCost,
}))

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeWeeklyRefreshConsumed: mocks.computeWeeklyRefreshConsumed,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanWeeklyRefreshDollars: vi.fn(() => 10),
  isEnterprise: vi.fn(() => false),
  isPaid: vi.fn((plan: string | null | undefined) => plan !== 'free'),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  getEffectiveSeats: vi.fn(() => 2),
}))

vi.mock('@/lib/billing/utils/decimal', () => ({
  toDecimal: vi.fn((value: string | number | null | undefined) => Number(value ?? 0)),
  toNumber: vi.fn((value: number) => value),
}))

import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary'

const session: SessionPrincipal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}

describe('organization billing summary query routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.primaryRows.clear()
    mocks.selectedPrimaryTables.length = 0

    const periodStart = new Date('2026-08-01T00:00:00.000Z')
    const periodEnd = new Date('2026-09-01T00:00:00.000Z')
    const subscription = {
      id: 'sub-1',
      referenceId: 'org-1',
      plan: 'team',
      status: 'active',
      seats: 2,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: false,
    }

    mocks.primaryRows.set(mocks.tables.member, [{ role: 'owner' }])
    mocks.primaryRows.set(mocks.tables.organization, [
      { id: 'org-1', orgUsageLimit: null, creditBalance: '3' },
    ])
    mocks.primaryRows.set(mocks.tables.subscription, [subscription])
    mocks.getOrganizationSubscription.mockResolvedValue(subscription)
    mocks.resolveSubscriptionUsagePeriodOrDefault.mockReturnValue({
      start: periodStart,
      end: periodEnd,
    })
    mocks.getOrganizationBillingBlockState.mockResolvedValue({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
    mocks.getUpgradeWorkspaceId.mockResolvedValue('workspace-1')
    mocks.getBillingPeriodUsageCost.mockResolvedValue(25)
    mocks.computeWeeklyRefreshConsumed.mockResolvedValue(5)
  })

  it('uses primary state for payer decisions and the replica only for usage aggregates', async () => {
    await expect(
      getOrganizationBillingSummary.execute({
        principal: session,
        input: { organizationId: 'org-1' },
      })
    ).resolves.toMatchObject({
      organizationId: 'org-1',
      subscriptionPlan: 'team',
      totalCurrentUsage: 20,
      upgradeWorkspaceId: 'workspace-1',
    })

    expect(mocks.selectedPrimaryTables).toEqual([
      mocks.tables.member,
      mocks.tables.organization,
      mocks.tables.subscription,
    ])
    expect(mocks.replicaDb.select).not.toHaveBeenCalled()
    expect(mocks.getOrganizationSubscription).toHaveBeenCalledWith('org-1', {
      executor: mocks.primaryDb,
      onError: 'throw',
    })
    expect(mocks.getOrganizationBillingBlockState).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      mocks.primaryDb
    )
    expect(mocks.getUpgradeWorkspaceId).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      mocks.primaryDb
    )
    expect(mocks.getBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      expect.any(Object),
      undefined,
      mocks.replicaDb
    )
    expect(mocks.computeWeeklyRefreshConsumed).toHaveBeenCalledWith(
      expect.objectContaining({
        billingEntity: { type: 'organization', id: 'org-1' },
      }),
      mocks.replicaDb
    )
  })
})
