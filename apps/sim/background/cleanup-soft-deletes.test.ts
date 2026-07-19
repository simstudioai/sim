/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBatchDeleteByWorkspaceAndTimestamp,
  mockChunkedBatchDelete,
  mockDecrementStorageUsageForBillingContextInTx,
  mockDelete,
  mockDeleteReturning,
  mockDeleteWhere,
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockDeleteRowsById,
  mockHardDeleteDocuments,
  mockIsUsingCloudStorage,
  mockKnowledgeBaseContainerDelete,
  mockLimit,
  mockOrderBy,
  mockPrepareChatCleanup,
  mockResolveStorageBillingContext,
  mockSelect,
  mockSelectRowsByIdChunks,
  mockTask,
  mockTransaction,
  mockWhere,
} = vi.hoisted(() => {
  const mockLimit = vi.fn(async () => [] as Array<{ key: string }>)
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
  const mockFrom = vi.fn(() => ({
    where: mockWhere,
    leftJoin: vi.fn(() => ({ where: mockWhere })),
  }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  const mockDeleteReturning = vi.fn(async () => [] as Array<{ id: string; size?: number }>)
  const mockDeleteWhere = vi.fn(() => ({ returning: mockDeleteReturning }))
  const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }))
  const mockKnowledgeBaseContainerDelete = vi.fn()
  const mockChunkedBatchDelete = vi.fn(async () => ({ deleted: 0, failed: 0 }))

  return {
    mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(async () => ({ deleted: 0, failed: 0 })),
    mockChunkedBatchDelete,
    mockDecrementStorageUsageForBillingContextInTx: vi.fn(async () => undefined),
    mockDelete,
    mockDeleteReturning,
    mockDeleteWhere,
    mockDeleteFileMetadata: vi.fn(async () => true),
    mockDeleteFiles: vi.fn(async () => ({ deleted: 0, failed: [] as Array<{ key: string }> })),
    mockDeleteRowsById: vi.fn(async () => ({ deleted: 0, failed: 0 })),
    mockHardDeleteDocuments: vi.fn(async (ids: string[]) => ids.length),
    mockIsUsingCloudStorage: vi.fn(() => true),
    mockKnowledgeBaseContainerDelete,
    mockLimit,
    mockOrderBy,
    mockPrepareChatCleanup: vi.fn(async () => ({ execute: vi.fn(async () => undefined) })),
    mockResolveStorageBillingContext: vi.fn(),
    mockSelect,
    mockSelectRowsByIdChunks: vi.fn(async () => [] as unknown[]),
    mockTask: vi.fn((config: unknown) => config),
    mockTransaction: vi.fn(),
    mockWhere,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    delete: mockDelete,
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => {
  const table = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, `col.${c}`])) as Record<string, string>
  const wsFileCols = ['id', 'key', 'context', 'size', 'workspaceId', 'deletedAt', 'uploadedAt']
  const softCols = ['id', 'archivedAt', 'deletedAt', 'workspaceId']
  return {
    copilotChats: table(['id', 'workflowId']),
    document: table(['id', 'storageKey', 'knowledgeBaseId']),
    knowledgeBase: table(softCols),
    mcpServers: table(softCols),
    memory: table(softCols),
    userTableDefinitions: table(softCols),
    workflow: table(softCols),
    workflowFolder: table(softCols),
    workflowMcpServer: table(softCols),
    workspaceFile: table(wsFileCols),
    workspaceFiles: table(wsFileCols),
  }
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  asc: vi.fn((column: unknown) => ({ op: 'asc', column })),
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ op: 'isNotNull', args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
  lt: vi.fn((...args: unknown[]) => ({ op: 'lt', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

vi.mock('@/lib/cleanup/batch-delete', () => ({
  batchDeleteByWorkspaceAndTimestamp: mockBatchDeleteByWorkspaceAndTimestamp,
  chunkedBatchDelete: mockChunkedBatchDelete,
  DEFAULT_DELETE_CHUNK_SIZE: 1000,
  chunkArray: (items: string[], size: number) => {
    const chunks: string[][] = []
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }
    return chunks
  },
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

import { runCleanupSoftDeletes } from '@/background/cleanup-soft-deletes'

const basePayload = {
  label: 'free/1',
  plan: 'free' as const,
  retentionHours: 720,
  workspaceIds: ['ws-1'],
}

describe('cleanup soft deletes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockLimit.mockReset().mockResolvedValue([])
    mockSelectRowsByIdChunks.mockReset().mockResolvedValue([])
    mockDeleteFiles.mockReset().mockResolvedValue({ deleted: 0, failed: [] })
    mockChunkedBatchDelete.mockReset().mockResolvedValue({ deleted: 0, failed: 0 })
    mockDeleteReturning.mockReset().mockResolvedValue([])
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'ws-1',
      billedAccountUserId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      plan: 'free',
      customStorageLimitGB: null,
    })
    mockTransaction
      .mockReset()
      .mockImplementation(async (callback: (tx: { delete: typeof mockDelete }) => unknown) =>
        callback({ delete: mockDelete })
      )
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
          size: 11,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({
      deleted: 0,
      failed: [{ key: 'workspace/ws-1/file-failed', error: 'storage unavailable' }],
    })

    await runCleanupSoftDeletes(basePayload)

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
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
          size: 7,
        },
        {
          id: 'file-restored',
          key: 'workspace/ws-1/file-restored',
          workspaceId: 'ws-1',
          context: 'workspace',
          size: 13,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 2, failed: [] })
    mockDeleteReturning.mockResolvedValueOnce([{ id: 'file-deleted', size: 7 }])

    await runCleanupSoftDeletes(basePayload)

    expect(mockResolveStorageBillingContext).toHaveBeenCalledOnce()
    expect(mockDecrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.objectContaining({ delete: mockDelete }),
      expect.objectContaining({ workspaceId: 'ws-1' }),
      7
    )
    expect(mockDeleteFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0]
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
          size: 17,
        },
      ])
    mockDeleteFiles.mockResolvedValueOnce({ deleted: 1, failed: [] })
    mockDeleteReturning.mockResolvedValueOnce([{ id: 'chat-file' }])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).toHaveBeenCalledWith(['mothership/chat-file'], 'mothership')
    expect(mockDelete).toHaveBeenCalled()
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockDecrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
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
    mockLimit
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
    mockLimit
      .mockResolvedValueOnce([{ key: 'kb/orphan-1' }, { key: 'kb/orphan-2' }])
      .mockResolvedValueOnce([])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).toHaveBeenCalledWith(['kb/orphan-1', 'kb/orphan-2'], 'knowledge-base')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-1')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-2')
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(2)
  })

  it('keeps an orphan KB binding when its object deletion fails', async () => {
    mockLimit.mockResolvedValueOnce([{ key: 'kb/orphan-retry' }])
    mockDeleteFiles.mockResolvedValueOnce({
      deleted: 0,
      failed: [{ key: 'kb/orphan-retry', error: 'storage unavailable' }],
    })

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })

  it('still removes bindings but skips object deletion without cloud storage', async () => {
    mockIsUsingCloudStorage.mockReturnValue(false)
    mockLimit.mockResolvedValueOnce([{ key: 'kb/orphan-1' }]).mockResolvedValueOnce([])

    await runCleanupSoftDeletes(basePayload)

    expect(mockDeleteFiles).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/orphan-1')
  })

  it('stops the batch loop when binding deletion makes no progress', async () => {
    mockLimit.mockResolvedValue([{ key: 'kb/stuck' }])
    mockDeleteFileMetadata.mockRejectedValue(new Error('db down'))

    await runCleanupSoftDeletes(basePayload)

    // One batch attempted, then the no-progress guard breaks the loop.
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(1)
  })

  it('does not run the sweep when there are no workspaces', async () => {
    await runCleanupSoftDeletes({ ...basePayload, workspaceIds: [] })

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockDeleteFiles).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })
})
