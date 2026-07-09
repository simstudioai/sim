/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBatchDeleteByWorkspaceAndTimestamp,
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockDeleteRowsById,
  mockIsUsingCloudStorage,
  mockLimit,
  mockOrderBy,
  mockPrepareChatCleanup,
  mockSelect,
  mockSelectRowsByIdChunks,
  mockTask,
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

  return {
    mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(
      async (_opts: {
        tableName: string
        onBatch?: (rows: Array<{ id: string }>) => Promise<void>
      }) => ({ deleted: 0, failed: 0 })
    ),
    mockDeleteFileMetadata: vi.fn(async () => true),
    mockDeleteFiles: vi.fn(async () => ({ deleted: 0, failed: [] as Array<{ key: string }> })),
    mockDeleteRowsById: vi.fn(async (..._args: unknown[]) => ({ deleted: 0, failed: 0 })),
    mockIsUsingCloudStorage: vi.fn(() => true),
    mockLimit,
    mockOrderBy,
    mockPrepareChatCleanup: vi.fn(async () => ({ execute: vi.fn(async () => undefined) })),
    mockSelect,
    mockSelectRowsByIdChunks: vi.fn(async () => [] as unknown[]),
    mockTask: vi.fn((config: unknown) => config),
    mockWhere,
  }
})

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))

vi.mock('@sim/db/schema', () => {
  const table = (cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, `col.${c}`])) as Record<string, string>
  const wsFileCols = ['id', 'key', 'context', 'workspaceId', 'deletedAt', 'uploadedAt']
  const softCols = ['id', 'archivedAt', 'deletedAt', 'workspaceId']
  return {
    copilotChats: table(['id', 'workflowId']),
    document: table(['id', 'storageKey', 'knowledgeBaseId']),
    embedding: table(['id', 'knowledgeBaseId', 'documentId']),
    knowledgeBase: table(softCols),
    mcpServers: table(softCols),
    memory: table(softCols),
    userTableDefinitions: table(softCols),
    userTableRows: table(['id', 'tableId']),
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
  DEFAULT_BATCH_SIZE: 2000,
  DEFAULT_WORKSPACE_CHUNK_SIZE: 50,
  batchDeleteByWorkspaceAndTimestamp: mockBatchDeleteByWorkspaceAndTimestamp,
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

describe('cleanup soft deletes — orphan KB binding sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockLimit.mockResolvedValue([])
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

describe('cleanup soft deletes — cascade pre-drain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockLimit.mockResolvedValue([])
  })

  /** Runs the job once and returns the onBatch hook wired for the given target. */
  async function captureOnBatch(name: string) {
    await runCleanupSoftDeletes(basePayload)
    const call = mockBatchDeleteByWorkspaceAndTimestamp.mock.calls.find(
      ([opts]) => opts.tableName === `free/1/${name}`
    )
    expect(call).toBeDefined()
    return call![0].onBatch
  }

  it('knowledgeBase drains embedding then document rows before the KB delete', async () => {
    const onBatch = await captureOnBatch('knowledgeBase')
    expect(onBatch).toBeDefined()

    vi.clearAllMocks()
    mockDeleteRowsById.mockResolvedValue({ deleted: 1, failed: 0 })
    // embedding: one page then drained; document: one page then drained.
    mockLimit
      .mockResolvedValueOnce([{ id: 'emb-1' }] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'doc-1' }] as never)
      .mockResolvedValueOnce([])

    await onBatch!([{ id: 'kb-1' }])

    expect(mockDeleteRowsById).toHaveBeenCalledTimes(2)
    expect(mockDeleteRowsById.mock.calls[0][2]).toEqual(['emb-1'])
    expect(mockDeleteRowsById.mock.calls[0][3]).toBe('free/1/knowledgeBase/embedding')
    expect(mockDeleteRowsById.mock.calls[1][2]).toEqual(['doc-1'])
    expect(mockDeleteRowsById.mock.calls[1][3]).toBe('free/1/knowledgeBase/document')
  })

  it('userTableDefinitions drains user_table_rows before the definition delete', async () => {
    const onBatch = await captureOnBatch('userTableDefinitions')
    expect(onBatch).toBeDefined()

    vi.clearAllMocks()
    mockDeleteRowsById.mockResolvedValue({ deleted: 1, failed: 0 })
    mockLimit.mockResolvedValueOnce([{ id: 'row-1' }] as never).mockResolvedValueOnce([])

    await onBatch!([{ id: 'tbl-1' }])

    expect(mockDeleteRowsById).toHaveBeenCalledTimes(1)
    expect(mockDeleteRowsById.mock.calls[0][2]).toEqual(['row-1'])
    expect(mockDeleteRowsById.mock.calls[0][3]).toBe('free/1/userTableDefinitions/userTableRows')
  })

  it('throws when child deletion makes no progress so the parent delete is skipped', async () => {
    const onBatch = await captureOnBatch('knowledgeBase')

    vi.clearAllMocks()
    mockDeleteRowsById.mockResolvedValue({ deleted: 0, failed: 1 })
    mockLimit.mockResolvedValue([{ id: 'emb-stuck' }] as never)

    await expect(onBatch!([{ id: 'kb-1' }])).rejects.toThrow(/no progress/)
    expect(mockDeleteRowsById).toHaveBeenCalledTimes(1)
  })

  it('targets without a large cascade pass no onBatch hook', async () => {
    await runCleanupSoftDeletes(basePayload)
    const call = mockBatchDeleteByWorkspaceAndTimestamp.mock.calls.find(
      ([opts]) => opts.tableName === 'free/1/memory'
    )
    expect(call).toBeDefined()
    expect(call![0].onBatch).toBeUndefined()
  })
})
