/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  mockBatchDeleteByWorkspaceAndTimestamp,
  mockChunkedBatchDelete,
  mockDeleteFileMetadata,
  mockDeleteFiles,
  mockMarkLargeValuesDeleted,
  mockPruneLargeValueMetadata,
  mockTask,
} = vi.hoisted(() => ({
  mockBatchDeleteByWorkspaceAndTimestamp: vi.fn(async () => ({
    table: 'job',
    deleted: 0,
    failed: 0,
  })),
  mockChunkedBatchDelete: vi.fn(),
  mockDeleteFileMetadata: vi.fn(async () => true),
  mockDeleteFiles: vi.fn(async () => ({ deleted: 2, failed: [] })),
  mockMarkLargeValuesDeleted: vi.fn(async () => undefined),
  mockPruneLargeValueMetadata: vi.fn(async () => ({
    referencesDeleted: 0,
    dependenciesDeleted: 0,
    tombstonesDeleted: 0,
  })),
  mockTask: vi.fn((config: unknown) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

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
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
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
    expect(dbChainMockFns.select).toHaveBeenCalledWith({
      id: schemaMock.workflowExecutionLogs.id,
      files: schemaMock.workflowExecutionLogs.files,
    })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
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
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ key: largeValueKey }])
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

    expect(mockMarkLargeValuesDeleted).toHaveBeenCalledWith([largeValueKey], expect.anything())
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(2)
  })

  it('cleans legacy large values from file metadata without selecting execution_data', async () => {
    const legacyKey =
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json'
    dbChainMockFns.limit
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

    expect(dbChainMockFns.select).toHaveBeenCalledWith({
      id: schemaMock.workflowExecutionLogs.id,
      files: schemaMock.workflowExecutionLogs.files,
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalledWith(
      expect.objectContaining({ executionData: expect.anything() })
    )
    const legacyWhereArgs = drizzleOrmMock.and.mock.calls
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
