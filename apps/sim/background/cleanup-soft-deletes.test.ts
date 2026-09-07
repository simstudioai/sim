/**
 * @vitest-environment node
 */

import {
  dbChainMock,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBatchDeleteByWorkspaceAndTimestamp,
  mockChunkedBatchDelete,
  mockScopedChunkedBatchDelete,
  mockDecrementStorageUsageForBillingContextInTx,
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockDeleteRowsById,
  mockHardDeleteDocuments,
  mockIsUsingCloudStorage,
  mockKnowledgeBaseContainerDelete,
  mockPrepareChatCleanup,
  mockResolveStorageBillingContext,
  mockSelectRowsByIdChunks,
  mockDeduplicateWorkflowName,
  mockAllocateUniqueWorkspaceFileName,
  mockDeduplicateFolderName,
} = vi.hoisted(() => ({
  mockDeduplicateFolderName: vi.fn(async (_tx, _ws, _parent, name: string) => name),
  mockDeduplicateWorkflowName: vi.fn(async (name: string) => name),
  mockAllocateUniqueWorkspaceFileName: vi.fn(async (_ws: string, name: string) => name),
  mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  mockChunkedBatchDelete: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  mockScopedChunkedBatchDelete: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(async () => undefined),
  mockDeleteFileMetadata: vi.fn(async () => true),
  mockDeleteFiles: vi.fn(async () => ({ deleted: 0, failed: [] as Array<{ key: string }> })),
  mockDeleteRowsById: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  mockHardDeleteDocuments: vi.fn(async (ids: string[]) => ids.length),
  mockIsUsingCloudStorage: vi.fn(() => true),
  mockKnowledgeBaseContainerDelete: vi.fn(),
  mockPrepareChatCleanup: vi.fn(async () => ({ execute: vi.fn(async () => undefined) })),
  mockResolveStorageBillingContext: vi.fn(),
  mockSelectRowsByIdChunks: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@/lib/cleanup/batch-delete', () => ({
  batchDeleteByWorkspaceAndTimestamp: mockBatchDeleteByWorkspaceAndTimestamp,
  chunkedBatchDelete: mockChunkedBatchDelete,
  chunkedBatchDeleteByScope: mockScopedChunkedBatchDelete,
  DEFAULT_DELETE_CHUNK_SIZE: 1000,
  deleteRowsById: mockDeleteRowsById,
  selectRowsByIdChunks: mockSelectRowsByIdChunks,
}))

vi.mock('@/lib/cleanup/chat-cleanup', () => ({ prepareChatCleanup: mockPrepareChatCleanup }))

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: mockHardDeleteDocuments,
}))

vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: mockIsUsingCloudStorage,
  StorageService: { deleteFiles: mockDeleteFiles },
}))

vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: mockDeleteFileMetadata }))

vi.mock('@/lib/workflows/utils', () => ({
  deduplicateWorkflowName: mockDeduplicateWorkflowName,
}))

vi.mock('@/lib/folders/naming', () => ({ deduplicateFolderName: mockDeduplicateFolderName }))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  allocateUniqueWorkspaceFileName: mockAllocateUniqueWorkspaceFileName,
}))

import { runCleanupSoftDeletes } from '@/background/cleanup-soft-deletes'

const basePayload = {
  label: 'free/1',
  plan: 'free' as const,
  retentionHours: 720,
  workspaceIds: ['ws-1'],
}

