import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => billingStorageMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)

import type { DbOrTx } from '@/lib/db/types'
import {
  assertForkStorageHeadroom,
  sumForkCopyBytes,
} from '@/ee/workspace-forking/lib/copy/storage-quota'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

const { mockCheckStorageQuotaForBillingContext, mockResolveStorageBillingContext } =
  billingStorageMockFns
const { mockGetOrganizationSubscription } = billingCoreMockFns
const { mockGetHighestPriorityPersonalSubscription } = billingPlanMockFns

function makeExecutor(total: number | string | null) {
  const execute = vi.fn((_query: unknown) => Promise.resolve([{ total }]))
  return { executor: { execute } as unknown as DbOrTx, execute }
}

describe('sumForkCopyBytes', () => {
  it('coerces driver string aggregates (bigint sums) to numbers', async () => {
    const { executor } = makeExecutor('1024')

    const bytes = await sumForkCopyBytes(executor, 'src-ws', { fileKeys: ['workspace/src/k1'] })

    expect(bytes).toBe(1024)
  })

  it('fails closed when a selected workspace file lacks canonical size metadata', async () => {
    const { executor } = makeExecutor(null)

    await expect(
      sumForkCopyBytes(executor, 'src-ws', { fileIds: ['wf-missing-size'] })
    ).rejects.toMatchObject({
      message: 'Storage calculation is temporarily unavailable',
      statusCode: 503,
    })
  })
})

describe('assertForkStorageHeadroom', () => {
  const targetContext = {
    workspaceId: 'target-ws',
    billedAccountUserId: 'target-payer',
    billingEntity: { type: 'user', id: 'target-payer' },
    plan: 'pro',
    customStorageLimitGB: null,
  } as const

  beforeEach(() => {
    mockResolveStorageBillingContext.mockResolvedValue(targetContext)
  })

  it('checks sync headroom against the actual target workspace payer, never the actor', async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: true,
      currentUsage: 10,
      limit: 100,
    })

    await expect(
      assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 50 })
    ).resolves.toBeUndefined()
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('target-ws')
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(targetContext, 50)
  })

  it("throws a 413 ForkError carrying the upload path's quota message when over quota", async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: false,
      currentUsage: 99,
      limit: 100,
      error: 'Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })

    const rejection = expect(
      assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 50 })
    ).rejects
    await rejection.toBeInstanceOf(ForkError)
    await rejection.toMatchObject({
      statusCode: 413,
      message:
        'Not enough storage to copy the selected resources. Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })
  })

  it('derives a not-yet-created fork payer from the creation policy', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      plan: 'team',
      metadata: { customStorageLimitGB: 250 },
    })
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: true,
      currentUsage: 10,
      limit: 100,
    })

    await assertForkStorageHeadroom({
      plannedWorkspaceId: 'planned-child-ws',
      creationPolicy: {
        workspaceMode: 'organization',
        organizationId: 'target-org',
        billedAccountUserId: 'target-org-owner',
      },
      bytes: 50,
    })

    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('target-org', {
      onError: 'throw',
    })
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(
      {
        workspaceId: 'planned-child-ws',
        billedAccountUserId: 'target-org-owner',
        billingEntity: { type: 'organization', id: 'target-org' },
        plan: 'team',
        customStorageLimitGB: 250,
      },
      50
    )
  })
})
