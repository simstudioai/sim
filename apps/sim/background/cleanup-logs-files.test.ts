/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteFiles, mockDeleteFileMetadata } = vi.hoisted(() => ({
  mockDeleteFiles: vi.fn(),
  mockDeleteFileMetadata: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config) => config),
  queue: vi.fn((config) => config),
}))
vi.mock('@/lib/billing/cleanup-dispatcher', () => ({ runCleanupWithLimits: vi.fn() }))
vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  LIVE_PAUSED_REFERENCE_STATUSES: ['paused', 'partially_resumed', 'cancelling'],
  markLargeValuesDeleted: vi.fn(),
  pruneLargeValueMetadata: vi.fn(async () => ({
    referencesDeleted: 0,
    dependenciesDeleted: 0,
    tombstonesDeleted: 0,
  })),
  unreferencedLargeValuePredicate: vi.fn(),
}))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { cleanupOrphanedSnapshots: vi.fn() },
}))
vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: vi.fn(() => true),
  StorageService: { deleteFiles: mockDeleteFiles },
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
}))

import { createCleanupBudgets } from '@/lib/cleanup/limits'
import { runCleanupLogs } from '@/background/cleanup-logs'

const payload = {
  label: 'free/1',
  plan: 'free' as const,
  retentionHours: 720,
  workspaceIds: ['workspace-1'],
}
const rows = [
  { id: 'log-1', files: [{ key: 'file-a' }, { key: 'file-b' }] },
  { id: 'log-2', files: [{ key: 'file-c' }] },
]

describe('bounded log cleanup file failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce(rows)
    dbChainMockFns.returning.mockResolvedValueOnce(rows.map(({ id }) => ({ id })))
    mockDeleteFiles.mockImplementation(async (keys: string[]) => ({
      deleted: keys.length,
      failed: [],
    }))
    mockDeleteFileMetadata.mockResolvedValue(true)
  })

  it.each([
    {
      name: 'the storage request throws',
      fail: () => mockDeleteFiles.mockRejectedValueOnce(new Error('storage unavailable')),
    },
    {
      name: 'storage returns a partial failure',
      fail: () =>
        mockDeleteFiles.mockResolvedValueOnce({
          deleted: 1,
          failed: [{ key: 'file-b', error: 'storage unavailable' }],
        }),
    },
    {
      name: 'metadata deletion throws',
      fail: () => mockDeleteFileMetadata.mockRejectedValueOnce(new Error('database unavailable')),
    },
  ])('keeps the entire log batch retryable when $name', async ({ fail }) => {
    fail()
    const budgets = createCleanupBudgets({ workflowLogs: 2 })

    await expect(runCleanupLogs(payload, budgets)).rejects.toThrow('Log file cleanup failed')

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mockDeleteFiles).toHaveBeenCalledTimes(1)
    expect(budgets.workflowLogs.remaining).toBe(0)

    dbChainMockFns.limit.mockResolvedValueOnce(rows)
    await runCleanupLogs(payload, createCleanupBudgets({ workflowLogs: 2 }))

    expect(mockDeleteFiles).toHaveBeenNthCalledWith(2, ['file-a', 'file-b'], 'execution')
    expect(mockDeleteFiles).toHaveBeenNthCalledWith(3, ['file-c'], 'execution')
    expect(dbChainMockFns.delete).toHaveBeenCalledExactlyOnceWith(schemaMock.workflowExecutionLogs)
  })

  it('deletes log rows only after every file and its metadata succeeds', async () => {
    await runCleanupLogs(payload, createCleanupBudgets({ workflowLogs: 2 }))

    expect(mockDeleteFiles).toHaveBeenCalledTimes(2)
    expect(mockDeleteFileMetadata).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.delete).toHaveBeenCalledExactlyOnceWith(schemaMock.workflowExecutionLogs)
    const deleteOrder = dbChainMockFns.delete.mock.invocationCallOrder[0]
    expect(mockDeleteFiles.mock.invocationCallOrder.at(-1)).toBeLessThan(deleteOrder)
    expect(mockDeleteFileMetadata.mock.invocationCallOrder.at(-1)).toBeLessThan(deleteOrder)
  })
})
