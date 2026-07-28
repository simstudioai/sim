/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  schemaTables,
  mockAnd,
  mockEq,
  mockGte,
  mockIsNull,
  mockLt,
  mockOr,
  mockGetOrganizationSubscription,
} = vi.hoisted(() => ({
  schemaTables: {
    organizationMemberUsageLimit: {
      id: 'oml.id',
      organizationId: 'oml.organizationId',
      userId: 'oml.userId',
      usageLimit: 'oml.usageLimit',
      setBy: 'oml.setBy',
      createdAt: 'oml.createdAt',
      updatedAt: 'oml.updatedAt',
    },
    usageLog: {
      billingEntityType: 'usageLog.billingEntityType',
      billingEntityId: 'usageLog.billingEntityId',
      billingPeriodStart: 'usageLog.billingPeriodStart',
      billingPeriodEnd: 'usageLog.billingPeriodEnd',
      createdAt: 'usageLog.createdAt',
      cost: 'usageLog.cost',
      userId: 'usageLog.userId',
    },
    workspace: {
      id: 'workspace.id',
      organizationAssignedAt: 'workspace.organizationAssignedAt',
      organizationId: 'workspace.organizationId',
    },
  },
  mockAnd: vi.fn((...conditions: unknown[]) => ({ operator: 'and', conditions })),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGte: vi.fn((field: unknown, value: unknown) => ({ operator: 'gte', field, value })),
  mockIsNull: vi.fn((field: unknown) => ({ operator: 'isNull', field })),
  mockLt: vi.fn((field: unknown, value: unknown) => ({ operator: 'lt', field, value })),
  mockOr: vi.fn((...conditions: unknown[]) => ({ operator: 'or', conditions })),
  mockGetOrganizationSubscription: vi.fn(),
}))

vi.mock('@sim/db/schema', () => schemaTables)

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
  gte: mockGte,
  isNull: mockIsNull,
  lt: mockLt,
  or: mockOr,
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageForCurrentPeriod,
  getOrgMemberUsageLimit,
  setOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

afterAll(() => {
  resetDbChainMock()
})

describe('getOrgMemberUsageLimit', () => {
  it('returns null when no row exists', async () => {
    queueTableRows(schemaTables.organizationMemberUsageLimit, [])
    await expect(getOrgMemberUsageLimit('org-1', 'user-2')).resolves.toBeNull()
  })

  it('returns the stored dollar limit as a number', async () => {
    queueTableRows(schemaTables.organizationMemberUsageLimit, [{ usageLimit: '2' }])
    await expect(getOrgMemberUsageLimit('org-1', 'user-2')).resolves.toBe(2)
  })
})

describe('getOrgMemberUsageForBillingPeriod', () => {
  it('counts immutable new rows plus bounded legacy rows exactly once', async () => {
    const billingPeriod = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
    }
    queueTableRows(schemaTables.usageLog, [{ cost: '4.5' }])
    mockGetOrganizationSubscription.mockResolvedValue({
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(
      getOrgMemberUsageForBillingPeriod('snapshot-org', 'actor-2', billingPeriod)
    ).resolves.toBe(4.5)

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
            'operator' in condition &&
            condition.operator === 'and'
        )
    )
    expect(mixedHistoryCall).toBeDefined()
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })
})

describe('setOrgMemberUsageLimit', () => {
  it('upserts when given a dollar amount', async () => {
    await setOrgMemberUsageLimit('org-1', 'user-2', 2, 'admin-1')
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    const values = dbChainMockFns.values.mock.calls[0][0]
    expect(values).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-2',
      usageLimit: '2',
      setBy: 'admin-1',
    })
    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('deletes the row when limit is null', async () => {
    await setOrgMemberUsageLimit('org-1', 'user-2', null, 'admin-1')
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('getOrgMemberUsageForCurrentPeriod', () => {
  it('reads the enforcement usage definition over the org subscription window', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    mockGetOrganizationSubscription.mockResolvedValue({ periodStart, periodEnd })
    queueTableRows(schemaTables.usageLog, [{ cost: '5' }])

    const result = await getOrgMemberUsageForCurrentPeriod('org-1', 'user-2')

    expect(result).toBe(5)
    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-1')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingEntityId', 'org-1')
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', periodStart)
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodEnd', periodEnd)
  })

  it('uses a prefetched subscription without a second lookup', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    queueTableRows(schemaTables.usageLog, [{ cost: '5' }])

    const result = await getOrgMemberUsageForCurrentPeriod('org-1', 'user-2', {
      periodStart,
      periodEnd,
    } as never)

    expect(result).toBe(5)
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', periodStart)
  })

  it('falls back to the all-time window when the org has no subscription period', async () => {
    queueTableRows(schemaTables.usageLog, [{ cost: '7' }])

    const result = await getOrgMemberUsageForCurrentPeriod('org-1', 'user-2', null)

    expect(result).toBe(7)
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodStart', defaultBillingPeriod().start)
    expect(mockEq).toHaveBeenCalledWith('usageLog.billingPeriodEnd', defaultBillingPeriod().end)
  })
})
