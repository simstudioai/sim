/**
 * @vitest-environment node
 */
import { tableRowExecutions, userTableRows } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteColumn, renameColumn } from '@/lib/table/columns/service'
import {
  batchInsertRows,
  batchUpdateRows,
  getRowById,
  getRowSummaryById,
  insertRow,
  replaceTableRows,
  updateRow,
  upsertRow,
} from '@/lib/table/rows/service'
import type { TableDefinition } from '@/lib/table/types'
import { checkUniqueConstraintsDb, getUniqueColumns } from '@/lib/table/validation'

// Capacity is exercised in billing.test.ts; here it's a no-op so the timeout-scaling
// suites can use large synthetic row counts without tripping the plan limit.
vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: vi.fn().mockResolvedValue(1_000_000),
  notifyTableRowUsage: vi.fn(),
  getMaxRowsPerTable: vi.fn().mockResolvedValue(1_000_000),
  wouldExceedRowLimit: () => false,
  TableRowLimitError: class TableRowLimitError extends Error {},
}))

vi.mock('@/lib/table/validation', () => ({
  validateRowSize: vi.fn(() => ({ valid: true, errors: [] })),
  validateRowAgainstSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowToSchema: vi.fn(() => ({ valid: true, errors: [] })),
  coerceRowValues: vi.fn(),
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

/**
 * The `data` payload of the last `.set(...)` row write. `updateRow` always writes a JSONB merge
 * (`data = data || {changed}::jsonb`), so this is a `sql` fragment exposing `{ strings, values }`.
 */
function lastSetDataSql(): { strings?: string[]; values?: unknown[] } | undefined {
  const payload = dbChainMockFns.set.mock.calls.at(-1)?.[0] as
    | { data?: { strings?: string[]; values?: unknown[] } }
    | undefined
  return payload?.data
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
const PERSISTED_UPDATED_AT = new Date('2024-01-01T00:00:00.001Z')

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
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('updateRow — partial merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([EXISTING_ROW])
    dbChainMockFns.returning.mockResolvedValue([
      { id: EXISTING_ROW.id, updatedAt: PERSISTED_UPDATED_AT },
    ])
  })

  it('preserves columns not included in the partial update', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    // The returned row is the full merge…
    expect(result.data).toEqual({ name: 'Alice', age: 31 })
    expect(result.updatedAt).toEqual(PERSISTED_UPDATED_AT)
    // …but the WRITE is a JSONB merge of only the changed cell (`data = data || {age:31}`), so the
    // unchanged `name` column is never re-written — that's what keeps concurrent edits to different
    // cells of the same row from clobbering each other.
    const data = lastSetDataSql()
    expect(data?.strings?.join('')).toContain(' || ')
    expect(data?.values).toContain(JSON.stringify({ age: 31 }))
    expect(data?.values).not.toContain(JSON.stringify({ name: 'Alice', age: 31 }))
  })

  it('blanks an uncoercible cell for a first-party caller, as it always has', async () => {
    const { coerceRowToSchema } = await import('@/lib/table/validation')
    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(coerceRowToSchema).toHaveBeenCalledWith(
      { name: 'Alice', age: 31 },
      TABLE.schema,
      undefined,
      ['age']
    )
  })

  it('holds only the patched keys to the strict policy a v2 caller opts into', async () => {
    // The merged row carries cells this request never sent. A legacy value in one
    // of them belongs to an earlier write and must not decide this one.
    const { coerceRowToSchema } = await import('@/lib/table/validation')
    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1',
      { uncoercibleValues: 'reject' }
    )

    expect(coerceRowToSchema).toHaveBeenCalledWith(
      { name: 'Alice', age: 31 },
      TABLE.schema,
      'reject',
      ['age']
    )
  })

  it('allows updating a single column without affecting others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Bob' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Bob', age: 30 })
    expect(lastSetDataSql()?.values).toContain(JSON.stringify({ name: 'Bob' }))
  })

  it('allows explicitly nulling a field while preserving others', async () => {
    const result = await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: null }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(result.data).toEqual({ name: 'Alice', age: null })
    // A cleared cell is written as present-with-null, not dropped.
    expect(lastSetDataSql()?.values).toContain(JSON.stringify({ age: null }))
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

  it('explicit-position inserts also acquire the advisory lock to serialize order-key minting', async () => {
    await expect(
      insertRow(
        { tableId: 'tbl-1', data: { name: 'a' }, workspaceId: 'ws-1', position: 5 },
        TABLE,
        'req-1'
      )
    ).rejects.toBeDefined()

    // A position-based insert resolves its order_key from the neighbor at that
    // rank; the lock serializes concurrent minting at the same slot.
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

  /**
   * The v2 surface is column-NAME-keyed and resolves `conflictTarget` to its
   * storage id before this call, so the rejection has to translate back — a
   * caller that sent `email` cannot act on a `col_…` id it has never seen.
   */
  it('upsertRow names the conflict column the caller does, not its storage id', async () => {
    const table: TableDefinition = {
      ...TABLE,
      schema: {
        columns: [
          { id: 'col_9934c202', name: 'email', type: 'string' },
          { id: 'col_2f1a', name: 'slug', type: 'string', unique: true },
        ],
      },
    }
    vi.mocked(getUniqueColumns).mockReturnValue([
      { id: 'col_2f1a', name: 'slug', type: 'string', unique: true },
    ])

    await expect(
      upsertRow(
        {
          tableId: 'tbl-1',
          workspaceId: 'ws-1',
          data: { col_9934c202: 'a@b.test' },
          conflictTarget: 'col_9934c202',
        },
        table,
        'req-1'
      )
    ).rejects.toThrow('Column "email" is not a unique column. Available unique columns: slug')
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
    dbChainMockFns.execute.mockResolvedValue([{ count: 0 }])
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

  it('renameColumn is metadata-only — no per-row JSONB rewrite regardless of row count', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...TABLE, rowCount: 500_000 }])

    await renameColumn({ tableId: 'tbl-1', oldName: 'name', newName: 'full_name' }, 'req-1')

    // Row data is keyed by the column's stable id (unchanged by a rename), so no
    // `user_table_rows` key rewrite is executed — and thus no scaled timeout.
    expect(findExecutedSqlContaining('jsonb_build_object')).toBe(false)
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

  it('replaceTableRows reports the authoritative bounded delete count', async () => {
    dbChainMockFns.execute.mockResolvedValue([{ count: 7 }])

    const result = await replaceTableRows(
      { tableId: 'tbl-1', workspaceId: 'ws-1', rows: [] },
      { ...TABLE, rowCount: 7 },
      'req-1'
    )

    expect(result).toEqual({ deletedCount: 7, insertedCount: 0 })
    expect(findExecutedSqlContaining('DELETE FROM')).toBe(true)
    expect(findExecutedSqlContaining('SELECT count(*)::integer AS count FROM deleted')).toBe(true)
  })
})

describe('batchUpdateRows — per-row partial merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('writes each row as a JSONB merge of only its changed cells', async () => {
    queueTableRows(userTableRows, [
      { id: 'row-1', data: { name: 'Alice', age: 30 } },
      { id: 'row-2', data: { name: 'Carol', age: 40 } },
    ])
    queueTableRows(tableRowExecutions, []) // loadExecutionsByRow → no sidecar rows

    await batchUpdateRows(
      {
        tableId: 'tbl-1',
        workspaceId: 'ws-1',
        updates: [
          { rowId: 'row-1', data: { age: 31 } },
          { rowId: 'row-2', data: { name: 'Dave' } },
        ],
      },
      TABLE,
      'req-1'
    )

    // Each row write is `data || {changed}::jsonb`, carrying ONLY that row's changed cell — so a
    // batch edit can't clobber a concurrent edit to another cell of the same row.
    const writes = dbChainMockFns.set.mock.calls
      .map((c) => c[0] as { data?: { strings?: string[]; values?: unknown[] } })
      .filter((p) => Array.isArray(p?.data?.strings))
    expect(writes.length).toBe(2)
    for (const w of writes) {
      expect(w.data?.strings?.join('')).toContain(' || ')
    }
    const values = writes.flatMap((w) => w.data?.values ?? [])
    expect(values).toContain(JSON.stringify({ age: 31 }))
    expect(values).toContain(JSON.stringify({ name: 'Dave' }))
    // Never the whole row.
    expect(values).not.toContain(JSON.stringify({ name: 'Alice', age: 31 }))
  })
})

