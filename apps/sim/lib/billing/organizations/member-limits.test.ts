/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockInsert,
  mockInsertValues,
  mockOnConflictDoUpdate,
  mockDelete,
  mockDeleteWhere,
  mockAnd,
  mockEq,
  mockGte,
  mockIsNull,
  mockLeftJoin,
  mockLt,
  mockOr,
  mockGetOrganizationSubscription,
  mockGetOrgWorkspaceUsageCostForUser,
} = vi.hoisted(() => ({
  mockDbState: { selectResults: [] as unknown[] },
  mockInsert: vi.fn(),
  mockInsertValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockAnd: vi.fn((...conditions: unknown[]) => ({ operator: 'and', conditions })),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGte: vi.fn((field: unknown, value: unknown) => ({ operator: 'gte', field, value })),
  mockIsNull: vi.fn((field: unknown) => ({ operator: 'isNull', field })),
  mockLeftJoin: vi.fn(),
  mockLt: vi.fn((field: unknown, value: unknown) => ({ operator: 'lt', field, value })),
  mockOr: vi.fn((...conditions: unknown[]) => ({ operator: 'or', conditions })),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetOrgWorkspaceUsageCostForUser: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn(() => chain)
      chain.leftJoin = mockLeftJoin.mockImplementation(() => chain)
      chain.where = vi.fn(() => chain)
      chain.limit = vi.fn(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
      chain.then = (cb: (rows: unknown) => unknown) =>
        Promise.resolve(cb(mockDbState.selectResults.shift() ?? []))
      return chain
    }),
    insert: mockInsert,
    delete: mockDelete,
  },
}))

vi.mock('@sim/db/schema', () => ({
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
}))

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

vi.mock('@/lib/billing/core/usage-log', () => ({
  getOrgWorkspaceUsageCostForUser: mockGetOrgWorkspaceUsageCostForUser,
}))

import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage,
  setOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'

beforeEach(() => {
  vi.clearAllMocks()
  mockDbState.selectResults = []
  mockInsert.mockReturnValue({ values: mockInsertValues })
  mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
  mockOnConflictDoUpdate.mockResolvedValue(undefined)
  mockDelete.mockReturnValue({ where: mockDeleteWhere })
  mockDeleteWhere.mockResolvedValue(undefined)
})

describe('getOrgMemberUsageLimit', () => {
  it('returns null when no row exists', async () => {
    mockDbState.selectResults = [[]]
    await expect(getOrgMemberUsageLimit('org-1', 'user-2')).resolves.toBeNull()
  })

  it('returns the stored dollar limit as a number', async () => {
    mockDbState.selectResults = [[{ usageLimit: '2' }]]
    await expect(getOrgMemberUsageLimit('org-1', 'user-2')).resolves.toBe(2)
  })
})

describe('getOrgMemberUsageForBillingPeriod', () => {
  it('counts immutable new rows plus bounded legacy rows exactly once', async () => {
    const billingPeriod = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
    }
    mockDbState.selectResults = [[{ cost: '4.5' }]]
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
    expect(mockLeftJoin).toHaveBeenCalledWith(
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
    expect(mockGetOrgWorkspaceUsageCostForUser).not.toHaveBeenCalled()
  })
})

describe('setOrgMemberUsageLimit', () => {
  it('upserts when given a dollar amount', async () => {
    await setOrgMemberUsageLimit('org-1', 'user-2', 2, 'admin-1')
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockDelete).not.toHaveBeenCalled()
    const values = mockInsertValues.mock.calls[0][0]
    expect(values).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-2',
      usageLimit: '2',
      setBy: 'admin-1',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('deletes the row when limit is null', async () => {
    await setOrgMemberUsageLimit('org-1', 'user-2', null, 'admin-1')
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('getOrgMemberWorkspaceUsage', () => {
  it("returns the member's usage within the org subscription window", async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    mockGetOrganizationSubscription.mockResolvedValue({ periodStart, periodEnd })
    mockGetOrgWorkspaceUsageCostForUser.mockResolvedValue(5)

    const result = await getOrgMemberWorkspaceUsage('org-1', 'user-2')

    expect(result).toBe(5)
    expect(mockGetOrgWorkspaceUsageCostForUser).toHaveBeenCalledWith('org-1', 'user-2', {
      start: periodStart,
      end: periodEnd,
    })
  })

  it('falls back to the all-time window when the org has no subscription', async () => {
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetOrgWorkspaceUsageCostForUser.mockResolvedValue(7)

    const result = await getOrgMemberWorkspaceUsage('org-1', 'user-2')

    expect(result).toBe(7)
    expect(mockGetOrgWorkspaceUsageCostForUser).toHaveBeenCalledWith(
      'org-1',
      'user-2',
      defaultBillingPeriod()
    )
  })

  it('falls back to the all-time window when the subscription is missing periodEnd', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: null,
    })
    mockGetOrgWorkspaceUsageCostForUser.mockResolvedValue(3)

    const result = await getOrgMemberWorkspaceUsage('org-1', 'user-2')

    expect(result).toBe(3)
    expect(mockGetOrgWorkspaceUsageCostForUser).toHaveBeenCalledWith(
      'org-1',
      'user-2',
      defaultBillingPeriod()
    )
  })
})
