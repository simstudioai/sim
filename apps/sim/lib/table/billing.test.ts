import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBillingDisabledTableLimits, mockGetTablePlanLimits } = vi.hoisted(() => ({
  mockGetBillingDisabledTableLimits: vi.fn(),
  mockGetTablePlanLimits: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)
vi.mock('@/lib/table/constants', () => ({
  getBillingDisabledTableLimits: mockGetBillingDisabledTableLimits,
  getTablePlanLimits: mockGetTablePlanLimits,
}))

import {
  assertRowCapacity,
  getWorkspaceTableLimits,
  notifyTableRowUsage,
  TableRowLimitError,
  wouldExceedRowLimit,
} from '@/lib/table/billing'

const mockGetPlanTypeForLimits = billingPlanHelpersMockFns.mockGetPlanTypeForLimits
const mockResolveWorkspaceBillingPayer = billingAttributionMockFns.mockResolveWorkspaceBillingPayer

const LIMITS = {
  free: { maxTables: 3, maxRowsPerTable: 1000 },
  pro: { maxTables: 25, maxRowsPerTable: 5000 },
  team: { maxTables: 100, maxRowsPerTable: 10000 },
  enterprise: { maxTables: 10000, maxRowsPerTable: 1000000 },
}

// The limits cache is module-level and keyed by workspaceId; a fresh id per test
// keeps one test's cached value from leaking into the next.
let wsCounter = 0
const nextWorkspaceId = () => `ws-${++wsCounter}`

beforeEach(() => {
  setEnvFlags({ isBillingEnabled: true })
  mockGetTablePlanLimits.mockReturnValue(LIMITS)
  mockGetBillingDisabledTableLimits.mockReturnValue({
    maxTables: Number.MAX_SAFE_INTEGER,
    maxRowsPerTable: Number.MAX_SAFE_INTEGER,
  })
  mockResolveWorkspaceBillingPayer.mockResolvedValue({
    billedAccountUserId: 'billed-user',
    organizationId: 'org-1',
    payerSubscription: { plan: 'pro' },
  })
  mockGetPlanTypeForLimits.mockReturnValue('pro')
})

afterAll(resetEnvFlagsMock)

describe('getWorkspaceTableLimits', () => {
  it('caches the resolved limits within the TTL', async () => {
    const ws = nextWorkspaceId()
    await getWorkspaceTableLimits(ws)
    await getWorkspaceTableLimits(ws)
    expect(mockResolveWorkspaceBillingPayer).toHaveBeenCalledTimes(1)
  })

  it('returns free-tier limits when the workspace has no billed account', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValueOnce(null)
    expect(await getWorkspaceTableLimits(nextWorkspaceId())).toEqual(LIMITS.free)
  })

  it('falls back to free tier without caching when the lookup throws', async () => {
    const ws = nextWorkspaceId()
    mockResolveWorkspaceBillingPayer.mockRejectedValueOnce(new Error('db down'))
    expect(await getWorkspaceTableLimits(ws)).toEqual(LIMITS.free)
    // The fallback is never cached, so the next call re-attempts and resolves the real plan.
    expect(await getWorkspaceTableLimits(ws)).toEqual(LIMITS.pro)
  })

  it('bypasses billing plan resolution entirely when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetBillingDisabledTableLimits.mockReturnValue({
      maxTables: Number.MAX_SAFE_INTEGER,
      maxRowsPerTable: 12345,
    })

    expect(await getWorkspaceTableLimits(nextWorkspaceId())).toEqual({
      maxTables: Number.MAX_SAFE_INTEGER,
      maxRowsPerTable: 12345,
    })
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
    expect(mockGetTablePlanLimits).not.toHaveBeenCalled()
  })

  it('stays bounded under a burst of distinct all-fresh workspaces', async () => {
    // Far more distinct workspaces than the cap, all within one TTL window. The Map
    // must not grow without limit; eviction keeps it at/under the ceiling.
    for (let i = 0; i < 6_000; i++) {
      await getWorkspaceTableLimits(`burst-${i}`)
    }
    // Re-resolving an early (evicted) workspace must re-hit the billing lookup.
    mockResolveWorkspaceBillingPayer.mockClear()
    await getWorkspaceTableLimits('burst-0')
    expect(mockResolveWorkspaceBillingPayer).toHaveBeenCalledTimes(1)
  })
})

describe('wouldExceedRowLimit', () => {
  it('is false under the limit and at the limit exactly', () => {
    expect(wouldExceedRowLimit(1000, 10, 5)).toBe(false)
    expect(wouldExceedRowLimit(1000, 999, 1)).toBe(false)
  })

  it('is true when the sum crosses the limit', () => {
    expect(wouldExceedRowLimit(1000, 1000, 1)).toBe(true)
  })

  it('treats a negative limit as unlimited', () => {
    expect(wouldExceedRowLimit(-1, 10_000_000, 1)).toBe(false)
  })

  it('treats a zero limit as no rows allowed', () => {
    expect(wouldExceedRowLimit(0, 0, 1)).toBe(true)
  })
})

describe('assertRowCapacity', () => {
  it('allows reaching the limit exactly and returns it', async () => {
    await expect(
      assertRowCapacity({ workspaceId: nextWorkspaceId(), currentRowCount: 4999, addedRows: 1 })
    ).resolves.toBe(5000)
  })

  it('throws TableRowLimitError when the write would exceed the limit', async () => {
    await expect(
      assertRowCapacity({ workspaceId: nextWorkspaceId(), currentRowCount: 5000, addedRows: 1 })
    ).rejects.toBeInstanceOf(TableRowLimitError)
  })

  it('skips the check when the plan is unlimited (-1)', async () => {
    mockGetTablePlanLimits.mockReturnValue({
      ...LIMITS,
      pro: { maxTables: 25, maxRowsPerTable: -1 },
    })
    await expect(
      assertRowCapacity({
        workspaceId: nextWorkspaceId(),
        currentRowCount: 10_000_000,
        addedRows: 1,
      })
    ).resolves.toBe(-1)
  })
})

describe('notifyTableRowUsage — edge-crossing gate', () => {
  beforeEach(() => mockResolveWorkspaceBillingPayer.mockClear())

  it('fires when an insert crosses UP into the warn band (limit 5000)', () => {
    notifyTableRowUsage({ workspaceId: 'ws', currentRowCount: 3990, addedRows: 20, limit: 5000 })
    expect(mockResolveWorkspaceBillingPayer).toHaveBeenCalledTimes(1)
  })

  it('fires when an insert crosses UP into the reached band', () => {
    notifyTableRowUsage({ workspaceId: 'ws', currentRowCount: 4990, addedRows: 20, limit: 5000 })
    expect(mockResolveWorkspaceBillingPayer).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire when already above the band (no crossing)', () => {
    notifyTableRowUsage({ workspaceId: 'ws', currentRowCount: 4200, addedRows: 100, limit: 5000 })
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })

  it('does NOT fire well below the band', () => {
    notifyTableRowUsage({ workspaceId: 'ws', currentRowCount: 100, addedRows: 10, limit: 5000 })
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })

  it('does NOT fire for unlimited plans', () => {
    notifyTableRowUsage({ workspaceId: 'ws', currentRowCount: 0, addedRows: 10_000, limit: -1 })
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })
})
