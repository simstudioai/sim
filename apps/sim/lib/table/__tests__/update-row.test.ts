/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchInsertRows,
  deleteColumn,
  insertRow,
  renameColumn,
  replaceTableRows,
  updateRow,
  upsertRow,
} from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'
import { getUniqueColumns } from '@/lib/table/validation'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: vi.fn(() => ({ valid: true, errors: [] })),
  validateRowAgainstSchema: vi.fn(() => ({ valid: true, errors: [] })),
  validateTableName: vi.fn(() => ({ valid: true, errors: [] })),
  validateTableSchema: vi.fn(() => ({ valid: true, errors: [] })),
  getUniqueColumns: vi.fn(() => []),
  checkUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
  checkBatchUniqueConstraintsDb: vi.fn(async () => ({ valid: true, errors: [] })),
}))

/**
 * Inspects the queued `trx.execute(...)` calls for SQL containing `substring`.
 * Works with both `sql\`...\`` (produces `{ strings, values }`) and `sql.raw(...)`
 * (produces `{ rawSql }`) from the global drizzle mock.
 */
function findExecutedSqlContaining(substring: string): boolean {
  return dbChainMockFns.execute.mock.calls.some(([arg]) => {
    if (!arg || typeof arg !== 'object') return false
    const a = arg as Record<string, unknown>
    if (Array.isArray(a.strings)) {
      return (a.strings as string[]).some((s) => typeof s === 'string' && s.includes(substring))
    }
    if (typeof a.rawSql === 'string') {
      return (a.rawSql as string).includes(substring)
    }
    return false
  })
}

function findExecutedRawSql(substring: string): string | undefined {
  for (const [arg] of dbChainMockFns.execute.mock.calls) {
    if (!arg || typeof arg !== 'object') continue
    const raw = (arg as { rawSql?: unknown }).rawSql
    if (typeof raw === 'string' && raw.includes(substring)) return raw
  }
  return undefined
}

const EXISTING_ROW = {
  id: 'row-1',
  tableId: 'tbl-1',
  workspaceId: 'ws-1',
  data: { name: 'Alice', age: 30 },
  position: 1,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const TABLE: TableDefinition = {
  id: 'tbl-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { name: 'name', type: 'string' },
      { name: 'age', type: 'number' },
    ],
  },
  metadata: null,
  rowCount: 0,
  maxRows: 1000,
  workspaceId: 'ws-1',
  createdBy: 'user-1',
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('updateRow — partial merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([EXISTING_ROW])
  })

  it('preserves columns not included in the partial update', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Alice', age: 31 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Alice', age: 31 } })
    )
  })

  it('allows updating a single column without affecting others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Bob' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Bob', age: 30 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Bob', age: 30 } })
    )
  })

  it('allows explicitly nulling a field while preserving others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: null }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Alice', age: null })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Alice', age: null } })
    )
  })

  it('handles a full-row update correctly (idempotent merge)', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Bob', age: 25 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Bob', age: 25 })
  })

  it('throws when the row does not exist', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      updateRow(
        { tableId: 'tbl-1', rowId: 'row-missing', data: { age: 31 }, workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )
    ).rejects.toThrow('Row not found')
  })
})

