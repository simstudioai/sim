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
    mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(async () => ({ deleted: 0, failed: 0 })),
    mockDeleteFileMetadata: vi.fn(async () => true),
    mockDeleteFiles: vi.fn(async () => ({ deleted: 0, failed: [] as Array<{ key: string }> })),
    mockDeleteRowsById: vi.fn(async () => ({ deleted: 0, failed: 0 })),
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
    a2aAgent: table(softCols),
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
