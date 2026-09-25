import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

const {
  mockDeleteExecute,
  mockListExecute,
  mockIsTableRowTtlEnabled,
  mockSignalTableRowsChanged,
  mockTask,
  mockWithLockedTable,
  mockFireTableTrigger,
  mockLoggerError,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockDeleteExecute: vi.fn(),
  mockListExecute: vi.fn(),
  mockIsTableRowTtlEnabled: vi.fn(),
  mockSignalTableRowsChanged: vi.fn(),
  mockTask: vi.fn((config: unknown) => config),
  mockWithLockedTable: vi.fn(),
  mockFireTableTrigger: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  dbFor: vi.fn(() => ({ execute: mockListExecute })),
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: mockLoggerInfo, warn: vi.fn(), error: mockLoggerError }),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mockSignalTableRowsChanged }))
vi.mock('@/lib/table/constants', () => ({
  getDeleteSnapshotBatchSize: () => 500,
  TABLE_LIMITS: { DELETE_SNAPSHOT_BATCH_MAX_BYTES: 32 * 1024 * 1024 },
}))
vi.mock('@/lib/table/service', () => ({ withLockedTable: mockWithLockedTable }))
vi.mock('@/lib/table/ttl-availability', () => ({
  isTableRowTtlEnabled: mockIsTableRowTtlEnabled,
}))
vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: mockFireTableTrigger }))

import { runCleanupTableRowTtl } from '@/background/cleanup-table-row-ttl'

const dialect = new PgDialect()

const table = {
  id: 'table-1',
  name: 'Expiring rows',
  workspaceId: 'workspace-1',
  schema: { columns: [{ id: 'col-ttl', name: 'expires_at', type: 'ttl' }] },
  locks: { insertLocked: false, updateLocked: false, deleteLocked: false, schemaLocked: false },
}

function deletedRows(count: number, start = 1) {
  return Array.from({ length: count }, (_, index) => {
    const number = start + index
    return { id: `row-${number}`, data: { value: number } }
  })
}

function returnedRows(count: number, start = 1, createdAt = '2026-01-01T00:00:00.000000') {
  return deletedRows(count, start).map((row) => ({
    ...row,
    createdAt,
    snapshotBytes: 20,
  }))
}

