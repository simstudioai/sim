import { usageLog } from '@sim/db/schema'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  dbChainMockFns,
  drizzleOrmMock,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing/mocks/database.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageForCurrentPeriod,
} from '@/lib/billing/organizations/member-limits'

const mockGetOrganizationSubscription = billingCoreMockFns.mockGetOrganizationSubscription
const { eq: mockEq, gte: mockGte, isNull: mockIsNull, lt: mockLt, or: mockOr } = drizzleOrmMock

beforeEach(() => {
  resetDbChainMock()
})

afterAll(() => {
  resetDbChainMock()
})

describe('getOrgMemberUsageForBillingPeriod', () => {
  it('counts immutable new rows plus bounded legacy rows exactly once', async () => {
    const billingPeriod = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
    }
    queueTableRows(usageLog, [{ cost: '4.5' }])
    mockGetOrganizationSubscription.mockResolvedValue({
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(
      getOrgMemberUsageForBillingPeriod('snapshot-org', 'actor-2', billingPeriod)
    ).resolves.toBe(4.5)

    /** The member sum is a ledger aggregate: it runs inside the bounded ledger transaction. */
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(
      dbChainMockFns.execute.mock.calls.some(([statement]) =>
        String((statement as { toSQL?: () => { sql: string } }).toSQL?.().sql).includes(
          `SET LOCAL statement_timeout = '${USAGE_LEDGER_STATEMENT_TIMEOUT_MS}ms'`
        )
      )
    ).toBe(true)

    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityType', 'organization')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityId', 'snapshot-org')
    expect(mockEq).toHaveBeenCalledWith('usageLog.userId', 'actor-2')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', billingPeriod.start)
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodEnd', billingPeriod.end)
    expect(mockEq).toHaveBeenCalledWith('workspace.organizationId', 'snapshot-org')
    expect(mockIsNull).toHaveBeenCalledWith('usageLog.billingEntityType')
    expect(mockIsNull).toHaveBeenCalledWith('usageLog.billingEntityId')
    expect(mockIsNull).toHaveBeenCalledWith('workspace.organizationAssignedAt')
    expect(mockGte).toHaveBeenCalledWith('usageLog.createdAt', 'workspace.organizationAssignedAt')
    expect(mockGte).toHaveBeenCalledWith('usageLog.createdAt', billingPeriod.start)
    expect(mockLt).toHaveBeenCalledWith('usageLog.createdAt', billingPeriod.end)
    expect(dbChainMockFns.leftJoin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace.id' }),
      expect.anything()
    )

    const mixedHistoryCall = mockOr.mock.calls.find(
      (conditions) =>
        conditions.length === 2 &&
        conditions.every(
          (condition) =>
            typeof condition === 'object' &&
            condition !== null &&
            'type' in condition &&
            condition.type === 'and'
        )
    )
    expect(mixedHistoryCall).toBeDefined()
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it('uses only immutable same-organization ledger rows for a custom reporting window', async () => {
    const billingPeriod = {
      start: new Date('2025-08-13T00:00:00.000Z'),
      end: new Date('2026-08-13T00:00:00.000Z'),
      source: 'reporting' as const,
    }
    queueTableRows(usageLog, [{ cost: '18.25' }])

    await expect(
      getOrgMemberUsageForBillingPeriod('contract-org', 'actor-2', billingPeriod)
    ).resolves.toBe(18.25)

    expect(mockEq).toHaveBeenCalledWith('usageLog.userId', 'actor-2')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityType', 'organization')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityId', 'contract-org')
    expect(mockGte).toHaveBeenCalledWith('usageLog.createdAt', billingPeriod.start)
    expect(mockLt).toHaveBeenCalledWith('usageLog.createdAt', billingPeriod.end)
    expect(mockEq).not.toHaveBeenCalledWith('workspace.organizationId', 'contract-org')
    expect(mockIsNull).not.toHaveBeenCalledWith('usageLog.billingEntityType')
  })
})

describe('getOrgMemberUsageForCurrentPeriod', () => {
  it('reads the enforcement usage definition over the org subscription window', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    mockGetOrganizationSubscription.mockResolvedValue({ periodStart, periodEnd })
    queueTableRows(usageLog, [{ cost: '5' }])

    const result = await getOrgMemberUsageForCurrentPeriod('org-1', 'user-2')

    expect(result).toBe(5)
    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-1')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityId', 'org-1')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', periodStart)
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodEnd', periodEnd)
  })

  it('falls back to the all-time window when the org has no subscription period', async () => {
    queueTableRows(usageLog, [{ cost: '7' }])

    const result = await getOrgMemberUsageForCurrentPeriod('org-1', 'user-2', null)

    expect(result).toBe(7)
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', defaultBillingPeriod().start)
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodEnd', defaultBillingPeriod().end)
  })
})
