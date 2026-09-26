import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { envMockFns } from '@sim/testing/mocks/env.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import type { StorageBillingContext } from '@/lib/billing/storage/context'
import { checkStorageQuota, checkStorageQuotaForBillingContext } from '@/lib/billing/storage/limits'

const mockGetEnv = envMockFns.getEnv
const mockGetHighestPrioritySubscription =
  billingSubscriptionMockFns.mockGetHighestPrioritySubscription

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