describe('table row TTL cleanup', () => {
  beforeEach(() => {
    mockIsTableRowTtlEnabled.mockResolvedValue(true)
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

  it('deletes expired rows in locked, created-at keyset batches and signals the table', async () => {
    mockDeleteExecute
      .mockResolvedValueOnce([
        ...returnedRows(499, 1, '2026-01-01T00:00:00.123455'),
        ...returnedRows(1, 500, '2026-01-01T00:00:00.123456'),
      ])
      .mockResolvedValueOnce(returnedRows(12, 501))
      .mockResolvedValueOnce([])

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 3,
      deleted: 512,
      limitReached: false,
    })
    expect(mockWithLockedTable).toHaveBeenCalledTimes(3)
    expect(mockDeleteExecute).toHaveBeenCalledTimes(3)
    const secondQuery = dialect.sqlToQuery(mockDeleteExecute.mock.calls[1][0] as SQL)
    expect(secondQuery.sql.replace(/\$\d+/g, '?').replace(/\s+/g, ' ')).toContain(
      'AND (table_row.created_at, table_row.id) > (?::timestamp, ?)'
    )
    expect(secondQuery.params).toEqual(
      expect.arrayContaining(['2026-01-01T00:00:00.123456', 'row-500'])
    )
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
    expect(mockFireTableTrigger).toHaveBeenCalledTimes(2)
    expect(mockFireTableTrigger).toHaveBeenNthCalledWith(
      1,
      table.id,
      table.workspaceId,
      table.name,
      'delete',
      deletedRows(500),
      null,
      table.schema,
      'ttl-cleanup'
    )
  })

  it('compares TTL timestamps with the current UTC instant', async () => {
    const nowEpochMilliseconds = 1_700_000_000_999
    const nowUtc = '2023-11-14T22:13:20.999Z'
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowEpochMilliseconds)
    mockDeleteExecute.mockResolvedValue([])

    try {
      await runCleanupTableRowTtl()
    } finally {
      nowSpy.mockRestore()
    }

    expect(dialect.sqlToQuery(mockListExecute.mock.calls[0][0] as SQL).params).toContain(nowUtc)
    expect(dialect.sqlToQuery(mockDeleteExecute.mock.calls[0][0] as SQL).params).toContain(nowUtc)
  })

  it('checks the oldest expired rows first without using creation time as an expiry rule', async () => {
    mockDeleteExecute.mockResolvedValue([])

    await runCleanupTableRowTtl()

    const query = dialect
      .sqlToQuery(mockDeleteExecute.mock.calls[0][0] as SQL)
      .sql.replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '?')
      .trim()
    expect(query).toContain('THEN (table_row.data->>?)::timestamptz END <= ?::timestamptz')
    expect(query).toContain('ORDER BY table_row.created_at, table_row.id')
    expect(query).toContain('octet_length(table_row.data::text) AS snapshot_bytes')
    expect(query).toContain('cumulative_snapshot_bytes <= ?')
    expect(query).toContain('OR snapshot_order = 1')
    expect(query).toContain(
      `to_char(table_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"`
    )
    expect(query).toContain('candidates.snapshot_bytes AS "snapshotBytes"')
    expect(query).not.toContain('table_row.created_by')
  })

  it('skips a table whose batch has no creation-time cursor without signaling deletion', async () => {
    mockDeleteExecute.mockResolvedValue([{ id: 'row-1', data: { value: 1 } }])

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 1,
      deleted: 0,
      limitReached: false,
    })
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Table row TTL cleanup failed; skipping table for this run',
      expect.objectContaining({
        tableId: table.id,
        error: new Error('Table row TTL cleanup did not return a creation-time cursor'),
      })
    )
    expect(mockFireTableTrigger).not.toHaveBeenCalled()
    expect(mockSignalTableRowsChanged).not.toHaveBeenCalled()
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
    mockDeleteExecute.mockResolvedValue(returnedRows(500))

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 100,
      deleted: 50_000,
      limitReached: true,
    })
    expect(mockDeleteExecute).toHaveBeenCalledTimes(100)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledTimes(1)
  })

  it('gives each table one batch before returning to a backlogged table', async () => {
    const secondTable = {
      ...table,
      id: 'table-2',
    }
    const attemptedTableIds: string[] = []
    const tableAttempts = new Map<string, number>()
    mockListExecute.mockResolvedValue([
      { id: table.id, workspaceId: table.workspaceId },
      { id: secondTable.id, workspaceId: secondTable.workspaceId },
    ])
    mockWithLockedTable.mockImplementation(async (tableId, mutate) => {
      const freshTable = tableId === secondTable.id ? secondTable : table
      return mutate(freshTable, {
        execute: vi.fn(async () => {
          attemptedTableIds.push(tableId)
          const attempt = (tableAttempts.get(tableId) ?? 0) + 1
          tableAttempts.set(tableId, attempt)
          if (tableId === table.id && attempt === 1) {
            return returnedRows(500)
          }
          if (tableId === secondTable.id && attempt === 1) {
            return returnedRows(1)
          }
          return []
        }),
      })
    })

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 4,
      deleted: 501,
      limitReached: false,
    })
    expect(attemptedTableIds).toEqual([table.id, secondTable.id, table.id, secondTable.id])
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(secondTable.id)
  })

  it('skips a failed table, finishes healthy tables, and retries the failed table next run', async () => {
    const secondTable = { ...table, id: 'table-2' }
    mockListExecute.mockResolvedValue([
      { id: table.id, workspaceId: table.workspaceId },
      { id: secondTable.id, workspaceId: secondTable.workspaceId },
    ])
    mockDeleteExecute.mockResolvedValueOnce(returnedRows(1)).mockResolvedValue([])
    mockWithLockedTable.mockImplementation(async (tableId, mutate) => {
      if (tableId === table.id) throw new Error('first table cleanup failed')
      return mutate(secondTable, { execute: mockDeleteExecute })
    })

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 3,
      deleted: 1,
      limitReached: false,
    })
    expect(mockWithLockedTable.mock.calls.map(([id]) => id)).toEqual([
      table.id,
      secondTable.id,
      secondTable.id,
    ])
    expect(mockSignalTableRowsChanged).toHaveBeenCalledTimes(1)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(secondTable.id)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Table row TTL cleanup failed; skipping table for this run',
      {
        tableId: table.id,
        workspaceId: table.workspaceId,
        deleted: 0,
        error: new Error('first table cleanup failed'),
      }
    )
    expect(mockLoggerInfo).toHaveBeenCalledWith('Table row TTL cleanup completed', {
      batches: 3,
      deleted: 1,
      failedTables: 1,
      limitReached: false,
    })

    mockListExecute.mockResolvedValue([{ id: table.id, workspaceId: table.workspaceId }])
    mockWithLockedTable.mockImplementation(async (_tableId, mutate) =>
      mutate(table, { execute: mockDeleteExecute })
    )
    mockDeleteExecute.mockClear().mockResolvedValueOnce(returnedRows(1))
    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 2,
      deleted: 1,
      limitReached: false,
    })
    const retryQuery = dialect.sqlToQuery(mockDeleteExecute.mock.calls[0][0] as SQL)
    expect(retryQuery.sql).not.toContain('(table_row.created_at, table_row.id) >')
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
  })

  it('keeps and signals prior commits when a later batch fails while other tables finish', async () => {
    const secondTable = { ...table, id: 'table-2' }
    const firstExecute = vi
      .fn()
      .mockResolvedValueOnce(returnedRows(1))
      .mockRejectedValue(new Error('later batch failed'))
    const secondExecute = vi.fn().mockResolvedValueOnce(returnedRows(1)).mockResolvedValue([])
    mockListExecute.mockResolvedValue([
      { id: table.id, workspaceId: table.workspaceId },
      { id: secondTable.id, workspaceId: secondTable.workspaceId },
    ])
    mockWithLockedTable.mockImplementation(async (tableId, mutate) =>
      tableId === table.id
        ? mutate(table, { execute: firstExecute })
        : mutate(secondTable, { execute: secondExecute })
    )

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 4,
      deleted: 2,
      limitReached: false,
    })
    expect(mockWithLockedTable.mock.calls.map(([id]) => id)).toEqual([
      table.id,
      secondTable.id,
      table.id,
      secondTable.id,
    ])
    expect(mockSignalTableRowsChanged).toHaveBeenCalledTimes(2)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(secondTable.id)
    expect(mockFireTableTrigger).toHaveBeenCalledTimes(2)
  })

  it('counts a failed attempt toward the run limit without repeatedly retrying that table', async () => {
    const secondTable = { ...table, id: 'table-2' }
    mockListExecute.mockResolvedValue([
      { id: table.id, workspaceId: table.workspaceId },
      { id: secondTable.id, workspaceId: secondTable.workspaceId },
    ])
    mockDeleteExecute.mockResolvedValue(returnedRows(500))
    mockWithLockedTable.mockImplementation(async (tableId, mutate) => {
      if (tableId === table.id) throw new Error('persistent table failure')
      return mutate(secondTable, { execute: mockDeleteExecute })
    })

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 100,
      deleted: 49_500,
      limitReached: true,
    })
    expect(mockWithLockedTable).toHaveBeenCalledTimes(100)
    expect(mockWithLockedTable.mock.calls.filter(([id]) => id === table.id)).toHaveLength(1)
    expect(mockDeleteExecute).toHaveBeenCalledTimes(99)
  })

  it('still rejects when table discovery fails before any table can be processed', async () => {
    mockListExecute.mockRejectedValue(new Error('database unavailable'))

    await expect(runCleanupTableRowTtl()).rejects.toThrow('database unavailable')
    expect(mockWithLockedTable).not.toHaveBeenCalled()
    expect(mockSignalTableRowsChanged).not.toHaveBeenCalled()
  })
})
