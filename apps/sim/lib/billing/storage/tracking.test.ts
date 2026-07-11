/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbReturning,
  mockDbSet,
  mockDbTransaction,
  mockDbUpdate,
  mockDbWhere,
  mockFlags,
  mockGetHighestPrioritySubscription,
  mockMaybeNotifyLimit,
  mockSql,
  mockTxExecute,
  mockTxFrom,
  mockTxLimit,
  mockTxReturning,
  mockTxSelect,
  mockTxSet,
  mockTxUpdate,
  mockTxWhere,
  mockWorkspaceRow,
} = vi.hoisted(() => ({
  mockDbReturning: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbWhere: vi.fn(),
  mockFlags: { isBillingEnabled: true },
  mockGetHighestPrioritySubscription: vi.fn(),
  mockMaybeNotifyLimit: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  mockTxExecute: vi.fn(),
  mockTxFrom: vi.fn(),
  mockTxLimit: vi.fn(),
  mockTxReturning: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxWhere: vi.fn(),
  mockWorkspaceRow: {
    current: {
      billedAccountUserId: 'workspace-owner',
      organizationId: 'workspace-org' as string | null,
      storageUsedBytes: 1_000,
    },
  },
}))

const mockTx = {
  execute: mockTxExecute,
  select: mockTxSelect,
  update: mockTxUpdate,
}

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockDbTransaction,
    update: mockDbUpdate,
  },
}))

vi.mock('@sim/db/schema', () => ({
  organization: {
    id: 'organization.id',
    storageUsedBytes: 'organization.storageUsedBytes',
  },
  userStats: {
    storageUsedBytes: 'userStats.storageUsedBytes',
    userId: 'userStats.userId',
  },
  workspace: {
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    organizationId: 'workspace.organizationId',
    storageUsedBytes: 'workspace.storageUsedBytes',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  sql: mockSql,
}))

vi.mock('@/lib/billing/core/limit-notifications', () => ({
  maybeNotifyLimit: mockMaybeNotifyLimit,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: vi.fn(() => undefined),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

import type { StorageBillingContext } from '@/lib/billing/storage/context'
import {
  decrementStorageUsageForBillingContext,
  incrementStorageUsage,
  incrementStorageUsageForBillingContext,
  incrementStorageUsageForBillingContextInTx,
} from '@/lib/billing/storage/tracking'
import type { DbOrTx } from '@/lib/db/types'

const ORG_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization', id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

describe('workspace storage counter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    mockWorkspaceRow.current = {
      billedAccountUserId: 'workspace-owner',
      organizationId: 'workspace-org',
      storageUsedBytes: 1_000,
    }

    mockDbTransaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx)
    )
    mockTxSelect.mockReturnValue({ from: mockTxFrom })
    mockTxFrom.mockReturnValue({
      where: vi.fn(() => ({
        for: vi.fn(() => ({ limit: mockTxLimit })),
      })),
    })
    mockTxLimit.mockImplementation(async () => [mockWorkspaceRow.current])
    mockTxUpdate.mockReturnValue({ set: mockTxSet })
    mockTxSet.mockReturnValue({ where: mockTxWhere })
    mockTxWhere.mockReturnValue({ returning: mockTxReturning })
    mockTxReturning.mockResolvedValue([{ storageUsedBytes: 1_100 }])
    mockTxExecute.mockResolvedValue(undefined)

    mockDbUpdate.mockReturnValue({ set: mockDbSet })
    mockDbSet.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ returning: mockDbReturning })
    mockDbReturning.mockResolvedValue([{ storageUsedBytes: 100 }])
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    mockMaybeNotifyLimit.mockResolvedValue(undefined)
  })

  it('locks one workspace row and updates its ledger and current payer in one transaction', async () => {
    await incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)

    expect(mockDbTransaction).toHaveBeenCalledTimes(1)
    expect(mockTxSelect).toHaveBeenCalledWith({
      billedAccountUserId: 'workspace.billedAccountUserId',
      organizationId: 'workspace.organizationId',
      storageUsedBytes: 'workspace.storageUsedBytes',
    })
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockTxExecute.mock.calls[0]?.[0]).toMatchObject({
      values: ['workspace-storage-payer:organization:workspace-org'],
    })
    expect(mockTxUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'workspace.id' }))
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 1_100 })
    expect(mockTxUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'organization.id' })
    )
    await vi.waitFor(() => expect(mockMaybeNotifyLimit).toHaveBeenCalledTimes(1))
  })

  it('uses the payer read under the workspace lock instead of a stale context payer', async () => {
    mockWorkspaceRow.current = {
      billedAccountUserId: 'new-user-payer',
      organizationId: null,
      storageUsedBytes: 1_000,
    }

    await incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)

    expect(mockTxUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: 'userStats.userId' })
    )
  })

  it('applies only remaining workspace bytes on delete and never writes a negative ledger', async () => {
    await decrementStorageUsageForBillingContext(ORG_CONTEXT, 4_096)

    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 0 })
    const payerUpdate = mockTxSet.mock.calls[1]?.[0] as {
      storageUsedBytes: { values: unknown[] }
    }
    expect(payerUpdate.storageUsedBytes.values).toContain(1_000)
  })

  it('throws when the payer row is missing so the transaction rolls back both writes', async () => {
    mockTxReturning.mockResolvedValueOnce([])

    await expect(incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)).rejects.toThrow(
      'Storage payer organization:workspace-org is missing or below 100 bytes'
    )
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 1_100 })
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('can share the caller transaction with billable metadata insertion', async () => {
    await incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)

    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('keeps workspace-less legacy writes on the aggregate-only compatibility path', async () => {
    await incrementStorageUsage('legacy-user', 100)

    expect(mockDbUpdate).toHaveBeenCalledTimes(1)
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })

  it('skips all mutations while billing is disabled', async () => {
    mockFlags.isBillingEnabled = false

    await incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)

    expect(mockDbTransaction).not.toHaveBeenCalled()
  })
})
