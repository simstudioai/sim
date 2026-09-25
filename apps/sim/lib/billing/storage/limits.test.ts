import {
  dbChainMockFns,
  envMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'

const mockGetEnv = envMockFns.getEnv

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEq, mockGetHighestPrioritySubscription } = vi.hoisted(() => ({
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGetHighestPrioritySubscription: vi.fn(),
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

import type { StorageBillingContext } from '@/lib/billing/storage/context'
import { checkStorageQuota, checkStorageQuotaForBillingContext } from '@/lib/billing/storage/limits'

const ORG_CONTEXT: StorageBillingContext = {
  workspaceId: 'workspace-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization', id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: 1,
}

const GIB = 1024 ** 3

afterAll(resetEnvFlagsMock)

describe('storage limits and quota', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockGetEnv.mockReturnValue(undefined)
    dbChainMockFns.limit.mockResolvedValue([{ storageUsedBytes: 1024 }])
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns the exact same quota result for legacy and workspace organization payers', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ storageUsedBytes: GIB }])
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

  it('opts into free-tier enforcement when FREE_STORAGE_LIMIT_GB is explicitly set', async () => {
    setEnvFlags({ isBillingEnabled: false })
    mockGetEnv.mockImplementation((variable: string) =>
      variable === 'FREE_STORAGE_LIMIT_GB' ? '1' : undefined
    )
    dbChainMockFns.limit.mockResolvedValue([{ storageUsedBytes: GIB }])

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

    dbChainMockFns.limit.mockRejectedValueOnce(new Error('counter unavailable'))
    await expect(checkStorageQuotaForBillingContext(ORG_CONTEXT, GIB)).resolves.toEqual(expected)
  })
})
