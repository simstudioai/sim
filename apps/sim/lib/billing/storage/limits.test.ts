/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEq,
  mockFlags,
  mockFrom,
  mockGetHighestPrioritySubscription,
  mockLimit,
  mockSelect,
  mockWhere,
} = vi.hoisted(() => ({
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockFlags: { isBillingEnabled: true },
  mockFrom: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockLimit: vi.fn(),
  mockSelect: vi.fn(),
  mockWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
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
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

const { mockGetEnv } = vi.hoisted(() => ({
  mockGetEnv: vi.fn((_variable: string): string | undefined => undefined),
}))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: mockGetEnv,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

import type { StorageBillingContext } from '@/lib/billing/storage/context'
import {
  checkStorageQuota,
  checkStorageQuotaForBillingContext,
  getStorageLimitForBillingContext,
  getStorageUsageForBillingContext,
  getUserStorageLimit,
  getUserStorageUsage,
} from '@/lib/billing/storage/limits'

const ORG_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization', id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: 1,
}

const USER_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-2',
  billedAccountUserId: 'workspace-payer',
  billingEntity: { type: 'user', id: 'workspace-payer' },
  plan: 'pro_4000',
  customStorageLimitGB: null,
}

const GIB = 1024 ** 3

describe('storage limits and quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    mockGetEnv.mockReturnValue(undefined)
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([{ storageUsedBytes: 1024 }])
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('reads user and organization counters through the same entity-aware path', async () => {
    mockLimit
      .mockResolvedValueOnce([{ storageUsedBytes: 11 }])
      .mockResolvedValueOnce([{ storageUsedBytes: 22 }])
      .mockResolvedValueOnce([{ storageUsedBytes: 33 }])
      .mockResolvedValueOnce([{ storageUsedBytes: 44 }])

    await expect(getStorageUsageForBillingContext(ORG_CONTEXT)).resolves.toBe(11)
    await expect(getStorageUsageForBillingContext(USER_CONTEXT)).resolves.toBe(22)
    await expect(
      getUserStorageUsage('legacy-member', {
        referenceId: 'legacy-org',
        plan: 'team_25000',
      } as never)
    ).resolves.toBe(33)
    await expect(getUserStorageUsage('legacy-user', null)).resolves.toBe(44)

    expect(mockEq).toHaveBeenNthCalledWith(1, 'organization.id', 'workspace-org')
    expect(mockEq).toHaveBeenNthCalledWith(2, 'userStats.userId', 'workspace-payer')
    expect(mockEq).toHaveBeenNthCalledWith(3, 'organization.id', 'legacy-org')
    expect(mockEq).toHaveBeenNthCalledWith(4, 'userStats.userId', 'legacy-user')
  })

  it('normalizes legacy and workspace custom limit inputs without changing their keys', async () => {
    expect(getStorageLimitForBillingContext(ORG_CONTEXT)).toBe(GIB)
    expect(getStorageLimitForBillingContext({ ...ORG_CONTEXT, customStorageLimitGB: 0 })).toBe(
      getStorageLimitForBillingContext({ ...ORG_CONTEXT, customStorageLimitGB: null })
    )
    await expect(
      getUserStorageLimit('legacy-member', {
        metadata: { customStorageLimitGB: 75 },
        plan: 'team_25000',
        referenceId: 'legacy-org',
      } as never)
    ).resolves.toBe(75 * GIB)
  })

  it('returns the exact same quota result for legacy and workspace organization payers', async () => {
    mockLimit.mockResolvedValue([{ storageUsedBytes: GIB }])
    mockGetHighestPrioritySubscription.mockResolvedValue({
      metadata: { customStorageLimitGB: 1 },
      plan: 'team_25000',
      referenceId: 'workspace-org',
    })

    const legacyResult = await checkStorageQuota('workspace-owner', GIB / 2)
    const contextResult = await checkStorageQuotaForBillingContext(ORG_CONTEXT, GIB / 2)

    const expected = {
      allowed: false,
      currentUsage: GIB,
      error: 'Storage limit exceeded. Used: 1.50GB, Limit: 1GB',
      limit: GIB,
    }
    expect(legacyResult).toEqual(expected)
    expect(contextResult).toEqual(expected)
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(1)
  })

  it('applies identical disabled-billing behavior without resolving context', async () => {
    mockFlags.isBillingEnabled = false

    const expected = {
      allowed: true,
      currentUsage: 0,
      limit: Number.MAX_SAFE_INTEGER,
    }
    await expect(checkStorageQuota('workspace-owner', GIB)).resolves.toEqual(expected)
    await expect(checkStorageQuotaForBillingContext(ORG_CONTEXT, GIB)).resolves.toEqual(expected)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('opts into free-tier enforcement when FREE_STORAGE_LIMIT_GB is explicitly set', async () => {
    mockFlags.isBillingEnabled = false
    mockGetEnv.mockImplementation((variable: string) =>
      variable === 'FREE_STORAGE_LIMIT_GB' ? '1' : undefined
    )
    mockLimit.mockResolvedValue([{ storageUsedBytes: GIB }])

    await expect(checkStorageQuota('workspace-owner', GIB / 2)).resolves.toEqual({
      allowed: false,
      currentUsage: GIB,
      error: 'Storage limit exceeded. Used: 1.50GB, Limit: 1GB',
      limit: GIB,
    })
  })

  it('fails closed with the exact fallback when either context resolution fails', async () => {
    const expected = {
      allowed: false,
      currentUsage: 0,
      error: 'Failed to check storage quota',
      limit: 0,
    }

    mockGetHighestPrioritySubscription.mockRejectedValueOnce(new Error('subscription unavailable'))
    await expect(checkStorageQuota('workspace-owner', GIB)).resolves.toEqual(expected)

    mockLimit.mockRejectedValueOnce(new Error('counter unavailable'))
    await expect(checkStorageQuotaForBillingContext(ORG_CONTEXT, GIB)).resolves.toEqual(expected)
  })

  it('retains zero fallback for direct usage readers', async () => {
    mockLimit.mockRejectedValueOnce(new Error('counter unavailable'))

    await expect(getStorageUsageForBillingContext(ORG_CONTEXT)).resolves.toBe(0)
  })
})