describe('cleanup soft deletes', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockSelectRowsByIdChunks.mockReset().mockResolvedValue([])
    mockDeleteFiles.mockReset().mockResolvedValue({ deleted: 0, failed: [] })
    mockChunkedBatchDelete.mockReset().mockResolvedValue({ deleted: 0, failed: 0 })
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'ws-1',
      billedAccountUserId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      plan: 'free',
      customStorageLimitGB: null,
    })
  })

  it('keeps metadata rows whose object deletion failed', async () => {
    mockSelectRowsByIdChunks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'file-failed',
          key: 'workspace/ws-1/file-failed',
          workspaceId: 'ws-1',
          context: 'workspace',
          sizeBytes: 11,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({
      deleted: 0,
      failed: [{ key: 'workspace/ws-1/file-failed', error: 'storage unavailable' }],
    })

    await runCleanupSoftDeletes(basePayload)

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(
      mockDeleteRowsById.mock.calls.some(([, , ids]) => (ids as string[]).includes('file-failed'))
    ).toBe(false)
  })

  it('decrements the current workspace payer only for rows conditionally deleted', async () => {
    mockSelectRowsByIdChunks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'file-deleted',
          key: 'workspace/ws-1/file-deleted',
          workspaceId: 'ws-1',
          context: 'workspace',
          sizeBytes: 7,
        },
        {
          id: 'file-restored',
          key: 'workspace/ws-1/file-restored',
          workspaceId: 'ws-1',
          context: 'workspace',
          sizeBytes: 13,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 2, failed: [] })
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'file-deleted', sizeBytes: 7 }])

    await runCleanupSoftDeletes(basePayload)

    expect(mockResolveStorageBillingContext).toHaveBeenCalledOnce()
    expect(mockDecrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      dbChainMock.db,
      expect.objectContaining({ workspaceId: 'ws-1' }),
      7
    )
    expect(mockDeleteFiles.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
  })

  it('hard-deletes mothership metadata without touching stored-byte counters', async () => {
    mockSelectRowsByIdChunks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'chat-file',
          key: 'mothership/chat-file',
          workspaceId: 'ws-1',
          context: 'mothership',
          sizeBytes: 17,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 1, failed: [] })
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'chat-file' }])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).toHaveBeenCalledWith(['mothership/chat-file'], 'mothership')
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })

  it('fails before deleting storage when canonical size metadata is missing', async () => {
    mockSelectRowsByIdChunks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'file-missing-size',
          key: 'workspace/ws-1/file-missing-size',
          workspaceId: 'ws-1',
          context: 'workspace',
          sizeBytes: null,
        },
      ])

    await expect(runCleanupSoftDeletes(basePayload)).rejects.toThrow(
      'Workspace file is missing canonical size_bytes metadata'
    )
    expect(mockDeleteFiles).not.toHaveBeenCalled()
  })

  it('hard-deletes retained documents before deleting an expired knowledge base', async () => {
    mockChunkedBatchDelete.mockImplementationOnce(
      async (options: {
        onBatch?: (rows: Array<{ id: string }>) => Promise<void>
        tableName: string
      }) => {
        expect(options.tableName).toBe('free/1/knowledgeBase')
        await options.onBatch?.([{ id: 'kb-1' }])
        mockKnowledgeBaseContainerDelete()
        return { deleted: 1, failed: 0 }
      }
    )
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'doc-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runCleanupSoftDeletes(basePayload)

    expect(mockHardDeleteDocuments).toHaveBeenCalledWith(['doc-1'], 'free/1/knowledgeBase')
    expect(mockHardDeleteDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      mockKnowledgeBaseContainerDelete.mock.invocationCallOrder[0]
    )
  })

  it('soft-deletes abandoned KB bindings and removes their storage objects', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ key: 'kb/orphan-1' }, { key: 'kb/orphan-2' }])
      .mockResolvedValueOnce([])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).toHaveBeenCalledWith(['kb/orphan-1', 'kb/orphan-2'], 'knowledge-base')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-1')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-2')
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(2)
  })

  it('keeps an orphan KB binding when its object deletion fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ key: 'kb/orphan-retry' }])
    mockDeleteFiles.mockResolvedValueOnce({
      deleted: 0,
      failed: [{ key: 'kb/orphan-retry', error: 'storage unavailable' }],
    })

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })

  it('still removes bindings but skips object deletion without cloud storage', async () => {
    mockIsUsingCloudStorage.mockReturnValue(false)
    dbChainMockFns.limit.mockResolvedValueOnce([{ key: 'kb/orphan-1' }]).mockResolvedValueOnce([])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-1')
  })

  it('stops the batch loop when binding deletion makes no progress', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ key: 'kb/stuck' }])
    mockDeleteFileMetadata.mockRejectedValue(new Error('db down'))

    await runCleanupSoftDeletes(basePayload)

    // One batch attempted, then the no-progress guard breaks the loop.
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(1)
  })

  it('does not run the sweep when there are no workspaces', async () => {
    await runCleanupSoftDeletes({ ...basePayload, workspaceIds: [] })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockDeleteFiles).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })
})

interface BatchDeleteOptions {
  tableDef: unknown
  workspaceIdCol: unknown
  timestampCol: unknown
  tableName: string
  requireTimestampNotNull?: boolean
  additionalPredicate?: { type: string; column: unknown; values: unknown[] }
  onBatch?: (rows: { id: string }[]) => Promise<void>
}

/**
 * The `folder` table is shared by all four foldered resource types and is the one cleanup
 * target carrying an `additionalPredicate`. That predicate is the only thing standing
 * between this sweep and hard-deleting rows of a resource type whose cutover has not landed.
 */