describe('insertRow — position race safety (migration 0198 + advisory lock)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDbChainMock()
    vi.mocked(getUniqueColumns).mockReturnValue([])
  })

  it('auto-position inserts acquire the per-table advisory lock before reading max(position)', async () => {
    await expect(
      insertRow({ tableId: 'tbl-1', data: { name: 'a' }, workspaceId: 'ws-1' }, TABLE, 'req-1')
    ).rejects.toBeDefined()

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
    expect(findExecutedSqlContaining('hashtextextended')).toBe(true)
  })

  it('explicit-position inserts also acquire the advisory lock to serialize position shifts', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'row-1',
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'a' },
        position: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await insertRow(
      { tableId: 'tbl-1', data: { name: 'a' }, workspaceId: 'ws-1', position: 5 },
      TABLE,
      'req-1'
    )

    // `(table_id, position)` index is non-unique, so concurrent explicit-position
    // inserts at the same slot could both skip the shift and duplicate — lock
    // serializes them.
    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
  })

  it('batchInsertRows acquires the advisory lock (always auto-positioned)', async () => {
    await expect(
      batchInsertRows(
        { tableId: 'tbl-1', rows: [{ name: 'a' }, { name: 'b' }], workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )
    ).rejects.toBeDefined()

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
  })

  it('batchInsertRows with explicit positions acquires the advisory lock', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'row-1',
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'a' },
        position: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'row-2',
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'b' },
        position: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await batchInsertRows(
      {
        tableId: 'tbl-1',
        rows: [{ name: 'a' }, { name: 'b' }],
        workspaceId: 'ws-1',
        positions: [3, 4],
      },
      TABLE,
      'req-1'
    )

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
  })

  it('upsertRow skips the advisory lock on the update path (match found)', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([{ name: 'name', type: 'string', unique: true }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'row-1',
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'Alice', age: 30 },
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'row-1',
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'Alice', age: 31 },
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await upsertRow(
      {
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'Alice', age: 31 },
        conflictTarget: 'name',
      },
      TABLE,
      'req-1'
    )

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(false)
  })

  it('upsertRow acquires the advisory lock on the insert path (no match)', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([{ name: 'name', type: 'string', unique: true }])
    // Initial existing-row check + post-lock re-check both find no match.
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      upsertRow(
        {
          tableId: 'tbl-1',
          workspaceId: 'ws-1',
          data: { name: 'Bob', age: 25 },
          conflictTarget: 'name',
        },
        TABLE,
        'req-1'
      )
    ).rejects.toBeDefined()

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
  })

  it('upsertRow re-checks after acquiring the lock and switches to UPDATE when a racing tx inserted the row', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([{ name: 'name', type: 'string', unique: true }])
    // Initial existing-row check: no match (another tx has not committed yet).
    dbChainMockFns.limit.mockResolvedValueOnce([])
    // Post-lock re-check: a racing tx just inserted the row.
    const racedRow = {
      id: 'row-raced',
      tableId: 'tbl-1',
      workspaceId: 'ws-1',
      data: { name: 'Bob', age: 25 },
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([racedRow])
    // UPDATE returning the patched row.
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...racedRow, data: { name: 'Bob', age: 26 } },
    ])

    const result = await upsertRow(
      {
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        data: { name: 'Bob', age: 26 },
        conflictTarget: 'name',
      },
      TABLE,
      'req-1'
    )

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
    expect(result.operation).toBe('update')
    expect(result.row.id).toBe('row-raced')
    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('mutation paths — SET LOCAL timeouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('insertRow sets the default 10s/3s/5s timeouts', async () => {
    await expect(
      insertRow({ tableId: 'tbl-1', data: { name: 'a' }, workspaceId: 'ws-1' }, TABLE, 'req-1')
    ).rejects.toBeDefined()

    expect(findExecutedRawSql("SET LOCAL statement_timeout = '10000ms'")).toBeDefined()
    expect(findExecutedRawSql("SET LOCAL lock_timeout = '3000ms'")).toBeDefined()
    expect(
      findExecutedRawSql("SET LOCAL idle_in_transaction_session_timeout = '5000ms'")
    ).toBeDefined()
  })

  it('batchInsertRows raises statement_timeout to 60s', async () => {
    await expect(
      batchInsertRows(
        { tableId: 'tbl-1', rows: [{ name: 'a' }], workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )
    ).rejects.toBeDefined()

    expect(findExecutedRawSql("SET LOCAL statement_timeout = '60000ms'")).toBeDefined()
  })

  it('replaceTableRows scales statement_timeout with (existing + new) row count', async () => {
    const bigTable: TableDefinition = { ...TABLE, rowCount: 100_000, maxRows: 1_000_000 }
    const payload = Array.from({ length: 50_000 }, (_, i) => ({ name: `row-${i}` }))

    await replaceTableRows(
      { tableId: 'tbl-1', workspaceId: 'ws-1', rows: payload },
      bigTable,
      'req-1'
    )

    // (100_000 + 50_000) × 3ms/row = 450_000ms; above 120_000 floor, below 600_000 cap
    expect(findExecutedRawSql("SET LOCAL statement_timeout = '450000ms'")).toBeDefined()
  })

  it('replaceTableRows caps scaled timeout at 10 minutes for very large tables', async () => {
    const hugeTable: TableDefinition = { ...TABLE, rowCount: 10_000_000, maxRows: 20_000_000 }

    await replaceTableRows({ tableId: 'tbl-1', workspaceId: 'ws-1', rows: [] }, hugeTable, 'req-1')

    // 10M × 3ms = 30M ms, capped at 600_000ms (10 min)
    expect(findExecutedRawSql("SET LOCAL statement_timeout = '600000ms'")).toBeDefined()
  })

  it('replaceTableRows uses the 120s floor on small tables', async () => {
    const smallTable: TableDefinition = { ...TABLE, rowCount: 10 }

    await replaceTableRows(
      { tableId: 'tbl-1', workspaceId: 'ws-1', rows: [{ name: 'a' }, { name: 'b' }] },
      smallTable,
      'req-1'
    )

    // 12 × 3ms = 36ms → floored at 120_000ms
    expect(findExecutedRawSql("SET LOCAL statement_timeout = '120000ms'")).toBeDefined()
  })

  it('renameColumn scales statement_timeout with table.rowCount', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...TABLE, rowCount: 500_000 }])

    await renameColumn({ tableId: 'tbl-1', oldName: 'name', newName: 'full_name' }, 'req-1')

    // 500_000 × 2ms = 1_000_000 → capped at 600_000
    expect(findExecutedRawSql("SET LOCAL statement_timeout = '600000ms'")).toBeDefined()
  })

  it('deleteColumn uses the 60s floor on small tables', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...TABLE, rowCount: 100 }])

    await deleteColumn({ tableId: 'tbl-1', columnName: 'age' }, 'req-1')

    // 100 × 2ms = 200ms → floored at 60_000ms
    expect(findExecutedRawSql("SET LOCAL statement_timeout = '60000ms'")).toBeDefined()
  })

  it('replaceTableRows acquires the per-table advisory lock to serialize concurrent replaces', async () => {
    await replaceTableRows(
      { tableId: 'tbl-1', workspaceId: 'ws-1', rows: [{ name: 'a' }] },
      { ...TABLE, rowCount: 5 },
      'req-1'
    )

    expect(findExecutedSqlContaining('pg_advisory_xact_lock')).toBe(true)
    expect(findExecutedSqlContaining('hashtextextended')).toBe(true)
  })
})