/**
 * The uniqueness probe opens its own transaction and queries once per unique
 * column, so on a table that has any unique column it used to cost several
 * round trips on every edit — including edits nowhere near one. It is now
 * scoped to the columns the patch actually writes.
 *
 * The safety argument is that a merge cannot newly violate uniqueness on a
 * column it leaves alone: that value is the one already stored, and it
 * satisfied the constraint when it was written.
 *
 * The one case that does not cover is a unique constraint added to a column
 * that already held duplicates — such a row is no longer blocked from edits
 * elsewhere in it, which is the intended outcome.
 */
describe('updateRow — uniqueness probe scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The common case: one unique column. The two tests that need a different
    // shape override this.
    vi.mocked(getUniqueColumns).mockReturnValue([{ name: 'name', type: 'string', unique: true }])
    dbChainMockFns.limit.mockResolvedValue([EXISTING_ROW])
    dbChainMockFns.returning.mockResolvedValue([
      { id: EXISTING_ROW.id, updatedAt: PERSISTED_UPDATED_AT },
    ])
  })

  it('does not probe when the patch touches no unique column', async () => {
    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { age: 31 }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(checkUniqueConstraintsDb).not.toHaveBeenCalled()
  })

  it('still probes when the patch touches a unique column', async () => {
    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Grace' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(checkUniqueConstraintsDb).toHaveBeenCalledTimes(1)
  })

  it('probes against the merged row, so the excluded row is still the one being edited', async () => {
    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Grace' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    // The merged row is what gets probed, the excluded row is the one being
    // edited, and the schema is narrowed to the unique columns this patch
    // touched — the probe issues one query per column it is handed.
    expect(checkUniqueConstraintsDb).toHaveBeenCalledWith(
      'tbl-1',
      { name: 'Grace', age: 30 },
      { ...TABLE.schema, columns: [{ name: 'name', type: 'string', unique: true }] },
      'row-1'
    )
  })

  it('hands the probe only the unique columns the patch touched', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([
      { name: 'name', type: 'string', unique: true },
      { name: 'email', type: 'string', unique: true },
    ])

    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Grace' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    const schemaArg = vi.mocked(checkUniqueConstraintsDb).mock.calls[0][2]
    expect(schemaArg.columns).toEqual([{ name: 'name', type: 'string', unique: true }])
  })

  it('surfaces a duplicate on a column the patch does write', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([{ name: 'name', type: 'string', unique: true }])
    vi.mocked(checkUniqueConstraintsDb).mockResolvedValueOnce({
      valid: false,
      errors: ['Duplicate value for name'],
    })

    await expect(
      updateRow(
        { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Grace' }, workspaceId: 'ws-1' },
        TABLE,
        'req-1'
      )
    ).rejects.toThrow(/Duplicate value for name/)
  })

  it('does not probe on a table with no unique columns at all', async () => {
    vi.mocked(getUniqueColumns).mockReturnValue([])

    await updateRow(
      { tableId: 'tbl-1', rowId: 'row-1', data: { name: 'Grace' }, workspaceId: 'ws-1' },
      TABLE,
      'req-1'
    )

    expect(checkUniqueConstraintsDb).not.toHaveBeenCalled()
  })
})

/**
 * The read surfaces never put the executions sidecar on the wire, so loading it
 * for them is a query whose result is discarded. Two readers rather than a flag:
 * a caller that forgets a flag reads an empty sidecar and cannot tell that from
 * a row that has none, whereas here the field is not on the type.
 */
describe('row readers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([EXISTING_ROW])
  })

  it('getRowSummaryById issues one select and returns no sidecar', async () => {
    const row = await getRowSummaryById('tbl-1', 'row-1', 'ws-1')

    expect(row).not.toHaveProperty('executions')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })

  it('getRowById issues the extra select the sidecar needs', async () => {
    const row = await getRowById('tbl-1', 'row-1', 'ws-1')

    expect(row).toHaveProperty('executions')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('getRowSummaryById returns null for a missing row', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(getRowSummaryById('tbl-1', 'nope', 'ws-1')).resolves.toBeNull()
  })
})
