/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbFrom,
  mockDbLimit,
  mockDbReturning,
  mockDbSelect,
  mockDbSet,
  mockDbUpdate,
  mockDbWhere,
  mockEq,
  mockFlags,
  mockGetHighestPrioritySubscription,
  mockMaybeNotifyLimit,
  mockSql,
  mockTxReturning,
  mockTxSet,
  mockTxUpdate,
  mockTxWhere,
} = vi.hoisted(() => ({
  mockDbFrom: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbReturning: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbWhere: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockFlags: { isBillingEnabled: true },
  mockGetHighestPrioritySubscription: vi.fn(),
  mockMaybeNotifyLimit: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  mockTxReturning: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
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
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
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
  decrementStorageUsageForBillingContextInTx,
  decrementStorageUsageInTx,
  incrementStorageUsage,
  incrementStorageUsageForBillingContext,
} from '@/lib/billing/storage/tracking'
import type { DbOrTx } from '@/lib/db/types'

const ORG_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization', id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

const USER_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-2',
  billedAccountUserId: 'workspace-payer',
  billingEntity: { type: 'user', id: 'workspace-payer' },
  plan: 'pro_4000',
  customStorageLimitGB: null,
}

describe('storage counter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    mockDbUpdate.mockReturnValue({ set: mockDbSet })
    mockDbSet.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ returning: mockDbReturning })
    mockDbReturning.mockResolvedValue([{ storageUsedBytes: 2048 }])
    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({
      where: vi.fn(() => ({
        limit: mockDbLimit,
      })),
    })
    mockDbLimit.mockResolvedValue([{ storageUsedBytes: 1024 }])
    mockTxUpdate.mockReturnValue({ set: mockTxSet })
    mockTxSet.mockReturnValue({ where: mockTxWhere })
    mockTxWhere.mockReturnValue({ returning: mockTxReturning })
    mockTxReturning.mockResolvedValue([{ storageUsedBytes: 0 }])
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    mockMaybeNotifyLimit.mockResolvedValue(undefined)
  })

  it.each([
    {
      context: ORG_CONTEXT,
      expectedField: 'organization.id',
      expectedId: 'workspace-org',
      expectedTable: expect.objectContaining({ id: 'organization.id' }),
    },
    {
      context: USER_CONTEXT,
      expectedField: 'userStats.userId',
      expectedId: 'workspace-payer',
      expectedTable: expect.objectContaining({ userId: 'userStats.userId' }),
    },
  ])(
    'updates the $context.billingEntity.type payer once and notifies from RETURNING',
    async ({ context, expectedField, expectedId, expectedTable }) => {
      await incrementStorageUsageForBillingContext(context, 100)

      await vi.waitFor(() => expect(mockMaybeNotifyLimit).toHaveBeenCalledTimes(1))
      expect(mockDbUpdate).toHaveBeenCalledTimes(1)
      expect(mockDbUpdate).toHaveBeenCalledWith(expectedTable)
      expect(mockEq).toHaveBeenCalledWith(expectedField, expectedId)
      expect(mockDbReturning).toHaveBeenCalledWith({
        storageUsedBytes:
          context.billingEntity.type === 'organization'
            ? 'organization.storageUsedBytes'
            : 'userStats.storageUsedBytes',
      })
      expect(mockDbSelect).not.toHaveBeenCalled()
      expect(mockMaybeNotifyLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          billingEntity: context.billingEntity,
          currentUsage: 2048,
          workspaceId: context.workspaceId,
        })
      )
    }
  )

  it('keeps decrements atomic and clamped at zero', async () => {
    await decrementStorageUsageForBillingContext(ORG_CONTEXT, 4096)

    const update = mockDbSet.mock.calls[0]?.[0] as
      | { storageUsedBytes?: { strings?: readonly string[] } }
      | undefined
    expect(update?.storageUsedBytes?.strings?.join('')).toContain('GREATEST(0, ')
    expect(mockDbUpdate).toHaveBeenCalledTimes(1)
    expect(mockDbReturning).toHaveBeenCalledTimes(1)
  })

  it('falls back to a usage read when UPDATE RETURNING has no row', async () => {
    mockDbReturning.mockResolvedValueOnce([])

    await incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)

    await vi.waitFor(() => expect(mockMaybeNotifyLimit).toHaveBeenCalledTimes(1))
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
    expect(mockMaybeNotifyLimit).toHaveBeenCalledWith(
      expect.objectContaining({ currentUsage: 1024 })
    )
  })

  it('routes legacy user and organization wrappers through the same mutation path', async () => {
    await incrementStorageUsage('legacy-user', 100)
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      metadata: null,
      plan: 'team_25000',
      referenceId: 'legacy-org',
    })
    await incrementStorageUsage('legacy-member', 100)

    expect(mockDbUpdate).toHaveBeenCalledTimes(2)
    expect(mockEq).toHaveBeenNthCalledWith(1, 'userStats.userId', 'legacy-user')
    expect(mockEq).toHaveBeenNthCalledWith(2, 'organization.id', 'legacy-org')
    expect(mockDbReturning).toHaveBeenCalledTimes(2)
  })

  it('uses the shared mutation inside transactions without notifications or DB reads', async () => {
    const tx = { update: mockTxUpdate } as unknown as DbOrTx

    await decrementStorageUsageForBillingContextInTx(tx, ORG_CONTEXT, 4096)
    await decrementStorageUsageInTx(
      tx,
      { referenceId: 'legacy-org' } as never,
      'legacy-member',
      4096
    )

    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
    expect(mockTxReturning).toHaveBeenCalledTimes(2)
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
    const updates = mockTxSet.mock.calls.map(
      ([value]) =>
        (
          value as { storageUsedBytes?: { strings?: readonly string[] } }
        ).storageUsedBytes?.strings?.join('') ?? ''
    )
    expect(updates).toEqual([
      expect.stringContaining('GREATEST(0, '),
      expect.stringContaining('GREATEST(0, '),
    ])
  })

  it('skips mutations while billing is disabled', async () => {
    mockFlags.isBillingEnabled = false

    await incrementStorageUsageForBillingContext(ORG_CONTEXT, 100)
    await decrementStorageUsageForBillingContext(USER_CONTEXT, 100)

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockMaybeNotifyLimit).not.toHaveBeenCalled()
  })
})
