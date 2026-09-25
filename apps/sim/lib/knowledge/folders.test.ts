import { dbChainMockFns, permissionsMock, permissionsMockFns, resetDbChainMock } from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/billing/storage', () => billingStorageMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

import {
  createKnowledgeBase,
  KnowledgeBaseFolderError,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'

const mockApplyStorageUsageDeltasInTx = billingStorageMockFns.mockApplyStorageUsageDeltasInTx
const mockEnsureUserStatsExists = billingUsageMockFns.mockEnsureUserStatsExists
const mockFindActiveFolder = folderQueriesMockFns.mockFindActiveFolder
const mockMaybeNotifyStorageLimitForBillingContext =
  billingStorageMockFns.mockMaybeNotifyStorageLimitForBillingContext
const mockResolveStorageBillingContext = billingStorageMockFns.mockResolveStorageBillingContext

const mockGetHighestPrioritySubscription =
  billingSubscriptionMockFns.mockGetHighestPrioritySubscription

const CREATE_INPUT = {
  name: 'Base',
  workspaceId: 'ws-1',
  userId: 'u-1',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536 as const,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
}

/**
 * `knowledge_base.folder_id` has a plain FK to `folder.id`, which proves nothing about the
 * workspace the folder belongs to or which resource tree it serves. These tests pin the
 * application-level admission that stands in for the missing constraint.
 */
describe('createKnowledgeBase — folder assignment', () => {
  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockFindActiveFolder.mockResolvedValue({ id: 'f-1' })
  })

  it('rejects a folder that is not an active knowledge_base folder in the workspace', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    await expect(
      createKnowledgeBase({ ...CREATE_INPUT, folderId: 'f-other-workspace' }, 'req-1')
    ).rejects.toBeInstanceOf(KnowledgeBaseFolderError)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('checks permission before touching the folder', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    await expect(
      createKnowledgeBase({ ...CREATE_INPUT, folderId: 'f-1' }, 'req-1')
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockFindActiveFolder).not.toHaveBeenCalled()
  })
})

describe('updateKnowledgeBase — folder moves', () => {
  /**
   * The mocked `@sim/db` cannot satisfy the post-transaction read-back select, so a
   * successful update still rejects after the transaction body commits.
   */
  const runIgnoringReadBack = (promise: Promise<unknown>) => promise.catch(() => undefined)

  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      { workspaceId: 'ws-1', userId: 'u-1', folderId: 'f-old' },
    ])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockFindActiveFolder.mockResolvedValue({ id: 'f-1' })
    mockResolveStorageBillingContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      billedAccountUserId: `${workspaceId}-owner`,
      billingEntity: { type: 'user', id: `${workspaceId}-owner` },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }))
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(100)
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('rejects a folder outside the knowledge base workspace', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    await expect(
      updateKnowledgeBase('kb-1', { folderId: 'f-foreign' }, 'req-1')
    ).rejects.toBeInstanceOf(KnowledgeBaseFolderError)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('validates a folder move that accompanies a workspace change against the destination', async () => {
    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-2', folderId: 'f-dest' }, 'req-1', {
        actorUserId: 'u-1',
      })
    )

    expect(mockFindActiveFolder).toHaveBeenCalledWith('f-dest', 'ws-2', 'knowledge_base')
  })
})
