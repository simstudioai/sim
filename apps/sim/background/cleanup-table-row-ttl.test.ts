/**
 * @vitest-environment node
 */
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
} = vi.hoisted(() => ({
  mockDeleteExecute: vi.fn(),
  mockListExecute: vi.fn(),
  mockIsTableRowTtlEnabled: vi.fn(),
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
vi.mock('@/lib/table/ttl-availability', () => ({
  isTableRowTtlEnabled: mockIsTableRowTtlEnabled,
}))

import { cleanupTableRowTtlTask, runCleanupTableRowTtl } from '@/background/cleanup-table-row-ttl'

const dialect = new PgDialect()

const table = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: { columns: [{ id: 'col-ttl', name: 'expires_at', type: 'ttl' }] },
  locks: { insertLocked: false, updateLocked: false, deleteLocked: false, schemaLocked: false },
}

describe('table row TTL cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        { count: 500, createdAt: '2026-01-01T00:00:00.123456', lastId: 'row-500' },
      ])
      .mockResolvedValueOnce([
        { count: 12, createdAt: '2026-01-02T00:00:00.000000', lastId: 'row-512' },
      ])

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 2,
      deleted: 512,
      limitReached: false,
    })
    expect(mockWithLockedTable).toHaveBeenCalledTimes(2)
    expect(mockDeleteExecute).toHaveBeenCalledTimes(2)
    const secondQuery = dialect.sqlToQuery(mockDeleteExecute.mock.calls[1][0] as SQL)
    expect(secondQuery.sql.replace(/\$\d+/g, '?').replace(/\s+/g, ' ')).toContain(
      'AND (table_row.created_at, table_row.id) > (?::timestamp, ?)'
    )
    expect(secondQuery.params).toEqual(
      expect.arrayContaining(['2026-01-01T00:00:00.123456', 'row-500'])
    )
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
  })

  it('compares TTL values with whole Date.now epoch seconds', async () => {
    const nowEpochMilliseconds = 1_700_000_000_999
    const nowEpochSeconds = 1_700_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowEpochMilliseconds)
    mockDeleteExecute.mockResolvedValue([{ count: 0, createdAt: null, lastId: null }])

    try {
      await runCleanupTableRowTtl()
    } finally {
      nowSpy.mockRestore()
    }

    expect(dialect.sqlToQuery(mockListExecute.mock.calls[0][0] as SQL).params).toContain(
      nowEpochSeconds
    )
    expect(dialect.sqlToQuery(mockDeleteExecute.mock.calls[0][0] as SQL).params).toContain(
      nowEpochSeconds
    )
  })

  it('checks the oldest expired rows first without using creation time as an expiry rule', async () => {
    mockDeleteExecute.mockResolvedValue([{ count: 0, createdAt: null, lastId: null }])

    await runCleanupTableRowTtl()

    const query = dialect
      .sqlToQuery(mockDeleteExecute.mock.calls[0][0] as SQL)
      .sql.replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '?')
      .trim()
    expect(query).toContain('AND (table_row.data->>?)::numeric <= ?')
    expect(query).toContain('ORDER BY table_row.created_at, table_row.id')
    expect(query).toContain(`to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')`)
    expect(query).not.toContain('table_row.created_by')
  })

  it('rejects a batch without a creation-time cursor', async () => {
    mockDeleteExecute.mockResolvedValue([{ count: 1, lastId: 'row-1' }])

    await expect(runCleanupTableRowTtl()).rejects.toThrow(
      'Table row TTL cleanup did not return a creation-time cursor'
    )
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

  it('does no work when the feature is disabled', async () => {
    mockIsTableRowTtlEnabled.mockResolvedValue(false)

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 0,
      deleted: 0,
      limitReached: false,
    })
    expect(mockListExecute).not.toHaveBeenCalled()
    expect(mockWithLockedTable).not.toHaveBeenCalled()
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
    mockDeleteExecute.mockResolvedValue([
      { count: 500, createdAt: '2026-01-01T00:00:00.000000', lastId: 'row-cursor' },
    ])

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
            return [{ count: 500, createdAt: '2026-01-01T00:00:00.000000', lastId: 'row-500' }]
          }
          if (tableId === secondTable.id) {
            return [{ count: 1, createdAt: '2026-01-01T00:00:00.000000', lastId: 'row-1' }]
          }
          return [{ count: 0, createdAt: null, lastId: null }]
        }),
      })
    })

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 3,
      deleted: 501,
      limitReached: false,
    })
    expect(attemptedTableIds).toEqual([table.id, secondTable.id, table.id])
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(table.id)
    expect(mockSignalTableRowsChanged).toHaveBeenCalledWith(secondTable.id)
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
