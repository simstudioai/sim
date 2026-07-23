/**
 * @vitest-environment node
 */
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetStorageLimitForBillingContext,
  mockGetStorageUsageForBillingContext,
  mockGetUserStorageLimit,
  mockGetUserStorageUsage,
  mockLoggerError,
  mockMaybeNotifyLimit,
  mockOrderedLockRows,
  mockSql,
  mockTxFrom,
  mockTxLimit,
  mockTxOrderBy,
  mockTxOrderedFor,
  mockTxReturning,
  mockTxSelect,
  mockTxSet,
  mockTxUpdate,
  mockTxWhere,
  mockWorkspaceRow,
} = vi.hoisted(() => ({
  mockGetStorageLimitForBillingContext: vi.fn(),
  mockGetStorageUsageForBillingContext: vi.fn(),
  mockGetUserStorageLimit: vi.fn(),
  mockGetUserStorageUsage: vi.fn(),
  mockLoggerError: vi.fn(),
  mockMaybeNotifyLimit: vi.fn(),
  mockOrderedLockRows: { queue: [] as unknown[][] },
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  mockTxFrom: vi.fn(),
  mockTxLimit: vi.fn(),
  mockTxOrderBy: vi.fn(),
  mockTxOrderedFor: vi.fn(),
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
  select: mockTxSelect,
  update: mockTxUpdate,
}

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
  asc: vi.fn((field: unknown) => ({ field, order: 'asc' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  sql: mockSql,
}))

vi.mock('@/lib/billing/core/limit-notifications', () => ({
  maybeNotifyLimit: mockMaybeNotifyLimit,
}))

vi.mock('@/lib/billing/storage/limits', () => ({
  getStorageLimitForBillingContext: mockGetStorageLimitForBillingContext,
  getStorageUsageForBillingContext: mockGetStorageUsageForBillingContext,
  getUserStorageLimit: mockGetUserStorageLimit,
  getUserStorageUsage: mockGetUserStorageUsage,
  // No FREE_STORAGE_LIMIT_GB opt-in in these tests, so enforcement === billing.
  isStorageEnforcementEnabled: () => envFlagsMock.isBillingEnabled,
}))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: vi.fn(() => undefined),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

import type { StorageBillingContext } from '@/lib/billing/storage/context'
import {
  applyStorageUsageDeltasInTx,
  decrementStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
} from '@/lib/billing/storage/tracking'
import type { DbOrTx } from '@/lib/db/types'

const ORG_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization', id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('workspace storage counter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isBillingEnabled: true })
    mockWorkspaceRow.current = {
      billedAccountUserId: 'workspace-owner',
      organizationId: 'workspace-org',
      storageUsedBytes: 1_000,
    }

    mockOrderedLockRows.queue = []
    mockTxSelect.mockReturnValue({ from: mockTxFrom })
    mockTxFrom.mockReturnValue({
      where: vi.fn(() => ({
        for: vi.fn(() => ({ limit: mockTxLimit })),
        limit: mockTxLimit,
        orderBy: mockTxOrderBy,
      })),
    })
    mockTxOrderBy.mockReturnValue({
      for: mockTxOrderedFor,
      limit: mockTxLimit,
    })
    mockTxOrderedFor.mockImplementation(async () => mockOrderedLockRows.queue.shift() ?? [])
    mockTxLimit.mockImplementation(async () => [mockWorkspaceRow.current])
    mockTxUpdate.mockReturnValue({ set: mockTxSet })
    mockTxSet.mockReturnValue({ where: mockTxWhere })
    mockTxWhere.mockReturnValue({ returning: mockTxReturning })
    mockTxReturning.mockResolvedValue([{ storageUsedBytes: 1_100 }])

    mockGetStorageLimitForBillingContext.mockReturnValue(2_000)
    mockGetStorageUsageForBillingContext.mockResolvedValue(1_000)
    mockGetUserStorageLimit.mockResolvedValue(1_050)
    mockGetUserStorageUsage.mockResolvedValue(1_000)
    mockMaybeNotifyLimit.mockResolvedValue(undefined)
  })

  it('locks the workspace before its payer and updates both ledgers', async () => {
    await incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)

    expect(mockTxSelect).toHaveBeenNthCalledWith(1, {
      billedAccountUserId: 'workspace.billedAccountUserId',
      organizationId: 'workspace.organizationId',
      storageUsedBytes: 'workspace.storageUsedBytes',
    })
    expect(mockTxSelect).toHaveBeenNthCalledWith(2, {
      storageUsedBytes: 'organization.storageUsedBytes',
    })
    expect(mockTxUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'workspace.id' }))
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 1_100 })
    expect(mockTxUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'organization.id' })
    )
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('serializes quota admission on the locked payer ledger', async () => {
    mockGetStorageLimitForBillingContext.mockReturnValue(1_050)
    mockTxLimit
      .mockResolvedValueOnce([
        {
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_000,
        },
      ])
      .mockResolvedValueOnce([{ storageUsedBytes: 900 }])
      .mockResolvedValueOnce([
        {
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_100,
        },
      ])
      .mockResolvedValueOnce([{ storageUsedBytes: 1_000 }])
    mockTxReturning.mockResolvedValueOnce([{ storageUsedBytes: 1_000 }])

    await incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    await expect(
      incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    ).rejects.toThrow('Storage limit exceeded')

    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale pre-resolved payer instead of silently rerouting the delta', async () => {
    mockWorkspaceRow.current = {
      billedAccountUserId: 'new-user-payer',
      organizationId: null,
      storageUsedBytes: 1_000,
    }

    await expect(
      incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    ).rejects.toThrow('Storage payer changed')

    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('clamps and logs workspace and payer underflow during rollout', async () => {
    mockTxReturning.mockResolvedValueOnce([{ storageUsedBytes: 0 }])

    await expect(
      decrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 4_096)
    ).resolves.toBeUndefined()

    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 0 })
    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Clamping workspace storage ledger underflow',
      expect.objectContaining({ currentBytes: 1_000, decrementBytes: 4_096 })
    )
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Clamping storage payer ledger underflow',
      expect.objectContaining({
        payer: 'organization:workspace-org',
        currentBytes: 1_000,
        decrementBytes: 4_096,
      })
    )
  })

  it('clamps and logs payer underflow while preserving the workspace decrement', async () => {
    mockTxLimit
      .mockResolvedValueOnce([mockWorkspaceRow.current])
      .mockResolvedValueOnce([{ storageUsedBytes: 50 }])
    mockTxReturning.mockResolvedValueOnce([{ storageUsedBytes: 0 }])

    await expect(
      decrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    ).resolves.toBeUndefined()

    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 900 })
    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Clamping storage payer ledger underflow',
      expect.objectContaining({ currentBytes: 50, decrementBytes: 100 })
    )
  })

  it('throws when the payer row is missing so the transaction rolls back both writes', async () => {
    mockTxLimit.mockResolvedValueOnce([mockWorkspaceRow.current]).mockResolvedValueOnce([])

    await expect(
      incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    ).rejects.toThrow('Storage payer organization:workspace-org not found')
    expect(mockTxSet).not.toHaveBeenCalled()
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('still throws on a missing payer row during a clamped decrement', async () => {
    mockTxLimit.mockResolvedValueOnce([mockWorkspaceRow.current]).mockResolvedValueOnce([])

    await expect(
      decrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)
    ).rejects.toThrow('Storage payer organization:workspace-org not found')
    expect(mockTxSet).not.toHaveBeenCalled()
  })

  it('can share the caller transaction with billable metadata insertion', async () => {
    await incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)

    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('keeps durable workspace and payer ledgers accurate while billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })

    await incrementStorageUsageForBillingContextInTx(mockTx as unknown as DbOrTx, ORG_CONTEXT, 100)

    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })

  it('keeps context-aware notifications available after commit', async () => {
    await maybeNotifyStorageLimitForBillingContext(ORG_CONTEXT, 1_100)

    expect(mockMaybeNotifyLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        billedUserId: 'workspace-owner',
        billingEntity: ORG_CONTEXT.billingEntity,
        currentUsage: 1_100,
        workspaceId: 'workspace-1',
      })
    )
  })

  it('moves workspace bytes without touching the aggregate when both workspaces share a payer', async () => {
    const destinationContext: StorageBillingContext = {
      ...ORG_CONTEXT,
      workspaceId: 'workspace-2',
    }
    mockOrderedLockRows.queue = [
      [
        {
          id: 'workspace-1',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_000,
        },
        {
          id: 'workspace-2',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 200,
        },
      ],
      [{ id: 'workspace-org', storageUsedBytes: 5_000 }],
    ]

    const updatedUsage = await applyStorageUsageDeltasInTx(mockTx as unknown as DbOrTx, {
      workspaceDeltas: [
        { context: { ...ORG_CONTEXT, workspaceId: 'workspace-1' }, deltaBytes: -100 },
        { context: destinationContext, deltaBytes: 100 },
      ],
      legacyDeltas: [],
    })

    expect(updatedUsage).toBeUndefined()
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 900 })
    expect(mockTxSet).toHaveBeenNthCalledWith(2, { storageUsedBytes: 300 })
    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
  })

  it('locks every workspace before user payers and organization payers in a mixed batch', async () => {
    const locks: Array<{ ids: string[]; table: string }> = []
    const updates: string[] = []
    const rowsByTable: Record<string, unknown[]> = {
      workspace: [
        {
          id: 'workspace-a',
          billedAccountUserId: 'org-owner',
          organizationId: 'org-a',
          storageUsedBytes: 100,
        },
        {
          id: 'workspace-b',
          billedAccountUserId: 'user-z',
          organizationId: null,
          storageUsedBytes: 100,
        },
      ],
      userStats: [
        { id: 'user-a', storageUsedBytes: 50 },
        { id: 'user-z', storageUsedBytes: 100 },
      ],
      organization: [{ id: 'org-a', storageUsedBytes: 100 }],
    }
    const tableName = (source: { id?: string; userId?: string }) => {
      if (source.userId === 'userStats.userId') return 'userStats'
      if (source.id === 'organization.id') return 'organization'
      return 'workspace'
    }
    const batchTx = {
      select: () => {
        let table = 'workspace'
        let ids: string[] = []
        const chain = {
          from(source: { id?: string; userId?: string }) {
            table = tableName(source)
            return chain
          },
          where(condition: { value: string[] }) {
            ids = condition.value
            return chain
          },
          orderBy() {
            return chain
          },
          async for() {
            locks.push({ ids: [...ids], table })
            return rowsByTable[table] ?? []
          },
        }
        return chain
      },
      update: (source: { id?: string; userId?: string }) => ({
        set: () => ({
          where: async () => {
            updates.push(tableName(source))
          },
        }),
      }),
    }

    await applyStorageUsageDeltasInTx(batchTx as unknown as DbOrTx, {
      workspaceDeltas: [
        {
          context: {
            workspaceId: 'workspace-b',
            billedAccountUserId: 'user-z',
            billingEntity: { type: 'user', id: 'user-z' },
            plan: 'pro',
            customStorageLimitGB: null,
          },
          deltaBytes: -20,
        },
        {
          context: {
            workspaceId: 'workspace-a',
            billedAccountUserId: 'org-owner',
            billingEntity: { type: 'organization', id: 'org-a' },
            plan: 'team',
            customStorageLimitGB: null,
          },
          deltaBytes: -10,
        },
      ],
      legacyDeltas: [{ userId: 'user-a', subscription: null, deltaBytes: -5 }],
    })

    expect(locks).toEqual([
      { ids: ['workspace-a', 'workspace-b'], table: 'workspace' },
      { ids: ['user-a', 'user-z'], table: 'userStats' },
      { ids: ['org-a'], table: 'organization' },
    ])
    expect(updates).toEqual(['workspace', 'workspace', 'userStats', 'userStats', 'organization'])
  })

  it('moves bytes across different payers, updating user payers before organization payers', async () => {
    const destinationContext: StorageBillingContext = {
      workspaceId: 'workspace-2',
      billedAccountUserId: 'destination-owner',
      billingEntity: { type: 'user', id: 'destination-owner' },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }
    mockGetStorageLimitForBillingContext.mockReturnValue(10_000)
    mockOrderedLockRows.queue = [
      [
        {
          id: 'workspace-1',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_000,
        },
        {
          id: 'workspace-2',
          billedAccountUserId: 'destination-owner',
          organizationId: null,
          storageUsedBytes: 200,
        },
      ],
      [{ id: 'destination-owner', storageUsedBytes: 500 }],
      [{ id: 'workspace-org', storageUsedBytes: 5_000 }],
    ]

    const updatedUsage = await applyStorageUsageDeltasInTx(mockTx as unknown as DbOrTx, {
      workspaceDeltas: [
        { context: ORG_CONTEXT, deltaBytes: -100 },
        { context: destinationContext, deltaBytes: 100 },
      ],
      legacyDeltas: [],
    })

    expect(updatedUsage).toBe(600)
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 900 })
    expect(mockTxSet).toHaveBeenNthCalledWith(2, { storageUsedBytes: 300 })
    expect(mockTxSet).toHaveBeenNthCalledWith(3, { storageUsedBytes: 600 })
    expect(mockTxSet).toHaveBeenNthCalledWith(4, { storageUsedBytes: 4_900 })
    expect(mockTxUpdate).toHaveBeenCalledTimes(4)
    expect(mockTxSelect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ storageUsedBytes: 'userStats.storageUsedBytes' })
    )
    expect(mockTxSelect).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ storageUsedBytes: 'organization.storageUsedBytes' })
    )
  })

  it('rejects destination quota before mutating any ledger', async () => {
    const destinationContext: StorageBillingContext = {
      workspaceId: 'workspace-2',
      billedAccountUserId: 'destination-owner',
      billingEntity: { type: 'user', id: 'destination-owner' },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }
    mockGetStorageLimitForBillingContext.mockReturnValue(550)
    mockOrderedLockRows.queue = [
      [
        {
          id: 'workspace-1',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_000,
        },
        {
          id: 'workspace-2',
          billedAccountUserId: 'destination-owner',
          organizationId: null,
          storageUsedBytes: 200,
        },
      ],
      [{ id: 'destination-owner', storageUsedBytes: 500 }],
      [{ id: 'workspace-org', storageUsedBytes: 5_000 }],
    ]

    await expect(
      applyStorageUsageDeltasInTx(mockTx as unknown as DbOrTx, {
        workspaceDeltas: [
          { context: ORG_CONTEXT, deltaBytes: -100 },
          { context: destinationContext, deltaBytes: 100 },
        ],
        legacyDeltas: [],
      })
    ).rejects.toThrow('Storage limit exceeded')
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rejects a stale pre-resolved payer without falling back to the locked row', async () => {
    const destinationContext: StorageBillingContext = {
      workspaceId: 'workspace-2',
      billedAccountUserId: 'stale-owner',
      billingEntity: { type: 'user', id: 'stale-owner' },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }
    mockOrderedLockRows.queue = [
      [
        {
          id: 'workspace-1',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 1_000,
        },
        {
          id: 'workspace-2',
          billedAccountUserId: 'current-owner',
          organizationId: null,
          storageUsedBytes: 200,
        },
      ],
    ]

    await expect(
      applyStorageUsageDeltasInTx(mockTx as unknown as DbOrTx, {
        workspaceDeltas: [
          { context: ORG_CONTEXT, deltaBytes: -100 },
          { context: destinationContext, deltaBytes: 100 },
        ],
        legacyDeltas: [],
      })
    ).rejects.toThrow('Storage payer changed for workspace workspace-2')
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('clamps and logs underfunded source ledgers instead of failing a move', async () => {
    const destinationContext: StorageBillingContext = {
      workspaceId: 'workspace-2',
      billedAccountUserId: 'destination-owner',
      billingEntity: { type: 'user', id: 'destination-owner' },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }
    mockGetStorageLimitForBillingContext.mockReturnValue(10_000)
    mockOrderedLockRows.queue = [
      [
        {
          id: 'workspace-1',
          billedAccountUserId: 'workspace-owner',
          organizationId: 'workspace-org',
          storageUsedBytes: 50,
        },
        {
          id: 'workspace-2',
          billedAccountUserId: 'destination-owner',
          organizationId: null,
          storageUsedBytes: 200,
        },
      ],
      [{ id: 'destination-owner', storageUsedBytes: 500 }],
      [{ id: 'workspace-org', storageUsedBytes: 30 }],
    ]

    const updatedUsage = await applyStorageUsageDeltasInTx(mockTx as unknown as DbOrTx, {
      workspaceDeltas: [
        { context: ORG_CONTEXT, deltaBytes: -100 },
        { context: destinationContext, deltaBytes: 100 },
      ],
      legacyDeltas: [],
    })

    expect(updatedUsage).toBe(600)
    expect(mockTxSet).toHaveBeenNthCalledWith(1, { storageUsedBytes: 0 })
    expect(mockTxSet).toHaveBeenNthCalledWith(2, { storageUsedBytes: 300 })
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Clamping workspace storage ledger underflow',
      expect.objectContaining({ workspaceId: 'workspace-1', currentBytes: 50 })
    )
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Clamping storage payer ledger underflow',
      expect.objectContaining({ payer: 'organization:workspace-org', currentBytes: 30 })
    )
  })
})
