/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface CleanupRow {
  id: string
  files: unknown
}

interface CapturedBatchDeleteOptions {
  selectChunk: (chunkIds: string[], limit: number) => Promise<unknown>
  onBatch?: (rows: CleanupRow[]) => Promise<void>
  batchSize?: number
  maxBatches?: number
  totalRowLimit?: number
}

const {
  mockAnd,
  mockBatchDeleteByWorkspaceAndTimestamp,
  mockChunkedBatchDelete,
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockEq,
  mockExecute,
  mockFrom,
  mockInArray,
  mockIsNull,
  mockLeftJoin,
  mockLimit,
  mockLt,
  mockMarkLargeValuesDeleted,
  mockNotInArray,
  mockOr,
  mockOrderBy,
  mockPruneLargeValueMetadata,
  mockSelect,
  mockTask,
  mockWhere,
} = vi.hoisted(() => {
  const mockLimit = vi.fn(async () => [])
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
  const mockWhere = vi.fn(() => ({ limit: mockLimit, orderBy: mockOrderBy }))
  const mockLeftJoin = vi.fn(() => ({ where: mockWhere }))
  const mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin, where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))

  return {
    mockAnd: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(async () => ({
      table: 'job',
      deleted: 0,
      failed: 0,
    })),
    mockChunkedBatchDelete: vi.fn(),
    mockDeleteFileMetadata: vi.fn(async () => true),
    mockDeleteFiles: vi.fn(async () => ({ deleted: 2, failed: [] })),
    mockEq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
    mockExecute: vi.fn(),
    mockFrom,
    mockInArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
    mockIsNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
    mockLeftJoin,
    mockLimit,
    mockLt: vi.fn((...args: unknown[]) => ({ op: 'lt', args })),
    mockMarkLargeValuesDeleted: vi.fn(async () => undefined),
    mockNotInArray: vi.fn((...args: unknown[]) => ({ op: 'notInArray', args })),
    mockOr: vi.fn((...args: unknown[]) => ({ op: 'or', args })),
    mockOrderBy,
    mockPruneLargeValueMetadata: vi.fn(async () => ({
      referencesDeleted: 0,
      dependenciesDeleted: 0,
      tombstonesDeleted: 0,
    })),
    mockSelect,
    mockTask: vi.fn((config: unknown) => config),
    mockWhere,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    execute: mockExecute,
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  executionLargeValueDependencies: {
    childKey: 'executionLargeValueDependencies.childKey',
    parentKey: 'executionLargeValueDependencies.parentKey',
    workspaceId: 'executionLargeValueDependencies.workspaceId',
  },
  executionLargeValueReferences: {
    executionId: 'executionLargeValueReferences.executionId',
    key: 'executionLargeValueReferences.key',
    source: 'executionLargeValueReferences.source',
  },
  executionLargeValues: {
    createdAt: 'executionLargeValues.createdAt',
    deletedAt: 'executionLargeValues.deletedAt',
    key: 'executionLargeValues.key',
    workspaceId: 'executionLargeValues.workspaceId',
  },
  jobExecutionLogs: {
    startedAt: 'jobExecutionLogs.startedAt',
    workspaceId: 'jobExecutionLogs.workspaceId',
  },
  pausedExecutions: {
    executionId: 'pausedExecutions.executionId',
    status: 'pausedExecutions.status',
  },
  workspaceFiles: {
    context: 'workspaceFiles.context',
    deletedAt: 'workspaceFiles.deletedAt',
    key: 'workspaceFiles.key',
    uploadedAt: 'workspaceFiles.uploadedAt',
    workspaceId: 'workspaceFiles.workspaceId',
  },
  workflowExecutionLogs: {
    executionData: 'workflowExecutionLogs.executionData',
    executionId: 'workflowExecutionLogs.executionId',
    files: 'workflowExecutionLogs.files',
    id: 'workflowExecutionLogs.id',
    startedAt: 'workflowExecutionLogs.startedAt',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  asc: vi.fn((column: unknown) => ({ op: 'asc', column })),
  eq: mockEq,
  inArray: mockInArray,
  isNull: mockIsNull,
  lt: mockLt,
  notInArray: mockNotInArray,
  or: mockOr,
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
  chunkedBatchDelete: mockChunkedBatchDelete,
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  LIVE_PAUSED_REFERENCE_STATUSES: ['paused', 'partially_resumed', 'cancelling'],
  markLargeValuesDeleted: mockMarkLargeValuesDeleted,
  pruneLargeValueMetadata: mockPruneLargeValueMetadata,
  unreferencedLargeValuePredicate: vi.fn(() => ({ op: 'unreferencedLargeValuePredicate' })),
}))

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {
    cleanupOrphanedSnapshots: vi.fn(async () => 0),
  },
}))

vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: vi.fn(() => true),
  StorageService: {
    deleteFiles: mockDeleteFiles,
  },
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
}))

import { cleanupLogsTask, runCleanupLogs } from '@/background/cleanup-logs'

describe('cleanup logs worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChunkedBatchDelete.mockImplementation(async (options: CapturedBatchDeleteOptions) => {
      await options.selectChunk(['workspace-1'], 500)
      await options.onBatch?.([
        {
          id: 'log-1',
          files: [
            { key: 'execution-file-a' },
            { key: 'execution-file-a' },
            { key: 'execution-file-b' },
          ],
        },
      ])
      return { table: 'workflow_execution_logs', deleted: 1, failed: 0 }
    })
  })

  it('cleans logs without selecting execution_data or scanning refs', async () => {
    await runCleanupLogs({
      label: 'free/1',
      plan: 'free',
      retentionHours: 720,
      workspaceIds: ['workspace-1'],
    })

    expect(mockChunkedBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: 500,
        maxBatches: 50,
        totalRowLimit: 25_000,
      })
    )
    expect(mockSelect).toHaveBeenCalledWith({
      id: 'workflowExecutionLogs.id',
      files: 'workflowExecutionLogs.files',
    })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockDeleteFiles).toHaveBeenCalledWith(
      ['execution-file-a', 'execution-file-b'],
      'execution'
    )
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(2)
    expect(mockPruneLargeValueMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceIds: ['workspace-1'] })
    )
    expect(mockBatchDeleteByWorkspaceAndTimestamp).toHaveBeenCalledOnce()
  })

  it('does not count large values as deleted when deleted_at marking fails', async () => {
    const largeValueKey =
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json'
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ key: largeValueKey }])
    mockDeleteFiles
      .mockResolvedValueOnce({ deleted: 2, failed: [] })
      .mockResolvedValueOnce({ deleted: 1, failed: [] })
    mockMarkLargeValuesDeleted.mockRejectedValueOnce(new Error('db unavailable'))

    await runCleanupLogs({
      label: 'free/1',
      plan: 'free',
      retentionHours: 720,
      workspaceIds: ['workspace-1'],
    })

    expect(mockMarkLargeValuesDeleted).toHaveBeenCalledWith([largeValueKey])
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(2)
  })

  it('cleans legacy large values from file metadata without selecting execution_data', async () => {
    const legacyKey =
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json'
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: legacyKey }])
    mockDeleteFiles
      .mockResolvedValueOnce({ deleted: 2, failed: [] })
      .mockResolvedValueOnce({ deleted: 1, failed: [] })

    await runCleanupLogs({
      label: 'free/1',
      plan: 'free',
      retentionHours: 720,
      workspaceIds: ['workspace-1'],
    })

    expect(mockSelect).toHaveBeenCalledWith({
      id: 'workflowExecutionLogs.id',
      files: 'workflowExecutionLogs.files',
    })
    expect(mockSelect).not.toHaveBeenCalledWith(
      expect.objectContaining({ executionData: expect.anything() })
    )
    const legacyWhereArgs = mockAnd.mock.calls
      .flat()
      .filter((arg): arg is { strings: string[] } => {
        return (
          typeof arg === 'object' &&
          arg !== null &&
          Array.isArray((arg as { strings?: unknown }).strings)
        )
      })
      .map((arg) => arg.strings.join(' '))
      .join(' ')
    expect(legacyWhereArgs).toContain('FROM ')
    expect(legacyWhereArgs).toContain("ref.source = 'execution_log'")
    expect(legacyWhereArgs).toContain("ref.source = 'paused_snapshot'")
    expect(legacyWhereArgs).toContain('dependency.child_key')
    expect(mockDeleteFiles).toHaveBeenLastCalledWith([legacyKey], 'execution')
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith(legacyKey)
  })

  it('caps Trigger.dev concurrency for log cleanup tasks', () => {
    expect(cleanupLogsTask).toMatchObject({
      queue: { concurrencyLimit: 2 },
    })
  })
})