describe('folder cleanup target', () => {
  async function runAndFindFolderTarget(): Promise<BatchDeleteOptions | undefined> {
    await runCleanupSoftDeletes(basePayload)
    const calls = mockBatchDeleteByWorkspaceAndTimestamp.mock.calls as unknown as Array<
      [BatchDeleteOptions]
    >
    return calls.find(([options]) => options.tableName === 'free/1/folder')?.[0]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockSelectRowsByIdChunks.mockReset().mockResolvedValue([])
    mockChunkedBatchDelete.mockReset().mockResolvedValue({ deleted: 0, failed: 0 })
  })

  it('sweeps expired folder rows off the folder table, keyed on its soft-delete column', async () => {
    const target = await runAndFindFolderTarget()

    expect(target).toBeDefined()
    expect(target?.tableDef).toBe(schemaMock.folder)
    expect(target?.timestampCol).toBe(schemaMock.folder.deletedAt)
    expect(target?.workspaceIdCol).toBe(schemaMock.folder.workspaceId)
    // Without this, a folder whose deletedAt is null would be swept by the retention cutoff.
    expect(target?.requireTimestampNotNull).toBe(true)
  })

  it('narrows the folder sweep to the resource types whose cutover has landed', async () => {
    // Regression guard for "simplifying" the predicate away: `folder` is one table shared by
    // every resource type, so an unfiltered sweep would hard-delete rows belonging to a type
    // added to the enum before its own delete/restore path exists.
    const target = await runAndFindFolderTarget()

    expect(target?.additionalPredicate).toBeDefined()
    expect(target?.additionalPredicate?.type).toBe('inArray')
    expect(target?.additionalPredicate?.column).toBe(schemaMock.folder.resourceType)
    expect(target?.additionalPredicate?.values).toEqual([
      'workflow',
      'file',
      'knowledge_base',
      'table',
    ])
  })

  it('leaves every other cleanup target unfiltered so only folder pays for the predicate', async () => {
    await runCleanupSoftDeletes(basePayload)
    const calls = mockBatchDeleteByWorkspaceAndTimestamp.mock.calls as unknown as Array<
      [BatchDeleteOptions]
    >

    const filtered = calls
      .filter(([options]) => options.additionalPredicate !== undefined)
      .map(([options]) => options.tableName)
    expect(filtered).toEqual(['free/1/folder'])
  })

  /**
   * `folder_id` is `ON DELETE SET NULL`, so Postgres re-roots surviving children on its own —
   * but `workflow` and `workspace_files` each carry a partial unique index keyed on
   * `coalesce(folder_id, '')`, so an implicit SET NULL can land a child on a name the workspace
   * root already holds. That aborts the whole DELETE with a 23505, which `chunkedBatchDelete`
   * turns into `hasMore = false` — folder retention then stalls permanently for that chunk,
   * re-failing on every later run. `onBatch` renames first so the SET NULL is a no-op.
   */
  describe('re-rooting active children before the delete', () => {
    async function getFolderOnBatch() {
      const target = await runAndFindFolderTarget()
      expect(target?.onBatch).toBeTypeOf('function')
      return target!.onBatch!
    }

    it('is the only cleanup target that re-roots children', async () => {
      await runCleanupSoftDeletes(basePayload)
      const calls = mockBatchDeleteByWorkspaceAndTimestamp.mock.calls as unknown as Array<
        [BatchDeleteOptions]
      >

      const withOnBatch = calls
        .filter(([options]) => options.onBatch !== undefined)
        .map(([options]) => options.tableName)
      expect(withOnBatch).toEqual(['free/1/folder'])
    })

    it('re-roots an active workflow under a deduplicated name', async () => {
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, [{ id: 'folder-1' }])
      queueTableRows(schemaMock.workflow, [{ id: 'w1', name: 'Report', workspaceId: 'ws-1' }])
      queueTableRows(schemaMock.workspaceFiles, [])
      mockDeduplicateWorkflowName.mockResolvedValueOnce('Report (2)')

      await onBatch([{ id: 'folder-1' }])

      // Deduped against the workspace ROOT (folderId null), which is where SET NULL would put it.
      expect(mockDeduplicateWorkflowName).toHaveBeenCalledWith(
        'Report',
        'ws-1',
        null,
        expect.anything()
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ folderId: null, name: 'Report (2)' })
    })

    it('re-roots an active workspace file under a deduplicated name', async () => {
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, [{ id: 'folder-1' }])
      queueTableRows(schemaMock.workflow, [])
      queueTableRows(schemaMock.workspaceFiles, [
        { id: 'f1', originalName: 'report.pdf', workspaceId: 'ws-1' },
      ])
      mockAllocateUniqueWorkspaceFileName.mockResolvedValueOnce('report (2).pdf')

      await onBatch([{ id: 'folder-1' }])

      expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledWith('ws-1', 'report.pdf', null)
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        folderId: null,
        originalName: 'report (2).pdf',
      })
    })

    it('falls back to an id-suffixed name when the copy-suffix range is exhausted', async () => {
      // Letting the allocator throw would abort the sweep — the exact stall this guards against.
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, [{ id: 'folder-1' }])
      queueTableRows(schemaMock.workflow, [])
      queueTableRows(schemaMock.workspaceFiles, [
        { id: 'f1', originalName: 'report.pdf', workspaceId: 'ws-1' },
      ])
      mockAllocateUniqueWorkspaceFileName.mockRejectedValueOnce(new Error('conflict'))

      await expect(onBatch([{ id: 'folder-1' }])).resolves.toBeUndefined()

      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        folderId: null,
        originalName: 'report.pdf (f1)',
      })
    })

    it('re-roots an active SUBFOLDER, which hits the same unique index', async () => {
      /**
       * `folder.parentId` is also ON DELETE SET NULL and
       * `folder_workspace_resource_parent_name_active_unique` keys on `coalesce(parent_id,'')`,
       * so purging a parent can collide a surviving child at the root exactly like a workflow
       * or file. Covering only those two would leave the class half-closed.
       */
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, [{ id: 'folder-1' }])
      queueTableRows(schemaMock.workflow, [])
      queueTableRows(schemaMock.workspaceFiles, [])
      queueTableRows(schemaMock.folder, [
        { id: 'sub-1', name: 'Reports', workspaceId: 'ws-1', resourceType: 'knowledge_base' },
      ])
      mockDeduplicateFolderName.mockResolvedValueOnce('Reports (1)')

      await onBatch([{ id: 'folder-1' }])

      // Deduped against the ROOT of the child's OWN resourceType, which is where SET NULL lands it.
      expect(mockDeduplicateFolderName).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        null,
        'Reports',
        'knowledge_base'
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ parentId: null, name: 'Reports (1)' })
    })

    it('recovers when the allocator RETURNS a colliding name and the update raises', async () => {
      /**
       * `allocateUniqueWorkspaceFileName` fails open — `fileExistsInWorkspace` swallows query
       * errors and returns false — so it can hand back a name already taken at the root. Only
       * the UPDATE discovers that, and an uncaught 23505 aborts the batch: the exact stall this
       * hook prevents. Guarding the name lookup alone is not enough.
       */
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, [{ id: 'folder-1' }])
      queueTableRows(schemaMock.workflow, [])
      queueTableRows(schemaMock.workspaceFiles, [
        { id: 'f1', originalName: 'report.pdf', workspaceId: 'ws-1' },
      ])
      mockAllocateUniqueWorkspaceFileName.mockResolvedValueOnce('taken.pdf')
      dbChainMockFns.update.mockImplementationOnce(() => ({
        set: () => ({ where: () => Promise.reject(new Error('duplicate key value (23505)')) }),
      }))

      await expect(onBatch([{ id: 'folder-1' }])).resolves.toBeUndefined()

      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        folderId: null,
        originalName: 'report.pdf (f1)',
      })
    })

    it('leaves children alone when the folder was restored between select and onBatch', async () => {
      /**
       * The DELETE re-asserts eligibility and so correctly skips a restored folder. Without the
       * same re-assertion here, this hook would still strip and rename that folder's children —
       * leaving a live folder emptied out. This is the one side effect in the sweep that mutates
       * rows which survive, so losing the race is user-visible.
       */
      const onBatch = await getFolderOnBatch()
      queueTableRows(schemaMock.folder, []) // restored: no longer soft-deleted past retention
      // Children ARE queued: without the eligibility re-check these would be re-rooted and
      // renamed, so the assertions below fail rather than passing for want of candidate rows.
      queueTableRows(schemaMock.workflow, [{ id: 'w1', name: 'Report', workspaceId: 'ws-1' }])
      queueTableRows(schemaMock.workspaceFiles, [
        { id: 'f1', originalName: 'report.pdf', workspaceId: 'ws-1' },
      ])
      dbChainMockFns.update.mockClear()

      await onBatch([{ id: 'folder-1' }])

      expect(mockDeduplicateWorkflowName).not.toHaveBeenCalled()
      expect(mockAllocateUniqueWorkspaceFileName).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('touches nothing when the batch is empty', async () => {
      const onBatch = await getFolderOnBatch()
      dbChainMockFns.select.mockClear()
      dbChainMockFns.update.mockClear()

      await onBatch([])

      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })
  })
})

