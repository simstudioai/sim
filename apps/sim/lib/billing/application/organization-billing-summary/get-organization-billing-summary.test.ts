import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import { billingSubscriptionMock } from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingSubscriptionUtilsMock,
  billingSubscriptionUtilsMockFns,
} from '@sim/testing/mocks/billing-subscription-utils.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
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
    primaryRows,
    selectedPrimaryTables,
    primaryDb,
    replicaDb,
    getOrganizationBillingBlockState: vi.fn(),
    getUpgradeWorkspaceId: vi.fn(),
    resolveSubscriptionUsagePeriodOrDefault: vi.fn(),
    computeWeeklyRefreshConsumed: vi.fn(),
  }
})

vi.mock('@sim/db', () => ({
  db: hoisted.primaryDb,
  dbReplica: hoisted.replicaDb,
}))

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/payer-context', () => ({
  getOrganizationBillingBlockState: hoisted.getOrganizationBillingBlockState,
  getUpgradeWorkspaceId: hoisted.getUpgradeWorkspaceId,
}))

vi.mock('@/lib/billing/core/reporting-period', () => ({
  resolveSubscriptionUsagePeriodOrDefault: hoisted.resolveSubscriptionUsagePeriodOrDefault,
}))

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeWeeklyRefreshConsumed: hoisted.computeWeeklyRefreshConsumed,
}))

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

vi.mock('@/lib/billing/utils/decimal', () => ({
  toDecimal: vi.fn((value: string | number | null | undefined) => Number(value ?? 0)),
  toNumber: vi.fn((value: number) => value),
}))

import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary'

const mocks = {
  ...hoisted,
  getOrganizationSubscription: billingCoreMockFns.mockGetOrganizationSubscription,
  getBillingPeriodUsageCost: billingUsageLogMockFns.mockGetBillingPeriodUsageCost,
}
billingCoreMockFns.mockGetPlanPricing.mockReturnValue({ basePrice: 20 } as never)
billingPlanHelpersMockFns.mockGetPlanWeeklyRefreshDollars.mockReturnValue(10)
billingPlanHelpersMockFns.mockIsEnterprise.mockReturnValue(false)
billingPlanHelpersMockFns.mockIsPaid.mockImplementation(
  (plan: string | null | undefined) => plan !== 'free'
)
billingSubscriptionUtilsMockFns.mockGetEffectiveSeats.mockReturnValue(2)

const tables = {
  member: schemaMock.member,
  organization: schemaMock.organization,
  subscription: schemaMock.subscription,
}
const session = createSessionPrincipal()

describe('organization billing summary query routing', () => {
  beforeEach(() => {
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

    mocks.primaryRows.set(tables.member, [{ role: 'owner' }])
    mocks.primaryRows.set(tables.organization, [
      { id: 'org-1', orgUsageLimit: null, creditBalance: '3' },
    ])
    mocks.primaryRows.set(tables.subscription, [subscription])
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
      tables.member,
      tables.organization,
      tables.subscription,
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
