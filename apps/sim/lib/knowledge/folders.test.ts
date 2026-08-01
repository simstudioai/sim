/**
 * @vitest-environment node
 */
import { dbChainMockFns, permissionsMock, permissionsMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyStorageUsageDeltasInTx,
  mockEnsureUserStatsExists,
  mockGetHighestPrioritySubscription,
  mockFindActiveFolder,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockEnsureUserStatsExists: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/folders/queries', () => ({
  findActiveFolder: mockFindActiveFolder,
}))
vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: mockApplyStorageUsageDeltasInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  ensureUserStatsExists: mockEnsureUserStatsExists,
}))

import {
  createKnowledgeBase,
  KnowledgeBaseFolderError,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'

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
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockFindActiveFolder.mockResolvedValue({ id: 'f-1' })
  })

  it('files the base under the requested folder', async () => {
    const created = await createKnowledgeBase({ ...CREATE_INPUT, folderId: 'f-1' }, 'req-1')

    expect(mockFindActiveFolder).toHaveBeenCalledWith('f-1', 'ws-1', 'knowledge_base')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'f-1', workspaceId: 'ws-1' })
    )
    expect(created.folderId).toBe('f-1')
  })

  it('creates at the workspace root when no folder is given, without a folder lookup', async () => {
    const created = await createKnowledgeBase(CREATE_INPUT, 'req-1')

    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
    expect(created.folderId).toBeNull()
  })

  it('normalizes an explicit null folder to the workspace root', async () => {
    const created = await createKnowledgeBase({ ...CREATE_INPUT, folderId: null }, 'req-1')

    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(created.folderId).toBeNull()
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
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_BASE_FORBIDDEN' })
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
    vi.clearAllMocks()
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

  it('writes the new folder against the current workspace', async () => {
    await runIgnoringReadBack(updateKnowledgeBase('kb-1', { folderId: 'f-new' }, 'req-1'))

    expect(mockFindActiveFolder).toHaveBeenCalledWith('f-new', 'ws-1', 'knowledge_base')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f-new' }))
  })

  it('moves the base to the workspace root on an explicit null', async () => {
    await runIgnoringReadBack(updateKnowledgeBase('kb-1', { folderId: null }, 'req-1'))

    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
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

  it('re-roots the base when its workspace changes and no folder is named', async () => {
    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-2' }, 'req-1', { actorUserId: 'u-1' })
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
  })

  it('leaves the folder alone when the workspace is unchanged', async () => {
    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-1' }, 'req-1', { actorUserId: 'u-1' })
    )

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
  })

  it('leaves the folder alone on a plain rename', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', userId: 'u-1', folderId: 'f-old' }]) // row lock
      .mockResolvedValueOnce([]) // duplicate-name check: none

    await runIgnoringReadBack(updateKnowledgeBase('kb-1', { name: 'Renamed' }, 'req-1'))

    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ folderId: expect.anything() })
    )
  })
})
