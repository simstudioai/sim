/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDeleteExecute,
  mockListExecute,
  mockSignalTableRowsChanged,
  mockTask,
  mockWithLockedTable,
} = vi.hoisted(() => ({
  mockDeleteExecute: vi.fn(),
  mockListExecute: vi.fn(),
  mockSignalTableRowsChanged: vi.fn(),
  mockTask: vi.fn((config: unknown) => config),
  mockWithLockedTable: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  dbFor: vi.fn(() => ({ execute: mockListExecute })),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mockSignalTableRowsChanged }))
vi.mock('@/lib/table/service', () => ({ withLockedTable: mockWithLockedTable }))

import { cleanupTableRowTtlTask, runCleanupTableRowTtl } from '@/background/cleanup-table-row-ttl'

const table = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: { columns: [{ id: 'col-ttl', name: 'expires_at', type: 'ttl' }] },
  locks: { insertLocked: false, updateLocked: false, deleteLocked: false, schemaLocked: false },
}

describe('table row TTL cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListExecute.mockResolvedValue([{ id: table.id, workspaceId: table.workspaceId }])
    mockWithLockedTable.mockImplementation(
      async (
        _tableId: string,
        mutate: (
          fresh: typeof table,
          trx: { execute: typeof mockDeleteExecute }
        ) => Promise<unknown>
      ) => mutate(table, { execute: mockDeleteExecute })
    )
  })

  it('deletes expired rows in locked, keyset batches and signals the table', async () => {
    mockDeleteExecute
      .mockResolvedValueOnce([{ count: 500, lastId: 'row-500' }])
      .mockResolvedValueOnce([{ count: 12, lastId: 'row-512' }])

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 2,
      deleted: 512,
      limitReached: false,
    })
    expect(mockWithLockedTable).toHaveBeenCalledTimes(2)
    expect(mockDeleteExecute).toHaveBeenCalledTimes(2)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
  })

  it('compares TTL values with whole Date.now epoch seconds', async () => {
    const nowEpochMilliseconds = 1_700_000_000_123
    const nowEpochSeconds = 1_700_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowEpochMilliseconds)
    mockDeleteExecute.mockResolvedValue([{ count: 0, lastId: null }])

    try {
      await runCleanupTableRowTtl()
    } finally {
      nowSpy.mockRestore()
    }

    expect(mockListExecute.mock.calls[0][0]).toMatchObject({
      values: expect.arrayContaining([nowEpochSeconds]),
    })
    expect(mockDeleteExecute.mock.calls[0][0]).toMatchObject({
      values: expect.arrayContaining([nowEpochSeconds]),
    })
  })

  it('does no work when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(runCleanupTableRowTtl(controller.signal)).resolves.toEqual({
      batches: 0,
      deleted: 0,
      limitReached: false,
    })
    expect(mockListExecute).not.toHaveBeenCalled()
  })

  it('honors a delete lock re-read inside the table advisory lock', async () => {
    mockWithLockedTable.mockImplementationOnce(async (_tableId, mutate) =>
      mutate(
        { ...table, locks: { ...table.locks, deleteLocked: true } },
        { execute: mockDeleteExecute }
      )
    )

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 0,
      deleted: 0,
      limitReached: false,
    })
    expect(mockDeleteExecute).not.toHaveBeenCalled()
    expect(mockSignalTableRowsChanged).not.toHaveBeenCalled()
  })

  it('stops after one hundred full batches', async () => {
    mockDeleteExecute.mockResolvedValue([{ count: 500, lastId: 'row-cursor' }])

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 100,
      deleted: 50_000,
      limitReached: true,
    })
    expect(mockDeleteExecute).toHaveBeenCalledTimes(100)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledTimes(1)
  })

  it('registers one serialized Trigger.dev task', () => {
    expect(cleanupTableRowTtlTask).toEqual(
      expect.objectContaining({
        id: 'cleanup-table-row-ttl',
        queue: { concurrencyLimit: 1 },
      })
    )
  })
})