describe('organization-owned Search retention cleanup', () => {
  const organizationPayload = {
    plan: 'enterprise' as const,
    label: 'enterprise/organization/org-1',
    workspaceIds: [],
    organizationIds: ['org-1'],
    retentionHours: 72,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockDeleteFiles.mockResolvedValue({ deleted: 0, failed: [] })
    mockSelectRowsByIdChunks.mockImplementation(async (ids, query) =>
      ids.length ? query(ids, 500) : []
    )
    mockScopedChunkedBatchDelete.mockResolvedValue({ deleted: 0, failed: 0 })
  })

  it('selects only organization-owned cache, private chats, and knowledge bases', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      {
        id: 'org-file',
        key: 'knowledge-base/org-key',
        workspaceId: null,
        context: 'knowledge-base',
        sizeBytes: 10,
      },
    ])
    queueTableRows(schemaMock.workspaceFiles, [])
    queueTableRows(schemaMock.copilotChats, [{ id: 'org-chat' }])
    await runCleanupSoftDeletes(organizationPayload)
    expect(mockDeleteFiles).toHaveBeenCalledWith(['knowledge-base/org-key'], 'knowledge-base')
    expect(mockPrepareChatCleanup).toHaveBeenCalledWith(['org-chat'], organizationPayload.label)
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockBatchDeleteByWorkspaceAndTimestamp).not.toHaveBeenCalled()
    expect(mockChunkedBatchDelete).not.toHaveBeenCalled()
    expect(mockScopedChunkedBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({ scopeIds: ['org-1'] })
    )
    for (const table of [schemaMock.workspaceFiles, schemaMock.copilotChats]) {
      expect(
        dbChainMockFns.where.mock.calls.some(
          ([predicate]) =>
            hasMockCondition(
              predicate,
              (item) =>
                item.type === 'inArray' &&
                item.column === table.organizationId &&
                item.values.includes('org-1')
            ) &&
            hasMockCondition(
              predicate,
              (item) => item.type === 'isNull' && item.column === table.workspaceId
            )
        )
      ).toBe(true)
    }
    const options = mockScopedChunkedBatchDelete.mock.calls[0][0] as {
      selectChunk: (ids: string[], limit: number) => Promise<unknown>
      deleteFilter: unknown
    }
    await options.selectChunk(['org-1'], 100)
    for (const predicate of [dbChainMockFns.where.mock.calls.at(-1)?.[0], options.deleteFilter]) {
      expect(
        hasMockCondition(
          predicate,
          (item) =>
            item.type === 'inArray' &&
            item.column === schemaMock.knowledgeBase.organizationId &&
            item.values.includes('org-1')
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          predicate,
          (item) => item.type === 'isNull' && item.column === schemaMock.knowledgeBase.workspaceId
        )
      ).toBe(true)
    }
  })

  it('keeps failed organization cache objects bound for the next cleanup attempt', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      {
        id: 'org-file',
        key: 'knowledge-base/org-key',
        workspaceId: null,
        context: 'knowledge-base',
        sizeBytes: 10,
      },
    ])
    queueTableRows(schemaMock.workspaceFiles, [])
    mockDeleteFiles.mockResolvedValue({
      deleted: 0,
      failed: [{ key: 'knowledge-base/org-key', error: 'storage unavailable' }],
    })
    await runCleanupSoftDeletes(organizationPayload)
    expect(
      dbChainMockFns.delete.mock.calls.some(([table]) => table === schemaMock.workspaceFiles)
    ).toBe(false)
  })

  it('sweeps orphaned organization cache bindings without a workspace payer', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])
    queueTableRows(schemaMock.workspaceFiles, [{ key: 'knowledge-base/orphan' }])
    queueTableRows(schemaMock.workspaceFiles, [])
    await runCleanupSoftDeletes(organizationPayload)
    expect(mockDeleteFiles).toHaveBeenCalledWith(['knowledge-base/orphan'], 'knowledge-base')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('knowledge-base/orphan')
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous batch before reading or deleting resources', async () => {
    await expect(
      runCleanupSoftDeletes({ ...organizationPayload, workspaceIds: ['ws-1'] })
    ).rejects.toThrow('not both')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockDeleteFiles).not.toHaveBeenCalled()
  })
})
